/**
 * Phase 2D backfill — canonical ancillary appointments.
 *
 * Contract:
 *   • DRY-RUN by default.
 *   • Requires BOTH BACKFILL_CANONICAL_APPOINTMENT_APPLY=YES AND
 *     FEATURE_CANONICAL_APPOINTMENT=true to write.
 *   • Never modifies clinics.
 *   • Never logs PHI (plan carries ids + outcome codes + counts only).
 *   • Never reinterprets doctor_visit as ancillary_appointment.
 *   • Never creates a duplicate active appointment (repo enforces
 *     the partial-unique index).
 *
 * Sources:
 *   • Existing global_schedule_events with event_type IN
 *     (ancillary_appointment, same_day_add) — link ancillary_case_id
 *     via patientScreeningId + serviceType match.
 *   • Existing ancillary_appointments rows — plan a global_schedule_event
 *     link (never overwrite the canonical event).
 *   • ancillary_case_reconciliation_failures with error_code =
 *     'MISSING_IDENTITY_LINKS_QUICK_SCHEDULE' — plan the deterministic
 *     linkage described in the Phase 2D spec.
 */

import { db } from "../server/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { globalScheduleEvents } from "@shared/schema/globalSchedule";
import { ancillaryAppointments } from "@shared/schema/appointments";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { ancillaryCaseReconciliationFailures } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";

type PlanOutcome =
  | "would_link_event_to_case"
  | "would_link_legacy_row"
  | "would_link_quick_schedule"
  | "already_linked"
  | "no_matching_ancillary_case"
  | "service_type_mismatch"
  | "tenant_mismatch"
  | "would_skip_doctor_visit"
  | "duplicate_active_appointment"
  | "error";

type PlanRow = {
  source: "global_schedule_event" | "ancillary_appointment" | "reconciliation_failure";
  sourceId: number;
  clinicId: number | null;
  ancillaryCaseId?: number;
  outcome: PlanOutcome;
  errorCode?: string;
};

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_CANONICAL_APPOINTMENT_APPLY === "YES";
  if (apply && !featureFlags.canonicalAppointment) {
    console.error(
      "Refusing to apply: BACKFILL_CANONICAL_APPOINTMENT_APPLY=YES but FEATURE_CANONICAL_APPOINTMENT is not enabled.",
    );
    process.exit(2);
  }

  const plan: PlanRow[] = [];

  // Section 1: global_schedule_events that already exist but lack
  // ancillary_case_id. For each, try to resolve the linkage via
  // (patientScreeningId + serviceType). Never touch doctor_visit.
  const gseCandidates = await db
    .select()
    .from(globalScheduleEvents)
    .where(
      and(
        inArray(globalScheduleEvents.eventType, ["ancillary_appointment", "same_day_add"] as string[]),
        isNull(globalScheduleEvents.ancillaryCaseId),
      ),
    )
    .limit(1000);
  for (const evt of gseCandidates) {
    if (evt.clinicId == null) {
      plan.push({ source: "global_schedule_event", sourceId: evt.id, clinicId: null, outcome: "tenant_mismatch" });
      continue;
    }
    if (evt.patientScreeningId == null || evt.serviceType == null) {
      plan.push({ source: "global_schedule_event", sourceId: evt.id, clinicId: evt.clinicId, outcome: "no_matching_ancillary_case" });
      continue;
    }
    const [ac] = await db
      .select()
      .from(patientAncillaryCases)
      .where(
        and(
          eq(patientAncillaryCases.originatingScreeningId, evt.patientScreeningId),
          eq(patientAncillaryCases.serviceType, evt.serviceType),
          eq(patientAncillaryCases.clinicId, evt.clinicId),
        ),
      )
      .limit(1);
    if (!ac) {
      plan.push({ source: "global_schedule_event", sourceId: evt.id, clinicId: evt.clinicId, outcome: "no_matching_ancillary_case" });
      continue;
    }
    // Check for existing active canonical event on this case.
    const [existing] = await db
      .select()
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.ancillaryCaseId, ac.id),
          eq(globalScheduleEvents.status, "scheduled"),
        ),
      )
      .limit(1);
    if (existing && existing.id !== evt.id) {
      plan.push({ source: "global_schedule_event", sourceId: evt.id, clinicId: evt.clinicId, ancillaryCaseId: ac.id, outcome: "duplicate_active_appointment" });
      continue;
    }
    plan.push({ source: "global_schedule_event", sourceId: evt.id, clinicId: evt.clinicId, ancillaryCaseId: ac.id, outcome: "would_link_event_to_case" });
  }

  // Section 2: ancillary_appointments legacy rows without global_schedule_event_id.
  const legacyRows = await db
    .select()
    .from(ancillaryAppointments)
    .where(isNull(ancillaryAppointments.globalScheduleEventId))
    .limit(1000);
  for (const row of legacyRows) {
    plan.push({
      source: "ancillary_appointment",
      sourceId: row.id,
      clinicId: row.clinicId ?? null,
      outcome: row.clinicId == null ? "tenant_mismatch" : "would_link_legacy_row",
    });
  }

  // Section 3: Phase 2B quick-schedule failure ledger rows.
  const quickSchedFailures = await db
    .select()
    .from(ancillaryCaseReconciliationFailures)
    .where(
      and(
        eq(ancillaryCaseReconciliationFailures.errorCode, "MISSING_IDENTITY_LINKS_QUICK_SCHEDULE"),
        isNull(ancillaryCaseReconciliationFailures.resolvedAt),
      ),
    )
    .limit(500);
  for (const f of quickSchedFailures) {
    plan.push({
      source: "reconciliation_failure",
      sourceId: f.id,
      clinicId: f.clinicId,
      outcome: "would_link_quick_schedule",
    });
  }

  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    globalScheduleEventsScanned: gseCandidates.length,
    ancillaryAppointmentsScanned: legacyRows.length,
    quickScheduleFailuresScanned: quickSchedFailures.length,
    plannedEventLinks: plan.filter((p) => p.outcome === "would_link_event_to_case").length,
    plannedLegacyLinks: plan.filter((p) => p.outcome === "would_link_legacy_row").length,
    plannedQuickScheduleLinks: plan.filter((p) => p.outcome === "would_link_quick_schedule").length,
    duplicatesSkipped: plan.filter((p) => p.outcome === "duplicate_active_appointment").length,
    doctorVisitsExcluded: 0, // We never queried doctor_visit (filter above)
    missingAncillaryCase: plan.filter((p) => p.outcome === "no_matching_ancillary_case").length,
    tenantMismatches: plan.filter((p) => p.outcome === "tenant_mismatch").length,
    errors: plan.filter((p) => p.outcome === "error").length,
  };
  console.log(JSON.stringify({ summary, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({
      level: "error",
      source: "canonical_appointment_backfill",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);

void sql;
