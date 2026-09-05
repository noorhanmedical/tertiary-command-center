// Slice A1 — canonical unsigned Order Note refresh / versioning.
//
// On completion of structured BW/VW screening, refreshes the CURRENT UNSIGNED
// canonical Order Note (procedure_notes, note_type='order_note') for the exact
// ancillary case:
//   • body-less pending skeleton  → populate IN PLACE as v1
//   • already-bodied + unsigned + MATERIAL evidence change → supersede current
//     + insert a new current version (transactional; the partial unique index
//     uq_pn_order_note_active_case is never left with two active rows)
//   • already-bodied + unsigned + no material change → record that the note was
//     evaluated against the CURRENT screening version (evaluated_screening_
//     evidence_version), body unchanged
//   • signed → NEVER modified (defer to Slice D addendum/re-review)
//
// Flag-gated (FEATURE_CANONICAL_ORDER_NOTE + FEATURE_ORDER_NOTE_REFRESH) and
// migration-0076-gated. NEVER throws when called as a hook: a failure is
// reported, never reverses the screening completion. Adds NO signing behavior.

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { featureFlags } from "../../lib/featureFlags";
import {
  renderDeterministicOrderNoteBody,
  renderAiOrderNoteBody,
  ORDER_NOTE_AI_GENERATOR_VERSION,
  ORDER_NOTE_DETERMINISTIC_GENERATOR_VERSION,
} from "./orderNoteBody";
import { orderNoteRequiresStructuredScreening } from "./orderNoteServiceConfig";
// Order Note standard — ONE canonical evidence assembler shared by BOTH the
// deterministic and the AI-assisted paths (Slice AI-1..AI-4). The deterministic
// and AI paths differ ONLY in the render/synthesis layer, never in the evidence
// sources available to them.
import {
  assembleOrderNoteEvidenceBundle,
  orderNoteEvidenceBundleFingerprint,
  type OrderNoteEvidenceBundle,
} from "./orderNoteEvidenceBundle";
// The persisted evidence_fingerprint + freshness signal is the AUTHORIZATION-
// MATERIAL fingerprint (service-relevant projection). The full bundle
// fingerprint is retained in source_data for audit only.
import { materialOrderNoteEvidenceFingerprint } from "./orderNoteMateriality";
import { generateOrderNoteNarrative } from "./orderNoteNarrativeAi";
import { validateOrderNoteNarrative, complianceFeedback } from "./orderNoteComplianceValidator";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type OrderNoteRefreshResult =
  | { status: "skipped_flag_off" }
  | { status: "no_current_note" }
  | { status: "signed_no_refresh"; orderNoteId: number }
  | { status: "screening_incomplete" }
  | { status: "migration_missing" }
  | { status: "populated_in_place"; orderNoteId: number; fingerprint: string; screeningVersion: string }
  | { status: "versioned"; supersededNoteId: number; orderNoteId: number; fingerprint: string; screeningVersion: string }
  // A SIGNED current note went materially stale: v1 is left immutable + signed
  // in history (superseded), a new unsigned v2 is generated from current
  // evidence and requires re-signature before the procedure may proceed.
  | { status: "versioned_from_signed_stale"; supersededNoteId: number; orderNoteId: number; fingerprint: string; screeningVersion: string }
  | { status: "reevaluated"; orderNoteId: number; fingerprint: string; screeningVersion: string }
  | { status: "unchanged"; orderNoteId: number; fingerprint: string; screeningVersion: string }
  | { status: "ai_generation_failed"; orderNoteId: number }
  | { status: "ai_compliance_failed"; orderNoteId: number; failures: string[] }
  | { status: "failed"; reason: string };

export type RefreshInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  source: string;
};

/**
 * Build the deterministic Order Note sourceData with provenance equivalent to
 * the AI path: source record ids, evidence bundle fingerprint/version, ordered
 * components, screening reference (when used), and qualification references.
 * Every substantive statement in the rendered body traces to these sources.
 */
