/**
 * Phase 2G — canonical case-scoped billing-READINESS evaluator.
 *
 * Identity is EXACT (clinicId + ancillaryCaseId) — never screening/service,
 * execution/service, procedure/service, or first/newest. Every evidence read is
 * exact and CURRENT (non-superseded); a NULL/mismatched dimension FAILS CLOSED.
 * Always-hard ownership / procedure / document / signature requirements are
 * NEVER overrideable. Service-specific requirements are CONFIGURATION-DRIVEN
 * (ancillary_service_prerequisite_config, stage='billing_readiness') — never the
 * legacy universal rules. Each evaluation persists a truthful, PHI-free snapshot
 * and supersedes the prior current evaluation atomically (with any required
 * override audit in the SAME transaction). Runs ONLY under
 * billingReadinessRuntimeEnabled(); OFF ⇒ zero migration-0055 reads/writes.
 */

import { db } from "../../db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { billingReadinessChecks } from "@shared/schema/billingReadiness";
import { ancillaryDocumentReferences } from "@shared/schema/ancillaryDocuments";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { listActivePrerequisiteConfigs } from "../../repositories/procedurePrerequisites.repo";
import { billingReadinessRuntimeEnabled } from "../../lib/featureFlags";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);
const ACCEPTABLE_REPORT_STATUSES = new Set(["uploaded", "generated", "approved", "completed", "signed"]);
const TERMINAL_INVALIDATION = new Set(["cancelled", "no_show", "unable_to_complete"]);
export const BILLING_READINESS_STAGE = "billing_readiness";
export const BILLING_EVALUATOR_VERSION = "billing_readiness_v1";

export type BillingBlocker = { code: string; category: string; detail: string };
export type AppliedOverride = { code: string; reason: string; actorUserId: string; role: string };

export type BillingReadinessOverride = { reason: string; requirementCodes: string[] };
export type BillingReadinessActor = { userId: string; role: string };

export type EvaluateBillingReadinessInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actor?: BillingReadinessActor | null;
  source: string;
  override?: BillingReadinessOverride | null;
};

export type BillingReadinessResult = {
  status:
    | "missing_requirements" | "ready_to_generate"
    | "billing_document_pending" | "billing_document_generated"
    | "superseded" | "invalidated" | "migration_missing"
    | "skipped_flag_off" | "case_not_found" | "cross_clinic_denied"
    | "not_active" | "not_admin_approved" | "override_not_recorded";
  readinessCheckId?: number;
  billingReady?: boolean;
  claimSubmissionReady?: boolean;
  billingBlockers?: BillingBlocker[];
  claimBlockers?: BillingBlocker[];
  warnings?: BillingBlocker[];
  appliedOverrides?: AppliedOverride[];
  evidenceFingerprint?: string;
};

type NoteRow = typeof procedureNotes.$inferSelect;
type RefRow = typeof ancillaryDocumentReferences.$inferSelect;

/** Deterministic PHI-free fingerprint of the EXACT evidence (ids + statuses). */
function fingerprint(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => (p == null ? "-" : String(p))).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `bef_${h.toString(16)}`;
}

/** Read the EXACT current (non-superseded) reference of a kind for the case. */
async function currentRef(clinicId: number, ancillaryCaseId: number, kind: string): Promise<RefRow | null> {
  const rows = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
    eq(ancillaryDocumentReferences.documentKind, kind),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).orderBy(desc(ancillaryDocumentReferences.actualCreatedAt)).limit(1);
  return rows[0] ?? null;
}

