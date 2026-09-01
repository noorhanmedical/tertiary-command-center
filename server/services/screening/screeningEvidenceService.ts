// Slice A0 — structured screening evidence persistence service.
//
// Validates a submitted AncillaryScreeningEvidence payload against the pinned
// BW/VW registry, computes the FULL screening evidence version (a hash over
// the complete normalized response set), and persists it into the existing
// case_document_readiness.metadata JSONB (no new table). It only marks the
// screening_form readiness row `completed` when the service-specific
// completion policy is satisfied.
//
// Boundaries (Slice A0):
//   • Does NOT touch Order Notes, signing, procedure readiness, or flags.
//   • Legacy PDF/flag completion continues via
//     POST /api/case-document-readiness/complete (uploaded_document mode);
//     that path is untouched and does NOT satisfy the future signing gate.
//   • `getCurrentScreeningEvidence` is the read primitive A1 / the signing
//     gate (Slice C) will consume — A0 only provides it.

import crypto from "node:crypto";
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import {
  ancillaryScreeningEvidenceSchema,
  evaluateCompletion,
  canonicalScreeningEvidenceString,
  BRAINWAVE_QUESTIONNAIRE_VERSION,
  VITALWAVE_QUESTIONNAIRE_VERSION,
  type AncillaryScreeningEvidence,
  type Questionnaire,
} from "@shared/schema/screeningEvidence";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";

export type SubmitScreeningEvidenceResult =
  | { status: "invalid"; reasons: string[] }
  | { status: "incomplete"; readinessId: number; version: string; missing: string[] }
  | { status: "completed"; readinessId: number; version: string }
  // validate-and-log mode (enforcement off): we validated but performed no write.
  | { status: "validated_not_persisted"; version: string; complete: boolean; missing: string[] };

/**
 * FULL screening evidence version — sha256 over the canonical string
 * (complete normalized response set). Distinct from the Order Note evidence
 * fingerprint (A1). Deterministic; stable across re-transcription of the
 * same answers (capture identity/timestamps are excluded upstream).
 */
export function screeningEvidenceVersion(ev: AncillaryScreeningEvidence): string {
  return crypto.createHash("sha256").update(canonicalScreeningEvidenceString(ev)).digest("hex").slice(0, 40);
}

/**
 * Validate + (optionally) persist structured screening evidence.
 *
 * @param validateOnly when true (A0 validate-and-log rollout), validates and
 *   returns without any DB write or status change.
 */
export async function submitScreeningEvidence(input: {
  clinicId: number;
  payload: unknown;
  validateOnly?: boolean;
}): Promise<SubmitScreeningEvidenceResult> {
  const parsed = ancillaryScreeningEvidenceSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { status: "invalid", reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const ev = parsed.data;
  if (ev.clinicId !== input.clinicId) return { status: "invalid", reasons: ["clinic_mismatch"] };

  const version = screeningEvidenceVersion(ev);
  const { complete, missing } = evaluateCompletion(ev);

  if (input.validateOnly) {
    return { status: "validated_not_persisted", version, complete, missing };
  }

  // The screening_form readiness row must exist, be same-clinic, and match
  // the exact service. Fail closed on scope mismatch (never write cross-scope).
  const [row] = await db
    .select()
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.id, ev.screeningReadinessId),
        eq(caseDocumentReadiness.clinicId, input.clinicId),
        eq(caseDocumentReadiness.documentType, "screening_form"),
        eq(caseDocumentReadiness.serviceType, ev.serviceType),
      ),
    )
    .limit(1);
  if (!row) return { status: "invalid", reasons: ["screening_readiness_not_found_or_scope_mismatch"] };

  const metadata = {
    ...((row.metadata as Record<string, unknown>) ?? {}),
    completionMode: "structured_questionnaire",
    screeningEvidence: ev,
    screeningEvidenceVersion: version,
  };

  await db
    .update(caseDocumentReadiness)
    .set({
      metadata: metadata as never,
      documentStatus: complete ? "completed" : "pending",
      completedAt: complete ? new Date() : null,
      // The person who KEYED/attested the structured record. For paper
      // transcription this is the transcriber — provenance only; the answers
      // remain patient-reported (enforced by the contract's evidence classes).
      uploadedByUserId: ev.capture.documentedByUserId,
      generatedByAi: false,
      updatedAt: new Date(),
    })
    .where(and(eq(caseDocumentReadiness.id, row.id), eq(caseDocumentReadiness.clinicId, input.clinicId)));

  // Slice A1 hook — when screening is now complete, refresh the current
  // UNSIGNED canonical Order Note from the projected evidence. Best-effort,
  // flag-gated, and non-throwing: a refresh failure must never reverse the
  // committed screening completion. Dynamic import avoids a module cycle
  // (orderNoteRefresh reads getCurrentScreeningEvidence from this file).
  if (complete) {
    try {
      const { refreshUnsignedOrderNoteForCase } = await import("../ancillaryDocuments/orderNoteRefresh");
      await refreshUnsignedOrderNoteForCase({
        clinicId: input.clinicId,
        ancillaryCaseId: ev.ancillaryCaseId,
        actorUserId: ev.capture.documentedByUserId,
        source: "screening_evidence_completed",
      });
    } catch (e) {
      console.error(
        JSON.stringify({ level: "error", source: "screening_evidence", kind: "order_note_refresh_threw", message: (e as { message?: string })?.message ?? "error" }),
      );
    }
  }

  return complete
    ? { status: "completed", readinessId: row.id, version }
    : { status: "incomplete", readinessId: row.id, version, missing };
}

