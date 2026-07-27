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

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);
const SATISFIED_DOC_STATUSES = new Set(["uploaded", "generated", "approved", "completed", "signed"]);
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type PrerequisiteBlocker = {
  requirementCode: string;
  category: string;
  overrideable: boolean;
};

export type EvaluateProcedurePrerequisitesInput = {
  clinicId: number;
  ancillaryCaseId: number;
  stage: string;
  actorRole?: string | null;
};

export type EvaluateProcedurePrerequisitesResult = {
  allowed: boolean;
  hardBlockers: PrerequisiteBlocker[];
  warnings: PrerequisiteBlocker[];
  billingBlockers: PrerequisiteBlocker[];
  claimBlockers: PrerequisiteBlocker[];
  overrideableBlockers: PrerequisiteBlocker[];
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
  return { allowed: false, hardBlockers: [], warnings: [], billingBlockers: [], claimBlockers: [], overrideableBlockers: [], reasons: [] };
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

    // ── ALWAYS-HARD checks (only at procedure_start) ──
    if (startStage) {
      if (!ACTIVE_LIFECYCLE.has(acase.lifecycleStatus)) {
        result.hardBlockers.push({ requirementCode: "active_ancillary_case", category: "hard_procedure_blocker", overrideable: false });
      }
      const appt = await isOrderNoteAppointmentEligible({ ancillaryCaseId: acase.id });
      if (appt.eligible) result.qualifyingAppointmentId = appt.event.id;
      else result.hardBlockers.push({ requirementCode: "valid_canonical_appointment", category: "hard_procedure_blocker", overrideable: false });
    }

    // ── Configured, service-specific requirements ──
    const configs = await listActivePrerequisiteConfigs(input.clinicId, acase.serviceType, input.stage);
    if (configs.length > 0) {
      const satisfied = await loadSatisfiedDocumentTypes(acase);
      const roles = (input.actorRole ?? "").trim();
      for (const cfg of configs) {
        if (!cfg.required) continue;
        if (satisfied.has(cfg.requirementCode)) continue;
        const overrideable = cfg.overrideAllowed && cfg.overrideRoles != null && roles.length > 0
          && cfg.overrideRoles.split(",").map((r) => r.trim()).includes(roles);
        const blocker: PrerequisiteBlocker = { requirementCode: cfg.requirementCode, category: cfg.blockerCategory, overrideable };
        if (overrideable) result.overrideableBlockers.push(blocker);
        switch (cfg.blockerCategory) {
          case "hard_procedure_blocker": if (!overrideable) result.hardBlockers.push(blocker); break;
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
  const conds = [eq(caseDocumentReadiness.serviceType, acase.serviceType)];
  if (acase.originatingScreeningId != null) conds.push(eq(caseDocumentReadiness.patientScreeningId, acase.originatingScreeningId));
  else if (acase.executionCaseId != null) conds.push(eq(caseDocumentReadiness.executionCaseId, acase.executionCaseId));
  else return new Set();
  const rows = await db.select().from(caseDocumentReadiness).where(and(...conds));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.clinicId != null && r.clinicId !== acase.clinicId) continue; // tenant guard
    if (SATISFIED_DOC_STATUSES.has(r.documentStatus)) set.add(r.documentType);
  }
  return set;
}