export async function evaluateCanonicalBillingReadiness(input: EvaluateBillingReadinessInput): Promise<BillingReadinessResult> {
  if (!billingReadinessRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const acase = await getAncillaryCaseById(input.ancillaryCaseId);
    if (!acase) return { status: "case_not_found" };
    if (acase.clinicId !== input.clinicId) return { status: "cross_clinic_denied" };
    if (!ACTIVE_LIFECYCLE.has(acase.lifecycleStatus)) return { status: "not_active" };
    // Frozen flow: never bypass Admin Review.
    if (acase.adminReviewStatus !== "approved") return { status: "not_admin_approved" };
    const service = acase.serviceType;

    const billingBlockers: BillingBlocker[] = [];
    const claimBlockers: BillingBlocker[] = [];
    const warnings: BillingBlocker[] = [];
    const appliedOverrides: AppliedOverride[] = [];

    // ── Always-hard evidence (NEVER overrideable) ───────────────────────────
    // Exact completed canonical procedure event for THIS case.
    const peRows = await db.select().from(procedureEvents).where(and(
      eq(procedureEvents.ancillaryCaseId, input.ancillaryCaseId),
      eq(procedureEvents.clinicId, input.clinicId),
    )).orderBy(desc(procedureEvents.completedAt));
    const serviceEvents = peRows.filter((r) => r.serviceType === service);
    const terminalInvalid = serviceEvents.find((r) => r.procedureStatus != null && TERMINAL_INVALIDATION.has(r.procedureStatus));
    const completed = serviceEvents.filter((r) => r.procedureStatus === "complete" && r.completedAt != null);
    const pe = completed[0] ?? null;
    if (terminalInvalid && !pe) billingBlockers.push({ code: "procedure_terminally_invalidated", category: "hard_procedure_blocker", detail: terminalInvalid.procedureStatus });
    if (!pe) billingBlockers.push({ code: "exact_complete_procedure_missing", category: "hard_procedure_blocker", detail: "no complete procedure event with completedAt" });

    // Exact current report reference.
    const reportRef = await currentRef(input.clinicId, input.ancillaryCaseId, "report");
    const reportOk = reportRef != null && reportRef.serviceType === service && ACCEPTABLE_REPORT_STATUSES.has(reportRef.documentStatus);
    if (!reportOk) billingBlockers.push({ code: "exact_current_report_missing", category: "hard_procedure_blocker", detail: reportRef ? reportRef.documentStatus : "none" });

    // Exact current Procedure Note reference + SIGNED note + synchronized reference.
    const pnRef = await currentRef(input.clinicId, input.ancillaryCaseId, "procedure_note");
    let pnNote: NoteRow | null = null;
    if (pnRef) { const [n] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, pnRef.sourceId)).limit(1); pnNote = n ?? null; }
    if (!pnRef || !pnNote) {
      billingBlockers.push({ code: "exact_procedure_note_missing", category: "hard_procedure_blocker", detail: "none" });
    } else if (pnNote.signatureStatus !== "signed" || pnNote.signedAt == null) {
      billingBlockers.push({ code: "procedure_note_unsigned", category: "hard_procedure_blocker", detail: pnNote.signatureStatus ?? "unsigned" });
    } else if (pnRef.documentStatus !== "signed" || pnRef.signedAt == null) {
      // Note signed but its exact reference is not synchronized → block.
      billingBlockers.push({ code: "procedure_note_reference_unsynchronized", category: "hard_procedure_blocker", detail: pnRef.documentStatus });
    }

    // Exact current Order Note reference + configured signature requirement.
    const onRef = await currentRef(input.clinicId, input.ancillaryCaseId, "order_note");
    if (!onRef) {
      billingBlockers.push({ code: "exact_order_note_missing", category: "hard_procedure_blocker", detail: "none" });
    } else {
      const sigReq = await resolveOrderNoteSignatureRequirement(input.clinicId, service);
      if (sigReq === "required") {
        if (onRef.documentStatus !== "signed" || onRef.signedAt == null) billingBlockers.push({ code: "order_note_signature_required_unsigned", category: "hard_procedure_blocker", detail: onRef.documentStatus });
      } else if (sigReq === "not_required") {
        // A current generated/approved/signed Order Note reference qualifies.
        if (!["signed", "pending_signature", "uploaded"].includes(onRef.documentStatus)) billingBlockers.push({ code: "order_note_not_current", category: "billing_blocker", detail: onRef.documentStatus });
      } else {
        // unresolved → billing blocker (NEVER assume signature is unnecessary).
        billingBlockers.push({ code: "order_note_signature_unresolved", category: "billing_blocker", detail: "unresolved" });
      }
    }

    // ── Configured service-specific requirements (config-driven) ────────────
    const overrideCodes = new Set(input.override?.requirementCodes ?? []);
    let configs: Awaited<ReturnType<typeof listActivePrerequisiteConfigs>> = [];
    try { configs = await listActivePrerequisiteConfigs(input.clinicId, service, BILLING_READINESS_STAGE); } catch { configs = []; }
    for (const cfg of configs) {
      if (!cfg.active || !cfg.required) continue;
      const satisfied = await isRequirementSatisfied(input.clinicId, input.ancillaryCaseId, cfg.requirementCode);
      if (satisfied) continue;
      // Attempt an EXPLICIT override (role alone never overrides).
      if (overrideCodes.has(cfg.requirementCode)) {
        const applied = tryApplyOverride(cfg, input);
        if (applied) { appliedOverrides.push(applied); continue; }
      }
      const detail = "requirement_unsatisfied";
      switch (cfg.blockerCategory) {
        case "hard_procedure_blocker": billingBlockers.push({ code: cfg.requirementCode, category: cfg.blockerCategory, detail }); break;
        case "billing_blocker": billingBlockers.push({ code: cfg.requirementCode, category: cfg.blockerCategory, detail }); break;
        case "claim_submission_blocker": claimBlockers.push({ code: cfg.requirementCode, category: cfg.blockerCategory, detail }); break;
        default: warnings.push({ code: cfg.requirementCode, category: cfg.blockerCategory, detail }); break;
      }
    }

    const billingReady = billingBlockers.length === 0;
    const claimSubmissionReady = billingReady && claimBlockers.length === 0;
    const status: BillingReadinessResult["status"] = billingReady ? "ready_to_generate" : "missing_requirements";

    // Persist snapshot + supersede prior current + required override audit — ATOMIC.
    const fp = fingerprint([
      "v1", input.ancillaryCaseId, service, pe?.id, pe?.completedAt?.toISOString(),
      reportRef?.id, reportRef?.documentStatus, onRef?.id, onRef?.documentStatus, onRef?.signedAt?.toISOString(),
      pnRef?.id, pnRef?.documentStatus, pnRef?.signedAt?.toISOString(),
      configs.map((c) => c.requirementCode).sort().join(","),
      appliedOverrides.map((o) => o.code).sort().join(","),
    ]);
    const evidenceSnapshot = {
      ancillary_case_id: input.ancillaryCaseId, clinic_id: input.clinicId, service_type: service,
      procedure_event_id: pe?.id ?? null, procedure_completed_at: pe?.completedAt?.toISOString() ?? null,
      report_reference_id: reportRef?.id ?? null, report_status: reportRef?.documentStatus ?? null,
      order_note_reference_id: onRef?.id ?? null, order_note_status: onRef?.documentStatus ?? null, order_note_signed_at: onRef?.signedAt?.toISOString() ?? null,
      procedure_note_reference_id: pnRef?.id ?? null, procedure_note_status: pnRef?.documentStatus ?? null, procedure_note_signed_at: pnRef?.signedAt?.toISOString() ?? null,
      requirement_version: BILLING_EVALUATOR_VERSION,
    };
    const overrideAuditRequired = appliedOverrides.length > 0 && configs.some((c) => appliedOverrides.some((o) => o.code === c.requirementCode) && c.overrideAuditRequired);

    let readinessCheckId: number | undefined;
    try {
      readinessCheckId = await db.transaction(async (tx) => {
        const now = new Date();
        // Supersede any prior CURRENT canonical evaluation for this exact case.
        await tx.update(billingReadinessChecks)
          .set({ canonicalStatus: "superseded", supersededAt: now, updatedAt: now })
          .where(and(
            eq(billingReadinessChecks.ancillaryCaseId, input.ancillaryCaseId),
            eq(billingReadinessChecks.clinicId, input.clinicId),
            isNull(billingReadinessChecks.supersededAt),
          ));
        const [row] = await tx.insert(billingReadinessChecks).values({
          clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId,
          globalPlexusPatientId: acase.globalPlexusPatientId ?? null, patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
          executionCaseId: acase.executionCaseId ?? null, patientScreeningId: acase.originatingScreeningId ?? null,
          procedureEventId: pe?.id ?? null, serviceType: service,
          reportDocumentReferenceId: reportRef?.id ?? null, orderNoteDocumentReferenceId: onRef?.id ?? null, procedureNoteDocumentReferenceId: pnRef?.id ?? null,
          readinessStatus: billingReady ? "ready_to_generate" : "missing_requirements",
          canonicalStatus: status, missingRequirements: billingBlockers as never,
          billingBlockers: billingBlockers as never, claimBlockers: claimBlockers as never, warnings: warnings as never,
          appliedOverrides: appliedOverrides as never, evidenceSnapshot: evidenceSnapshot as never,
          requirementVersion: BILLING_EVALUATOR_VERSION, evidenceFingerprint: fp, evaluatorVersion: BILLING_EVALUATOR_VERSION,
          evaluatedAt: now, readyAt: billingReady ? now : null,
          actorUserId: input.actor?.userId ?? null, sourceSystem: input.source,
        }).returning();
        // Required override audit MUST commit in the same transaction.
        if (overrideAuditRequired) {
          await tx.insert(patientJourneyEvents).values({
            patientName: "[billing_readiness_audit]", patientDob: null,
            patientScreeningId: acase.originatingScreeningId ?? null, executionCaseId: acase.executionCaseId ?? null,
            eventType: "billing_readiness_override_applied", eventSource: "billing_readiness_evaluator", actorUserId: input.actor?.userId ?? null,
            summary: `Billing readiness override (${service})`, metadata: { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, overrides: appliedOverrides },
          });
        }
        return row.id as number;
      });
    } catch (e) {
      if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
      // The atomic snapshot (+required override audit) did not commit.
      return { status: "override_not_recorded", billingBlockers, claimBlockers, warnings };
    }

    return { status, readinessCheckId, billingReady, claimSubmissionReady, billingBlockers, claimBlockers, warnings, appliedOverrides, evidenceFingerprint: fp };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    throw e;
  }
}

