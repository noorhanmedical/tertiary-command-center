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

import crypto from "node:crypto";
import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientScreenings, screeningBatches } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getCurrentScreeningEvidence } from "../screening/screeningEvidenceService";
import {
  resolveClinicianNpi,
  resolveClinicForClinician,
  DEFAULT_CLINIC,
} from "../../../shared/plexus";
import { renderOrderNoteBody, renderAiOrderNoteBody, ORDER_NOTE_AI_GENERATOR_VERSION } from "./orderNoteBody";
import { canonicalOrderNoteEvidenceString } from "./orderNoteFingerprint";
import type { OrderNoteEvidenceBundle, ChartDiagnosis } from "./orderNoteProjection";
// Order Note standard — AI narrative pipeline (Slice AI-1..AI-4).
import { assembleOrderNoteEvidenceBundle, orderNoteEvidenceBundleFingerprint } from "./orderNoteEvidenceBundle";
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

function fingerprintHash(bundle: OrderNoteEvidenceBundle): string {
  return crypto.createHash("sha256").update(canonicalOrderNoteEvidenceString(bundle)).digest("hex").slice(0, 40);
}

function serviceLabel(service: string): string {
  const s = (service || "").toLowerCase();
  if (s.includes("brain")) return "BrainWave – Comprehensive Assessment";
  if (s.includes("vital")) return "VitalWave – Comprehensive Autonomic & Vascular Assessment";
  return service;
}

function splitChartDiagnoses(diagnoses: string | null | undefined): ChartDiagnosis[] {
  if (!diagnoses) return [];
  return diagnoses
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((displayText) => ({ displayText, source: "chart_documented" as const }));
}

function reasoningForService(
  reasoning: Record<string, unknown> | null | undefined,
  service: string,
): { factors: string[]; clinicianUnderstanding: string | null } {
  if (!reasoning) return { factors: [], clinicianUnderstanding: null };
  const s = (service || "").toLowerCase();
  const key = Object.keys(reasoning).find((k) => {
    const kl = k.toLowerCase();
    return (s.includes("brain") && kl.includes("brain")) || (s.includes("vital") && kl.includes("vital")) || kl === s;
  });
  const r = key ? (reasoning[key] as Record<string, unknown> | undefined) : undefined;
  if (!r || typeof r !== "object") return { factors: [], clinicianUnderstanding: null };
  const factors = Array.isArray(r["qualifying_factors"]) ? (r["qualifying_factors"] as string[]) : [];
  const cu = typeof r["clinician_understanding"] === "string" ? (r["clinician_understanding"] as string) : null;
  return { factors, clinicianUnderstanding: cu };
}

/** Assemble the deterministic Order Note evidence bundle from canonical data. */
async function assembleBundle(input: RefreshInput): Promise<OrderNoteEvidenceBundle | null> {
  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase || acase.clinicId !== input.clinicId) return null;

  const screeningId = (acase as { originatingScreeningId?: number | null }).originatingScreeningId ?? null;
  let ps: typeof patientScreenings.$inferSelect | undefined;
  if (screeningId != null) {
    [ps] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, screeningId)).limit(1);
  }

  let clinicianName: string | null = null;
  if (ps?.batchId != null) {
    const [batch] = await db.select().from(screeningBatches).where(eq(screeningBatches.id, ps.batchId)).limit(1);
    clinicianName = batch?.clinicianName ?? null;
  }
  const clinician = clinicianName
    ? { name: clinicianName, npi: resolveClinicianNpi(clinicianName), id: null as string | null }
    : { name: "Ordering Clinician", npi: null, id: null as string | null };
  const clinic = clinicianName ? resolveClinicForClinician(clinicianName) : DEFAULT_CLINIC;

  const current = await getCurrentScreeningEvidence({
    clinicId: input.clinicId,
    ancillaryCaseId: input.ancillaryCaseId,
    serviceType: acase.serviceType,
  });

  const { factors, clinicianUnderstanding } = reasoningForService(
    (ps?.reasoning as Record<string, unknown> | null) ?? null,
    acase.serviceType,
  );

  return {
    service: acase.serviceType,
    serviceLabel: serviceLabel(acase.serviceType),
    patient: {
      name: ps?.name ?? "Patient",
      dob: ps?.dob ?? null,
      mrn: null,
      plexusId: (acase as { globalPlexusPatientId?: number | null }).globalPlexusPatientId?.toString() ?? null,
      clinicName: clinic?.name ?? null,
    },
    orderingClinician: clinician,
    orderDate: null,
    chartDiagnoses: splitChartDiagnoses(ps?.diagnoses ?? null),
    qualificationFactors: factors,
    clinicianUnderstanding,
    screening: current
      ? { questionnaire: current.evidence.questionnaire, version: current.version, responses: current.evidence.responses }
      : null,
    // carry the screening version out-of-band for the refresh writer
    ...(current ? { __screeningVersion: current.version } : {}),
  } as OrderNoteEvidenceBundle & { __screeningVersion?: string };
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
    if (note.signatureStatus === "signed") return { status: "signed_no_refresh", orderNoteId: note.id };

    // Order Note standard — OpenAI-assisted narrative path. Fails HONESTLY
    // (no silent fallback to the deterministic template).
    if (featureFlags.orderNoteAi) {
      return await refreshOrderNoteViaAi(input, note);
    }

    const bundle = await assembleBundle(input);
    if (!bundle || !bundle.screening) return { status: "screening_incomplete" };
    const screeningVersion = (bundle as { __screeningVersion?: string }).__screeningVersion ?? "";
    const fingerprint = fingerprintHash(bundle);
    const rendered = renderOrderNoteBody(bundle);

    // Case 1 — body-less pending skeleton → populate in place as v1.
    if (note.generationStatus === "pending" || !note.generatedText) {
      await db
        .update(procedureNotes)
        .set({
          generationStatus: "generated",
          generatedText: rendered.text,
          generatedByAi: false,
          sourceData: { orderNoteBody: rendered.sections, evidence: { chartDiagnoses: bundle.chartDiagnoses, qualificationFactors: bundle.qualificationFactors } } as never,
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
    const newId = await db.transaction(async (tx) => {
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
          generatedText: rendered.text,
          generatedByAi: false,
          sourceData: { orderNoteBody: rendered.sections, evidence: { chartDiagnoses: bundle.chartDiagnoses, qualificationFactors: bundle.qualificationFactors } } as never,
          signatureStatus: "needs_signature",
          supersedesNoteId: note.id,
          evidenceFingerprint: fingerprint,
          evaluatedScreeningEvidenceVersion: screeningVersion,
        })
        .returning({ id: procedureNotes.id });
      return created.id;
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
      evidenceBundleFingerprint: fingerprint,
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
  if (!bundle) return { status: "screening_incomplete" };
  // BrainWave/VitalWave REQUIRE a completed A0 structured screening; other
  // services (echo/ultrasound/vascular) qualify from chart + qualification
  // evidence and have no A0 questionnaire.
  const requiresStructuredScreening = /brain|vital/i.test(bundle.service);
  if (requiresStructuredScreening && !bundle.structuredScreening) return { status: "screening_incomplete" };

  const screeningVersion = bundle.screeningEvidenceVersion ?? "";
  const fingerprint = orderNoteEvidenceBundleFingerprint(bundle);
  const bodyless = note.generationStatus === "pending" || !note.generatedText;
  const changed = note.evidenceFingerprint !== fingerprint;

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
  return { status: "versioned", supersededNoteId: note.id, orderNoteId: newId, fingerprint, screeningVersion };
}