export type ScreeningContext = {
  clinicId: number;
  ancillaryCaseId: number;
  serviceType: string;
  questionnaire: Questionnaire | null;
  questionnaireVersion: string | null;
  screeningReadinessId: number;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  current: { version: string; completedAt: string | null; completedByRole: string | null } | null;
};

export type EnsureScreeningContextResult =
  | { status: "ok"; context: ScreeningContext }
  | { status: "case_not_found" }
  | { status: "cross_clinic_denied" }
  | { status: "unsupported_service" };

function questionnaireForService(serviceType: string): { q: Questionnaire; v: string } | null {
  const s = (serviceType || "").toLowerCase();
  if (s.includes("brain")) return { q: "brainwave", v: BRAINWAVE_QUESTIONNAIRE_VERSION };
  if (s.includes("vital")) return { q: "vitalwave", v: VITALWAVE_QUESTIONNAIRE_VERSION };
  return null;
}

/**
 * A0-UI support: resolve (or create) the screening_form readiness row for a
 * canonical ancillary case + service and return the ids the ACS/PCS screening
 * UI needs to submit structured evidence. Fully clinic-scoped; never writes
 * cross-clinic. Creating the readiness row is idempotent (reuses an existing
 * screening_form row for the same case identity + service).
 */
export async function ensureScreeningContext(args: {
  clinicId: number;
  ancillaryCaseId: number;
}): Promise<EnsureScreeningContextResult> {
  const acase = await getAncillaryCaseById(args.ancillaryCaseId);
  if (!acase) return { status: "case_not_found" };
  if (acase.clinicId !== args.clinicId) return { status: "cross_clinic_denied" };

  const q = questionnaireForService(acase.serviceType);
  if (!q) return { status: "unsupported_service" };

  const executionCaseId = (acase as { executionCaseId?: number | null }).executionCaseId ?? null;
  const patientScreeningId = (acase as { originatingScreeningId?: number | null }).originatingScreeningId ?? null;

  // Find an existing screening_form readiness row for this case identity.
  const rows = await db
    .select()
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.clinicId, args.clinicId),
        eq(caseDocumentReadiness.serviceType, acase.serviceType),
        eq(caseDocumentReadiness.documentType, "screening_form"),
      ),
    );
  let row = rows.find(
    (r) =>
      (executionCaseId != null && r.executionCaseId === executionCaseId) ||
      (patientScreeningId != null && r.patientScreeningId === patientScreeningId),
  );

  if (!row) {
    [row] = await db
      .insert(caseDocumentReadiness)
      .values({
        clinicId: args.clinicId,
        executionCaseId,
        patientScreeningId,
        serviceType: acase.serviceType,
        documentType: "screening_form",
        documentStatus: "missing",
      })
      .returning();
  }

  const current = await getCurrentScreeningEvidence({
    clinicId: args.clinicId,
    ancillaryCaseId: args.ancillaryCaseId,
    serviceType: acase.serviceType,
  });

  return {
    status: "ok",
    context: {
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId,
      serviceType: acase.serviceType,
      questionnaire: q.q,
      questionnaireVersion: q.v,
      screeningReadinessId: row.id,
      patientScreeningId,
      executionCaseId,
      current: current
        ? {
            version: current.version,
            completedAt: current.evidence.capture.documentedAt ?? null,
            completedByRole: current.evidence.capture.documentedByRole ?? null,
          }
        : null,
    },
  };
}

/**
 * Read primitive for A1 / Slice C: the CURRENT completed structured screening
 * evidence for an exact case+service+clinic, plus its FULL version. Returns
 * null when no completed structured evidence exists (a PDF/flag-only
 * completion returns null — it never satisfies the future signing gate).
 */
export async function getCurrentScreeningEvidence(args: {
  clinicId: number;
  ancillaryCaseId: number;
  serviceType: string;
}): Promise<{ evidence: AncillaryScreeningEvidence; version: string; readinessId: number } | null> {
  const rows = await db
    .select()
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.clinicId, args.clinicId),
        eq(caseDocumentReadiness.serviceType, args.serviceType),
        eq(caseDocumentReadiness.documentType, "screening_form"),
        eq(caseDocumentReadiness.documentStatus, "completed"),
      ),
    );
  for (const r of rows) {
    const meta = (r.metadata as Record<string, unknown>) ?? {};
    const parsed = ancillaryScreeningEvidenceSchema.safeParse(meta.screeningEvidence);
    if (parsed.success && parsed.data.ancillaryCaseId === args.ancillaryCaseId) {
      const version = typeof meta.screeningEvidenceVersion === "string"
        ? meta.screeningEvidenceVersion
        : screeningEvidenceVersion(parsed.data);
      return { evidence: parsed.data, version, readinessId: r.id };
    }
  }
  return null;
}
