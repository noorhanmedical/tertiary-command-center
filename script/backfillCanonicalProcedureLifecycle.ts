/**
 * Phase 2F backfill — canonical procedure lifecycle + Procedure Note.
 *
 * Contract:
 *   • DRY-RUN by default. Classifies every completed procedure event and prints
 *     a PHI-free plan (ids + outcome codes + counts). Makes ZERO writes.
 *   • Apply requires ALL of:
 *       BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY=YES
 *       FEATURE_CANONICAL_PROCEDURE_LIFECYCLE=true
 *       FEATURE_CANONICAL_PROCEDURE_NOTE=true
 *       FEATURE_UNIFIED_ANCILLARY_DOCUMENTS=true
 *   • Apply links ONLY deterministic event→case identities (via the canonical
 *     onProcedureCompleted boundary), which preserves the original
 *     completedAt/createdAt, preserves signed bodies/signatures, NEVER generates
 *     bodies, and queues exact generation/reconciliation work.
 *   • Never modifies clinics. Never deletes data. Idempotent.
 *   • Ambiguous / multiple-candidate identities are NEVER first/newest guessed.
 */

import { db } from "../server/db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";
import { onProcedureCompleted } from "../server/services/procedureLifecycle/procedureLifecycleOrchestration";

const APPLY = process.env.BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY === "YES";
const LIMIT = Math.min(Math.max(1, parseInt(process.env.BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_LIMIT ?? "200", 10) || 200), 1000);
const ACTIVE = new Set<string>(ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]);

type Outcome =
  | "already_canonical" | "deterministic_link" | "no_candidate_case" | "multiple_candidate_cases"
  | "cross_clinic_conflict" | "service_mismatch" | "no_clinic" | "applied" | "apply_deferred" | "apply_error";

function canApply(): boolean {
  return APPLY && featureFlags.canonicalProcedureLifecycle && featureFlags.canonicalProcedureNote && featureFlags.unifiedAncillaryDocuments;
}

async function classify(pe: typeof procedureEvents.$inferSelect): Promise<Outcome> {
  if (pe.ancillaryCaseId != null) return "already_canonical";
  if (pe.clinicId == null) return "no_clinic";
  let candidates: (typeof patientAncillaryCases.$inferSelect)[] = [];
  if (pe.executionCaseId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.executionCaseId, pe.executionCaseId));
  else if (pe.patientScreeningId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.originatingScreeningId, pe.patientScreeningId));
  else return "no_candidate_case";
  const sameService = candidates.filter((c) => c.serviceType === pe.serviceType);
  if (sameService.length === 0) return candidates.length > 0 ? "service_mismatch" : "no_candidate_case";
  const sameClinic = sameService.filter((c) => c.clinicId === pe.clinicId);
  if (sameClinic.length === 0) return "cross_clinic_conflict";
  const active = sameClinic.filter((c) => ACTIVE.has(c.lifecycleStatus));
  if (active.length === 0) return "no_candidate_case";
  if (active.length > 1) return "multiple_candidate_cases";
  return "deterministic_link";
}

async function main(): Promise<void> {
  const rows = await db.select().from(procedureEvents)
    .where(and(eq(procedureEvents.procedureStatus, "complete"), isNull(procedureEvents.ancillaryCaseId)))
    .limit(LIMIT);
  const counts: Record<string, number> = {};
  const bump = (o: string) => { counts[o] = (counts[o] ?? 0) + 1; };

  for (const pe of rows) {
    let outcome = await classify(pe);
    if (outcome === "deterministic_link" && canApply()) {
      try {
        const r = await onProcedureCompleted({ procedureEventId: pe.id, expectedClinicId: pe.clinicId ?? null });
        outcome = (r.status === "created" || r.status === "reused" || r.status === "linked_pending_note" || r.status === "not_yet_eligible") ? "applied" : "apply_deferred";
      } catch { outcome = "apply_error"; }
    }
    bump(outcome);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ procedure_event_id: pe.id, clinic_id: pe.clinicId, outcome }));
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ mode: canApply() ? "APPLY" : "DRY_RUN", scanned: rows.length, limit: LIMIT, counts }));
  if (!canApply() && APPLY) {
    // eslint-disable-next-line no-console
    console.error("Refusing to apply: FEATURE_CANONICAL_PROCEDURE_LIFECYCLE / FEATURE_CANONICAL_PROCEDURE_NOTE / FEATURE_UNIFIED_ANCILLARY_DOCUMENTS must all be true.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
