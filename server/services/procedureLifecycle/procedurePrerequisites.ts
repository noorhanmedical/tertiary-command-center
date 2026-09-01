/**
 * Phase 2F-B — configurable service-specific procedure prerequisite evaluation.
 *
 * Consent / insurance / authorization / coding are NOT universal procedure
 * blockers. Each requirement's effect is driven by the clinic's (or platform
 * default) `ancillary_service_prerequisite_config`: hard procedure blocker,
 * soft operational warning, documentation follow-up, billing blocker, or
 * claim-submission blocker. Only ALWAYS-HARD checks (tenancy, active case,
 * valid canonical appointment, unresolved identity when applicable) are
 * unconditional. Overrides apply only when configured, for an explicitly
 * allowed role, with a non-empty reason (audited by the caller).
 *
 * Feature (canonicalProcedureLifecycle) OFF ⇒ zero Phase 2F reads; returns
 * allowed=true so legacy scheduling/completion behavior is unchanged.
 */

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { featureFlags } from "../../lib/featureFlags";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { listActivePrerequisiteConfigs } from "../../repositories/procedurePrerequisites.repo";
import { isOrderNoteAppointmentEligible } from "../canonicalAppointments/canonicalAppointmentService";
import { getCurrentScreeningEvidence } from "../screening/screeningEvidenceService";
import { getActiveOrderNoteForCase } from "../../repositories/orderNoteLifecycle.repo";
import { orderNoteRequiresStructuredScreening, procedureRequiresSignedOrderNote } from "../ancillaryDocuments/orderNoteServiceConfig";
import { evaluateSignedOrderNoteFreshness } from "../ancillaryDocuments/orderNoteFreshness";
import { applySemanticPrerequisites } from "./procedurePrerequisiteRules";
export { applySemanticPrerequisites, type SemanticPrereqContext } from "./procedurePrerequisiteRules";

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);
const SATISFIED_DOC_STATUSES = new Set(["uploaded", "generated", "approved", "completed", "signed"]);
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type PrerequisiteBlocker = {
  requirementCode: string;
  category: string;
  overrideable: boolean;
};

export type AppliedOverride = {
  requirementCode: string;
  category: string;
  auditRequired: boolean;
};

export type ProcedureOverrideRequest = {
  reason: string;
  requirementCodes: string[];
};

export type EvaluateProcedurePrerequisitesInput = {
  clinicId: number;
  ancillaryCaseId: number;
  stage: string;
  actorRole?: string | null;
  // An EXPLICIT override request. Role eligibility ALONE never overrides; only
  // requirements named here, with a non-empty reason, and permitted by config
  // for the actor's role, are actually overridden.
  override?: ProcedureOverrideRequest | null;
};

export type EvaluateProcedurePrerequisitesResult = {
  allowed: boolean;
  hardBlockers: PrerequisiteBlocker[];
  warnings: PrerequisiteBlocker[];
  billingBlockers: PrerequisiteBlocker[];
  claimBlockers: PrerequisiteBlocker[];
  overrideableBlockers: PrerequisiteBlocker[];
  appliedOverrides: AppliedOverride[];
  evidenceCaseId?: number;
  qualifyingAppointmentId?: number;
  serviceType?: string | null;
  reasons: string[];
  migrationMissing?: boolean;
  flagOff?: boolean;
  caseNotFound?: boolean;
  crossClinic?: boolean;
};

function base(): EvaluateProcedurePrerequisitesResult {
  return { allowed: false, hardBlockers: [], warnings: [], billingBlockers: [], claimBlockers: [], overrideableBlockers: [], appliedOverrides: [], reasons: [] };
}