function buildDeterministicSourceData(
  bundle: OrderNoteEvidenceBundle,
  rendered: { sections: unknown },
  fingerprint: string,
  screeningVersion: string,
): Record<string, unknown> {
  return {
    orderNoteBody: rendered.sections,
    generatorVersion: ORDER_NOTE_DETERMINISTIC_GENERATOR_VERSION,
    evidence: {
      chartDiagnoses: bundle.diagnoses.map((d) => d.displayText),
      qualificationFactors: bundle.qualification.factors,
    },
    orderNoteDeterministic: {
      generator: ORDER_NOTE_DETERMINISTIC_GENERATOR_VERSION,
      evidenceBundleVersion: bundle.bundleVersion,
      // evidence_fingerprint column value = AUTHORIZATION-MATERIAL fingerprint.
      evidenceBundleFingerprint: fingerprint,
      materialEvidenceFingerprint: fingerprint,
      // Full-bundle fingerprint retained for audit ("what evidence did we have").
      fullEvidenceFingerprint: orderNoteEvidenceBundleFingerprint(bundle),
      evidenceSourceIds: bundle.sourceRecordIds,
      orderedComponents: bundle.orderedComponents.map((c) => c.key),
      screeningEvidenceVersion: screeningVersion,
      screeningReference: bundle.structuredScreening
        ? { questionnaire: bundle.structuredScreening.questionnaire, version: bundle.structuredScreening.version }
        : null,
      qualificationFactors: bundle.qualification.factors,
      clinicianUnderstanding: bundle.qualification.clinicianUnderstanding,
    },
    // Durable snapshot of the exact evidence the note was rendered from.
    evidenceBundle: bundle,
  };
}

/**
 * Supersede the current note (audit-preserving: sets supersededAt only — never
 * touches body/signature) and insert a NEW unsigned version carrying the same
 * canonical identity + supersedesNoteId linkage. Atomic; the partial-unique
 * active-case index is never left with two active rows. Shared by the unsigned
 * material-change path and the signed-stale regeneration path.
 */
async function supersedeAndInsertOrderNoteVersion(
  note: typeof procedureNotes.$inferSelect,
  values: {
    generatedText: string;
    generatedByAi: boolean;
    sourceData: Record<string, unknown>;
    fingerprint: string;
    screeningVersion: string;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    const superseded = await tx
      .update(procedureNotes)
      .set({ supersededAt: new Date(), updatedAt: new Date() })
      .where(and(eq(procedureNotes.id, note.id), isNull(procedureNotes.supersededAt)))
      .returning({ id: procedureNotes.id });
    if (superseded.length !== 1) throw new Error("concurrent_supersede");
    const [created] = await tx
      .insert(procedureNotes)
      .values({
        clinicId: note.clinicId,
        executionCaseId: note.executionCaseId,
        patientScreeningId: note.patientScreeningId,
        ancillaryCaseId: note.ancillaryCaseId,
        globalPlexusPatientId: note.globalPlexusPatientId,
        patientClinicMembershipId: note.patientClinicMembershipId,
        qualifyingGlobalScheduleEventId: note.qualifyingGlobalScheduleEventId,
        adminReviewEventId: note.adminReviewEventId,
        effectiveClinicalDate: note.effectiveClinicalDate,
        serviceType: note.serviceType,
        noteType: "order_note",
        generationStatus: "generated",
        generatedText: values.generatedText,
        generatedByAi: values.generatedByAi,
        sourceData: values.sourceData as never,
        signatureStatus: "needs_signature",
        supersedesNoteId: note.id,
        evidenceFingerprint: values.fingerprint,
        evaluatedScreeningEvidenceVersion: values.screeningVersion,
      })
      .returning({ id: procedureNotes.id });
    return created.id;
  });
}