/** Resolve the configured Order Note signature requirement for a service.
 *  A config row `order_note_signature` at stage billing_readiness with
 *  required=false ⇒ not_required; required=true ⇒ required; NO row ⇒ unresolved
 *  (billing blocker — never assume signature is unnecessary). */
async function resolveOrderNoteSignatureRequirement(clinicId: number, service: string): Promise<"required" | "not_required" | "unresolved"> {
  let configs: Awaited<ReturnType<typeof listActivePrerequisiteConfigs>> = [];
  try { configs = await listActivePrerequisiteConfigs(clinicId, service, BILLING_READINESS_STAGE); } catch { return "unresolved"; }
  const cfg = configs.find((c) => c.requirementCode === "order_note_signature" && c.active);
  if (!cfg) return "unresolved";
  return cfg.required ? "required" : "not_required";
}

/** EXACT evidence check for a configured requirement. Only requirement codes we
 *  can PROVE from exact current evidence are ever considered satisfied; anything
 *  we cannot prove stays a blocker of its configured category (never fabricated).
 */
async function isRequirementSatisfied(clinicId: number, ancillaryCaseId: number, code: string): Promise<boolean> {
  if (code === "consent") return (await currentRef(clinicId, ancillaryCaseId, "consent")) != null;
  if (code === "screening_form") return (await currentRef(clinicId, ancillaryCaseId, "screening_form")) != null;
  // order_note_signature is handled by resolveOrderNoteSignatureRequirement, not here.
  if (code === "order_note_signature") return true;
  return false;
}

/** Apply an EXPLICIT override for a configured requirement. Role eligibility
 *  alone never overrides — the requirement must be override-allowed, the actor
 *  role explicitly listed, and a non-empty reason supplied. Actor identity comes
 *  from the authenticated server context (input.actor), never the request body. */
function tryApplyOverride(cfg: { requirementCode: string; overrideAllowed: boolean; overrideRoles: string | null }, input: EvaluateBillingReadinessInput): AppliedOverride | null {
  const reason = (input.override?.reason ?? "").trim();
  if (!reason) return null;
  if (!cfg.overrideAllowed) return null;
  const actor = input.actor;
  if (!actor || !actor.userId || !actor.role) return null;
  const roles = (cfg.overrideRoles ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (!roles.includes(actor.role)) return null;
  return { code: cfg.requirementCode, reason, actorUserId: actor.userId, role: actor.role };
}