export async function evaluateProcedurePrerequisites(
  input: EvaluateProcedurePrerequisitesInput,
): Promise<EvaluateProcedurePrerequisitesResult> {
  // Lifecycle OFF ⇒ zero Phase 2F reads; legacy behavior is not blocked.
  if (!featureFlags.canonicalProcedureLifecycle) {
    return { ...base(), allowed: true, flagOff: true };
  }
  try {
    const acase = await getAncillaryCaseById(input.ancillaryCaseId);
    if (!acase) return { ...base(), caseNotFound: true, reasons: ["ancillary_case_not_found"] };
    if (acase.clinicId !== input.clinicId) return { ...base(), crossClinic: true, reasons: ["cross_clinic_denied"] };

    const result = base();
    result.serviceType = acase.serviceType;
    result.evidenceCaseId = acase.id;
    const startStage = input.stage === "procedure_start";

    // ── ALWAYS-HARD checks (only at procedure_start; never overrideable) ──
    if (startStage) {
      if (!ACTIVE_LIFECYCLE.has(acase.lifecycleStatus)) {
        result.hardBlockers.push({ requirementCode: "active_ancillary_case", category: "hard_procedure_blocker", overrideable: false });
      }
      // Unresolved canonical patient identity (when the Plexus identity write
      // path is engaged) is an always-hard, non-overrideable blocker.
      if (featureFlags.plexusIdentityWrite && acase.globalPlexusPatientId == null) {
        result.hardBlockers.push({ requirementCode: "unresolved_canonical_identity", category: "hard_procedure_blocker", overrideable: false });
      }
      const appt = await isOrderNoteAppointmentEligible({ ancillaryCaseId: acase.id });
      if (appt.eligible) result.qualifyingAppointmentId = appt.event.id;
      else result.hardBlockers.push({ requirementCode: "valid_canonical_appointment", category: "hard_procedure_blocker", overrideable: false });

      // Post-signature FRESHNESS (always-hard; never overrideable). A signed
      // Order Note authorizes the procedure ONLY while it is still fresh against
      // current canonical evidence. If the active signed note has gone materially
      // stale (evidence fingerprint drift after signature), the procedure MUST NOT
      // proceed on the stale authorization — a re-reviewed/re-signed v2 is
      // required. Fail-closed and service-agnostic (config-driven: applies to any
      // service that requires a signed Order Note for its procedure). The
      // "unsigned / no signed note" case is handled by the order_note_signature
      // requirement below; this only fires when a signed note EXISTS but is stale.
      if (procedureRequiresSignedOrderNote(acase.serviceType)) {
        const freshness = await evaluateSignedOrderNoteFreshness({ clinicId: input.clinicId, ancillaryCaseId: acase.id });
        if (freshness.hasSignedCurrent && !freshness.fresh) {
          result.hardBlockers.push({ requirementCode: "order_note_review_required", category: "hard_procedure_blocker", overrideable: false });
        }
      }
    }

    // ── Configured, service-specific requirements ──
    const configs = await listActivePrerequisiteConfigs(input.clinicId, acase.serviceType, input.stage);
    if (configs.length > 0) {
      const rawSatisfied = await loadSatisfiedDocumentTypes(acase);
      // Slice E — resolve semantic prerequisites (structured screening + signed
      // Order Note) rather than trusting raw document-type presence. The extra
      // reads run ONLY when the corresponding requirement is configured, so
      // unrelated services/tests incur no new DB access and no behavior change.
      const codes = new Set(configs.map((c) => c.requirementCode));
      // Config-driven (never service-name inference): a service requires a
      // completed structured (A0) screening only when it declares it AND a
      // screening_form requirement is configured for this stage.
      const requiresStructuredScreening =
        orderNoteRequiresStructuredScreening(acase.serviceType) && codes.has("screening_form");
      let structuredScreeningComplete = false;
      if (requiresStructuredScreening) {
        const structured = await getCurrentScreeningEvidence({
          clinicId: input.clinicId,
          ancillaryCaseId: acase.id,
          serviceType: acase.serviceType,
        });
        structuredScreeningComplete = !!structured;
      }
      let currentOrderNoteSigned = false;
      if (codes.has("order_note_signature")) {
        const currentOrderNote = await getActiveOrderNoteForCase(acase.id);
        currentOrderNoteSigned =
          !!currentOrderNote && currentOrderNote.signatureStatus === "signed" && currentOrderNote.clinicId === input.clinicId;
      }
      const satisfied = applySemanticPrerequisites(rawSatisfied, {
        requiresStructuredScreening,
        structuredScreeningComplete,
        currentOrderNoteSigned,
      });
      const roles = (input.actorRole ?? "").trim();
      const req = input.override ?? null;
      const reasonOk = req != null && typeof req.reason === "string" && req.reason.trim().length > 0;
      const requestedCodes = new Set(req?.requirementCodes ?? []);
      for (const cfg of configs) {
        if (!cfg.required) continue;
        if (satisfied.has(cfg.requirementCode)) continue;
        // Role ELIGIBILITY to override (a request could clear it) — not an override.
        const eligible = cfg.overrideAllowed && cfg.overrideRoles != null && roles.length > 0
          && cfg.overrideRoles.split(",").map((r) => r.trim()).includes(roles);
        // ACTUAL override: eligible AND explicitly requested by code AND reason present.
        const overridden = eligible && reasonOk && requestedCodes.has(cfg.requirementCode);
        const blocker: PrerequisiteBlocker = { requirementCode: cfg.requirementCode, category: cfg.blockerCategory, overrideable: eligible };
        if (overridden) {
          result.appliedOverrides.push({ requirementCode: cfg.requirementCode, category: cfg.blockerCategory, auditRequired: cfg.overrideAuditRequired });
          continue; // the hard blocker is cleared by this explicit, authorized override
        }
        if (eligible) result.overrideableBlockers.push(blocker);
        switch (cfg.blockerCategory) {
          case "hard_procedure_blocker": result.hardBlockers.push(blocker); break;
          case "billing_blocker": result.billingBlockers.push(blocker); break;
          case "claim_submission_blocker": result.claimBlockers.push(blocker); break;
          default: result.warnings.push(blocker); break; // soft / documentation
        }
      }
    }

    result.allowed = result.hardBlockers.length === 0;
    return result;
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { ...base(), migrationMissing: true, reasons: ["migration_missing"] };
    throw e;
  }
}

/** Tenant-scoped set of satisfied document types for the case's identity. */
async function loadSatisfiedDocumentTypes(acase: { originatingScreeningId: number | null; executionCaseId: number | null; serviceType: string; clinicId: number }): Promise<Set<string>> {
  // Clinic scope is in the SQL predicate (not only a post-query filter).
  const conds = [eq(caseDocumentReadiness.clinicId, acase.clinicId), eq(caseDocumentReadiness.serviceType, acase.serviceType)];
  if (acase.originatingScreeningId != null) conds.push(eq(caseDocumentReadiness.patientScreeningId, acase.originatingScreeningId));
  else if (acase.executionCaseId != null) conds.push(eq(caseDocumentReadiness.executionCaseId, acase.executionCaseId));
  else return new Set();
  const rows = await db.select().from(caseDocumentReadiness).where(and(...conds));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.clinicId !== acase.clinicId) continue; // defensive tenant guard
    if (SATISFIED_DOC_STATUSES.has(r.documentStatus)) set.add(r.documentType);
  }
  return set;
}