export async function refreshUnsignedOrderNoteForCase(input: RefreshInput): Promise<OrderNoteRefreshResult> {
  if (!featureFlags.canonicalOrderNote || !featureFlags.orderNoteRefresh) return { status: "skipped_flag_off" };
  try {
    const [note] = await db
      .select()
      .from(procedureNotes)
      .where(
        and(
          eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
          eq(procedureNotes.noteType, "order_note"),
          isNull(procedureNotes.supersededAt),
        ),
      )
      .limit(1);
    if (!note) return { status: "no_current_note" };
    if (note.clinicId != null && note.clinicId !== input.clinicId) return { status: "no_current_note" };

    // NOTE: signed notes are handled per-path below. A signed note is NEVER
    // mutated: if its canonical evidence is unchanged it is left untouched
    // (signed_no_refresh); if the evidence materially changed it is superseded
    // (audit-preserving) and a new unsigned v2 is generated for re-signature.

    // Order Note standard — OpenAI-assisted narrative path. Fails HONESTLY
    // (no silent fallback to the deterministic template).
    if (featureFlags.orderNoteAi) {
      return await refreshOrderNoteViaAi(input, note);
    }

    // Deterministic path — consumes the SAME canonical evidence bundle as the
    // AI path. Screening is an OPTIONAL evidence input, NOT a universal gate:
    // it is required only when the service config explicitly declares it.
    const bundle = await assembleOrderNoteEvidenceBundle({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
    if (!bundle) return { status: "no_current_note" };
    if (orderNoteRequiresStructuredScreening(bundle.service) && !bundle.structuredScreening) {
      return { status: "screening_incomplete" };
    }
    const screeningVersion = bundle.screeningEvidenceVersion ?? "";
    const fingerprint = materialOrderNoteEvidenceFingerprint(bundle);
    const rendered = renderDeterministicOrderNoteBody(bundle);

    // Signed note — immutable. Preserve the signature/body; NEVER update in
    // place. If current canonical evidence is unchanged, leave it untouched. If
    // it materially changed (fingerprint drift), supersede v1 (audit-preserving)
    // and generate a fresh unsigned v2 for clinician re-review/re-signature.
    if (note.signatureStatus === "signed") {
      if (note.evidenceFingerprint === fingerprint) {
        return { status: "signed_no_refresh", orderNoteId: note.id };
      }
      const newId = await supersedeAndInsertOrderNoteVersion(note, {
        generatedText: rendered.text,
        generatedByAi: false,
        sourceData: buildDeterministicSourceData(bundle, rendered, fingerprint, screeningVersion),
        fingerprint,
        screeningVersion,
      });
      return { status: "versioned_from_signed_stale", supersededNoteId: note.id, orderNoteId: newId, fingerprint, screeningVersion };
    }

    // Case 1 — body-less pending skeleton → populate in place as v1.
    if (note.generationStatus === "pending" || !note.generatedText) {
      await db
        .update(procedureNotes)
        .set({
          generationStatus: "generated",
          generatedText: rendered.text,
          generatedByAi: false,
          sourceData: buildDeterministicSourceData(bundle, rendered, fingerprint, screeningVersion) as never,
          evidenceFingerprint: fingerprint,
          evaluatedScreeningEvidenceVersion: screeningVersion,
          updatedAt: new Date(),
        })
        .where(and(eq(procedureNotes.id, note.id), isNull(procedureNotes.supersededAt)))
        .returning();
      return { status: "populated_in_place", orderNoteId: note.id, fingerprint, screeningVersion };
    }

    // Case 2 — already bodied + unsigned. No material change?
    if (note.evidenceFingerprint === fingerprint) {
      if (note.evaluatedScreeningEvidenceVersion !== screeningVersion) {
        await db
          .update(procedureNotes)
          .set({ evaluatedScreeningEvidenceVersion: screeningVersion, updatedAt: new Date() })
          .where(eq(procedureNotes.id, note.id));
        return { status: "reevaluated", orderNoteId: note.id, fingerprint, screeningVersion };
      }
      return { status: "unchanged", orderNoteId: note.id, fingerprint, screeningVersion };
    }

    // Case 3 — material change → supersede current + insert new version (atomic).
    const newId = await supersedeAndInsertOrderNoteVersion(note, {
      generatedText: rendered.text,
      generatedByAi: false,
      sourceData: buildDeterministicSourceData(bundle, rendered, fingerprint, screeningVersion),
      fingerprint,
      screeningVersion,
    });

    return { status: "versioned", supersededNoteId: note.id, orderNoteId: newId, fingerprint, screeningVersion };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && MIGRATION_MISSING_CODES.has(code)) return { status: "migration_missing" };
    return { status: "failed", reason: (e as { message?: string })?.message ?? "refresh_failed" };
  }
}


// ─── Order Note standard — OpenAI-assisted refresh (Slice AI-4) ─────────────

type ProcedureNoteRow = typeof procedureNotes.$inferSelect;

const AI_MAX_RETRIES = 2; // total attempts = 1 + AI_MAX_RETRIES

type ValidatedNarrative =
  | { ok: true; result: Awaited<ReturnType<typeof generateOrderNoteNarrative>>; retryCount: number }
  | { ok: false; failures: string[]; retryCount: number };

/** Generate → validate → retry-with-corrective-feedback. Throws only if the
 *  OpenAI request itself fails (after the client's transient retries). */
async function generateValidatedOrderNoteNarrative(
  bundle: Awaited<ReturnType<typeof assembleOrderNoteEvidenceBundle>> & object,
): Promise<ValidatedNarrative> {
  let feedback: string | undefined;
  let lastFailures: string[] = [];
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const result = await generateOrderNoteNarrative(bundle, feedback ? { correctiveFeedback: feedback } : undefined);
    const v = validateOrderNoteNarrative(result.narrative, bundle);
    if (v.passed) return { ok: true, result, retryCount: attempt };
    lastFailures = v.failures.map((f) => `${f.code}: ${f.message}`);
    feedback = complianceFeedback(v.failures);
  }
  return { ok: false, failures: lastFailures, retryCount: AI_MAX_RETRIES };
}

