// Machine-outage conflict workflow.
//
// When a temporary override REDUCES a resource's capacity, existing
// appointments may now exceed the machines available. We DETECT those
// conflicts (never auto-cancel) and emit an equipment-outage notification to
// the operationally-relevant people (PCS/ACS covering the facility + admins),
// so they can review and reschedule affected patients using the same
// UnifiedScheduler + call flow.

import { RESOURCE_LABELS } from "@shared/scheduling/capacityDefaults";
import type { ResourceType, TemporaryCapacityOverride } from "@shared/schema/schedulingCapacity";
import { getEffectiveCapacityConfig } from "../../repositories/schedulingCapacity.repo";
import { loadExistingOccupancy } from "./availabilityService";
import {
  findOverCapacityBlocks,
  earliestFit,
  minutesToHHMM,
  type ExistingOccupancy,
} from "@shared/scheduling/availabilityEngine";
import { createNotification } from "../notifications/notificationService";
import { storage } from "../../storage";

export type OutageAffectedAppointment = {
  appointmentId: number | null;
  patient: string;
  time: string;
  service: string;
  resourceType: ResourceType;
  /** Deterministic same-day alternative start, if one exists. */
  nextAvailable: string | null;
};

export type OutageConflictResult = {
  resourceType: ResourceType;
  facility: string;
  affectedDates: string[];
  affected: OutageAffectedAppointment[];
  defaultCapacity: number;
  reducedCapacity: number;
};

/** Every date (YYYY-MM-DD) an override covers, inclusive. */
export function datesInRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;
  // Guard against runaway ranges.
  let guard = 0;
  for (let d = new Date(start); d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

/**
 * Detect appointments that exceed the reduced capacity across the override's
 * dates and (if any) notify the covering team + admins. Returns the conflict
 * detail for the response. Best-effort: notification failure never throws.
 */
export async function detectAndNotifyOutageConflicts(params: {
  clinicId: number;
  facilityName: string;
  override: TemporaryCapacityOverride;
  actorUserId: string | null;
}): Promise<OutageConflictResult | null> {
  const resourceType = params.override.resourceType as ResourceType;
  const base = await getEffectiveCapacityConfig(params.clinicId);
  const defaultCapacity = base[resourceType].machineCount;
  const reducedCapacity = params.override.availableCapacity;

  // A reduction only matters when it drops below the default.
  if (reducedCapacity >= defaultCapacity) return null;

  const dates = datesInRange(params.override.startDate, params.override.endDate);
  const affected: OutageAffectedAppointment[] = [];
  const affectedDates: string[] = [];

  for (const isoDate of dates) {
    const existing = await loadExistingOccupancy({
      facilityName: params.facilityName,
      isoDate,
      capacity: base,
    });
    const over = findOverCapacityBlocks(resourceType, reducedCapacity, existing);
    if (over.length === 0) continue;
    affectedDates.push(isoDate);
    // Capacity with the override applied for computing alternatives.
    const reducedConfig = {
      ...base,
      [resourceType]: { ...base[resourceType], machineCount: reducedCapacity },
    };
    for (const block of over) {
      const next = alternativeStart(block, reducedConfig, existing);
      affected.push({
        appointmentId: block.appointmentId ?? null,
        patient: block.label ?? "Patient",
        time: minutesToHHMM(block.startMinutes),
        service: block.serviceLabel ?? resourceType,
        resourceType,
        nextAvailable: next,
      });
    }
  }

  const result: OutageConflictResult = {
    resourceType,
    facility: params.facilityName,
    affectedDates,
    affected,
    defaultCapacity,
    reducedCapacity,
  };

  if (affected.length > 0) {
    await notifyOutage(params, result).catch(() => {
      /* best-effort */
    });
  }
  return result;
}

/** Earliest same-day start the block could move to under reduced capacity. */
function alternativeStart(
  block: ExistingOccupancy,
  reducedConfig: Awaited<ReturnType<typeof getEffectiveCapacityConfig>>,
  existing: ExistingOccupancy[],
): string | null {
  // Remove THIS block from the pool so it can be re-placed, then ask the
  // engine for the first start that fits under the reduced capacity.
  const others = existing.filter((e) => e !== block);
  const startMin = earliestFit({
    service: { resourceType: block.resourceType, studyCount: 1 },
    capacity: reducedConfig,
    existing: others,
    candidatePatientKey: block.patientKey,
  });
  return startMin != null ? minutesToHHMM(startMin) : null;
}

async function notifyOutage(
  params: { clinicId: number; facilityName: string; actorUserId: string | null },
  result: OutageConflictResult,
): Promise<void> {
  const recipients = await resolveRecipients(params.facilityName);
  const label = RESOURCE_LABELS[result.resourceType];
  const dateLabel =
    result.affectedDates.length === 1
      ? result.affectedDates[0]
      : `${result.affectedDates[0]} +${result.affectedDates.length - 1} more`;
  const title = `${label} capacity reduced — ${params.facilityName}`;
  const shortBody = `${result.defaultCapacity} → ${result.reducedCapacity} on ${dateLabel}. ${result.affected.length} appointment${result.affected.length === 1 ? "" : "s"} affected — review required.`;
  for (const recipientUserId of recipients) {
    await createNotification({
      recipientUserId,
      type: "equipment_outage",
      title,
      shortBody,
      facilityId: params.facilityName,
      dedupeKey: `equipment_outage:${params.clinicId}:${result.resourceType}:${result.affectedDates[0]}`,
      metadata: {
        resourceType: result.resourceType,
        facility: params.facilityName,
        affectedDates: result.affectedDates,
        defaultCapacity: result.defaultCapacity,
        reducedCapacity: result.reducedCapacity,
        affectedCount: result.affected.length,
        affected: result.affected,
      },
    });
  }
}

/**
 * People to alert: active team members covering this facility, plus admins.
 * Best-effort — de-duplicated. PCS/ACS take the operational lead.
 */
async function resolveRecipients(facilityName: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const allUsers = await storage.getAllUsers();
    const { facilityCoverageRepository } = await import(
      "../../repositories/facilityCoverage.repo"
    );
    const coverage = await facilityCoverageRepository.coveredFacilitiesForUsers(
      allUsers.map((u) => u.id),
    );
    for (const u of allUsers) {
      const covers = coverage.get(u.id) ?? [];
      if (covers.some((f) => f?.toLowerCase() === facilityName.toLowerCase())) ids.add(u.id);
      if ((u as { role?: string }).role === "admin") ids.add(u.id);
    }
  } catch {
    /* best-effort */
  }
  return Array.from(ids);
}