function buildAiSourceData(
  bundle: NonNullable<Awaited<ReturnType<typeof assembleOrderNoteEvidenceBundle>>>,
  rendered: { sections: unknown },
  gen: Extract<ValidatedNarrative, { ok: true }>,
  fingerprint: string,
  screeningVersion: string,
): Record<string, unknown> {
  return {
    orderNoteBody: rendered.sections,
    generatorVersion: ORDER_NOTE_AI_GENERATOR_VERSION,
    evidence: {
      chartDiagnoses: bundle.diagnoses.map((d) => d.displayText),
      qualificationFactors: bundle.qualification.factors,
    },
    orderNoteAi: {
      provider: "openai",
      model: gen.result.modelUsed,
      reasoningEffort: gen.result.reasoningEffort,
      promptVersion: gen.result.promptVersion,
      generatedAt: gen.result.generatedAt,
      evidenceBundleVersion: bundle.bundleVersion,
      // evidence_fingerprint column value = AUTHORIZATION-MATERIAL fingerprint.
      evidenceBundleFingerprint: fingerprint,
      materialEvidenceFingerprint: fingerprint,
      // Full-bundle fingerprint retained for audit ("what evidence did we have").
      fullEvidenceFingerprint: orderNoteEvidenceBundleFingerprint(bundle),
      evidenceSourceIds: bundle.sourceRecordIds,
      orderedComponents: bundle.orderedComponents.map((c) => c.key),
      screeningEvidenceVersion: screeningVersion,
      rawResponse: gen.result.rawResponse,
      validation: { passed: true, failures: [], retryCount: gen.retryCount },
    },
    // Durable snapshot of the exact evidence the model was permitted to use.
    evidenceBundle: bundle,
  };
}

async function failOrderNoteAi(noteId: number, clinicId: number, code: string): Promise<void> {
  try {
    await db.update(procedureNotes)
      .set({ generationStatus: "failed", errorMessage: code, updatedAt: new Date() })
      .where(and(eq(procedureNotes.id, noteId), eq(procedureNotes.clinicId, clinicId), isNull(procedureNotes.supersededAt)));
  } catch { /* best-effort; never reverse screening completion */ }
}

async function refreshOrderNoteViaAi(input: RefreshInput, note: ProcedureNoteRow): Promise<OrderNoteRefreshResult> {
  const bundle = await assembleOrderNoteEvidenceBundle({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
  if (!bundle) return { status: "no_current_note" };
  // Structured screening is an OPTIONAL evidence input. It is REQUIRED only
  // when the service config explicitly declares it (never inferred from the
  // service name). Both deterministic and AI paths share this rule.
  if (orderNoteRequiresStructuredScreening(bundle.service) && !bundle.structuredScreening) {
    return { status: "screening_incomplete" };
  }

  const screeningVersion = bundle.screeningEvidenceVersion ?? "";
  const fingerprint = materialOrderNoteEvidenceFingerprint(bundle);
  const bodyless = note.generationStatus === "pending" || !note.generatedText;
  const changed = note.evidenceFingerprint !== fingerprint;

  // Signed note — immutable. If canonical evidence is unchanged, leave it
  // untouched (never mutate a signed note, including its evaluated screening
  // version). If it materially changed, fall through to generate a fresh
  // unsigned v2 that supersedes the signed v1 (audit-preserving).
  if (note.signatureStatus === "signed" && !changed) {
    return { status: "signed_no_refresh", orderNoteId: note.id };
  }

  // No new body needed — only reconcile the evaluated screening version.
  if (!bodyless && !changed) {
    if (note.evaluatedScreeningEvidenceVersion !== screeningVersion) {
      await db.update(procedureNotes)
        .set({ evaluatedScreeningEvidenceVersion: screeningVersion, updatedAt: new Date() })
        .where(eq(procedureNotes.id, note.id));
      return { status: "reevaluated", orderNoteId: note.id, fingerprint, screeningVersion };
    }
    return { status: "unchanged", orderNoteId: note.id, fingerprint, screeningVersion };
  }

  // A (new) body is required → generate + validate. FAIL HONESTLY on error.
  let gen: ValidatedNarrative;
  try {
    gen = await generateValidatedOrderNoteNarrative(bundle);
  } catch {
    await failOrderNoteAi(note.id, input.clinicId, "ai_generation_failed");
    return { status: "ai_generation_failed", orderNoteId: note.id };
  }
  if (!gen.ok) {
    await failOrderNoteAi(note.id, input.clinicId, "ai_compliance_failed");
    return { status: "ai_compliance_failed", orderNoteId: note.id, failures: gen.failures };
  }

  const rendered = renderAiOrderNoteBody(bundle, gen.result.narrative);
  const sourceData = buildAiSourceData(bundle, rendered, gen, fingerprint, screeningVersion);

  // Case A — body-less pending skeleton → populate in place.
  if (bodyless) {
    await db.update(procedureNotes)
      .set({
        generationStatus: "generated",
        generatedText: rendered.text,
        generatedByAi: true,
        sourceData: sourceData as never,
        evidenceFingerprint: fingerprint,
        evaluatedScreeningEvidenceVersion: screeningVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(procedureNotes.id, note.id), isNull(procedureNotes.supersededAt)));
    return { status: "populated_in_place", orderNoteId: note.id, fingerprint, screeningVersion };
  }

  // Case B — already-bodied + unsigned + material change → supersede + version.
  const newId = await db.transaction(async (tx) => {
    const superseded = await tx.update(procedureNotes)
      .set({ supersededAt: new Date(), updatedAt: new Date() })
      .where(and(eq(procedureNotes.id, note.id), isNull(procedureNotes.supersededAt)))
      .returning({ id: procedureNotes.id });
    if (superseded.length !== 1) throw new Error("concurrent_supersede");
    const [created] = await tx.insert(procedureNotes).values({
      clinicId: note.clinicId,
      executionCaseId: note.executionCaseId,
      patientScreeningId: note.patientScreeningId,
      ancillaryCaseId: note.ancillaryCaseId,
      globalPlexusPatientId: note.globalPlexusPatientId,
      patientClinicMembershipId: note.patientClinicMembershipId,
      qualifyingGlobalScheduleEventId: note.qualifyingGlobalScheduleEventId,
      adminReviewEventId: note.adminReviewEventId,
      effectiveClinicalDate: note.effectiveClinicalDate,
      serviceType: note.serviceType,
      noteType: "order_note",
      generationStatus: "generated",
      generatedText: rendered.text,
      generatedByAi: true,
      sourceData: sourceData as never,
      signatureStatus: "needs_signature",
      supersedesNoteId: note.id,
      evidenceFingerprint: fingerprint,
      evaluatedScreeningEvidenceVersion: screeningVersion,
    }).returning({ id: procedureNotes.id });
    return created.id;
  });
  return {
    status: note.signatureStatus === "signed" ? "versioned_from_signed_stale" : "versioned",
    supersededNoteId: note.id, orderNoteId: newId, fingerprint, screeningVersion,
  };
}
