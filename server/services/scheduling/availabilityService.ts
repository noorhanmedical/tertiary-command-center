// Server bridge for the capacity-aware availability engine.
//
// Fetches the facility's effective capacity (defaults + stored rows + active
// date overrides) and the day's existing appointments, maps them into engine
// occupancy inputs, then delegates ALL math to the pure availabilityEngine so
// the Quick + Full schedulers stay identical.

import { createFacilityResolver } from "../facilityResolver";
import {
  getEffectiveCapacityConfig,
  listActiveOverridesForDate,
  applyOverridesForDate,
} from "../../repositories/schedulingCapacity.repo";
import { listGlobalScheduleEvents } from "../../repositories/globalSchedule.repo";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import type { ResourceType } from "@shared/schema/schedulingCapacity";
import {
  computeSlots,
  suggestSequences,
  conflictForRequest,
  serviceDurationMinutes,
  hhmmToMinutes,
  minutesToHHMM,
  isOperatingDay,
  nextEligibleOperatingDay,
  planVisit,
  type ExistingOccupancy,
  type ServiceRequest,
  type CapacityByResource,
  type SlotAvailability,
  type Suggestion,
  type Conflict,
  type VisitPlan,
} from "@shared/scheduling/availabilityEngine";

const ANCILLARY_EVENT_TYPES = new Set([
  "ancillary_appointment",
  "same_day_add",
]);

const SCHEDULED_STATUSES = new Set(["scheduled", "confirmed", "checked_in", "in_progress"]);

function localMinutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isoDateOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve capacity (with the date's active overrides applied) + occupancy. */
export async function loadDayContext(params: {
  facilityName: string | null;
  clinicId?: number | null;
  isoDate: string;
}): Promise<{
  clinicId: number | null;
  facilityName: string | null;
  capacity: CapacityByResource;
  existing: ExistingOccupancy[];
}> {
  let clinicId = params.clinicId ?? null;
  let facilityName = params.facilityName ?? null;
  if (clinicId == null && facilityName) {
    try {
      const { resolve } = await createFacilityResolver();
      const m = resolve(facilityName);
      clinicId = m?.clinicId ?? null;
      facilityName = m?.name ?? facilityName;
    } catch {
      /* keep nulls — defaults still apply */
    }
  }

  const base = await getEffectiveCapacityConfig(clinicId);
  let capacity = base;
  if (clinicId != null) {
    const overrides = await listActiveOverridesForDate(clinicId, params.isoDate);
    if (overrides.length > 0) capacity = applyOverridesForDate(base, overrides);
  }

  const existing = await loadExistingOccupancy({
    facilityName,
    isoDate: params.isoDate,
    capacity,
  });
  return { clinicId, facilityName, capacity, existing };
}

/** Read the day's scheduled ancillary events and map them to occupancy. */
export async function loadExistingOccupancy(params: {
  facilityName: string | null;
  isoDate: string;
  capacity: CapacityByResource;
}): Promise<ExistingOccupancy[]> {
  const dayStart = new Date(`${params.isoDate}T00:00:00`);
  const dayEnd = new Date(`${params.isoDate}T23:59:59`);
  const rows = await listGlobalScheduleEvents(
    {
      facilityId: params.facilityName ?? undefined,
      startDate: dayStart,
      endDate: dayEnd,
    },
    500,
  );
  const out: ExistingOccupancy[] = [];
  for (const r of rows) {
    if (!ANCILLARY_EVENT_TYPES.has(r.eventType)) continue;
    if (!SCHEDULED_STATUSES.has(r.status)) continue;
    const starts = r.startsAt ? new Date(r.startsAt as unknown as string) : null;
    if (!starts || isNaN(starts.getTime())) continue;
    const cat = getAncillaryCategory(r.serviceType ?? "");
    if (cat === "other") continue;
    const resourceType = cat as ResourceType;
    const startMinutes = localMinutesOf(starts);
    // Prefer the stored endsAt; else derive from configured duration.
    let endMinutes: number;
    const ends = r.endsAt ? new Date(r.endsAt as unknown as string) : null;
    if (ends && !isNaN(ends.getTime()) && ends > starts) {
      endMinutes = localMinutesOf(ends);
    } else {
      const studyCount =
        (r.metadata as { ultrasoundStudyCount?: number } | null)?.ultrasoundStudyCount ?? 1;
      endMinutes =
        startMinutes +
        serviceDurationMinutes(
          { resourceType, studyCount },
          params.capacity,
        );
    }
    out.push({
      resourceType,
      startMinutes,
      endMinutes,
      turnoverMinutes: params.capacity[resourceType].turnoverMinutes,
      patientKey: patientKeyOf(r),
      label: r.patientName ?? "Patient",
      serviceLabel: r.serviceType ?? resourceType,
      appointmentId: r.id ?? null,
    });
  }
  return out;
}

function patientKeyOf(r: {
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  id?: number;
}): string {
  if (r.patientScreeningId != null) return `ps:${r.patientScreeningId}`;
  if (r.executionCaseId != null) return `ec:${r.executionCaseId}`;
  return `evt:${r.id}`;
}

// ─── Public availability computation ─────────────────────────────────────────

export type AvailabilityResult = {
  clinicId: number | null;
  facility: string | null;
  date: string;
  capacity: CapacityByResource;
  /** Per-service block duration (minutes) for the request. */
  durations: Partial<Record<ResourceType, number>>;
  /** Slots for the PRIMARY requested service (the one shown as time buttons). */
  slots: SlotAvailability[];
  /** Conflict for the caller's preferred time (if one was supplied). */
  conflict: Conflict | null;
  /** Ordered sequencing options for the (possibly multi-service) patient. */
  suggestions: Suggestion[];
  /** Compact agenda of the day's existing appointments. */
  agenda: Array<{
    appointmentId: number | null;
    time: string;
    endTime: string;
    patient: string;
    service: string;
    resourceType: ResourceType;
  }>;
  /** Equipment summary for the day (used vs total). */
  equipment: Array<{
    resourceType: ResourceType;
    total: number;
    label: string;
  }>;
  /** Per-resource operating-day info for the target date. */
  operatingDays: Array<{
    resourceType: ResourceType;
    label: string;
    /** Configured weekday numbers this resource is normally offered. */
    days: number[];
    /** Is the TARGET date an operating day for this resource? */
    isOperatingToday: boolean;
    /** Next date (YYYY-MM-DD) this resource is normally offered, if not today. */
    nextEligibleDay: string | null;
  }>;
  /** Multi-service visit plans (prefer one visit; split when days differ). */
  visit: {
    oneVisit: VisitPlan | null;
    splitVisit: VisitPlan | null;
  };
};

export async function computeAvailability(params: {
  facilityName: string | null;
  clinicId?: number | null;
  isoDate: string;
  services: ServiceRequest[];
  patientKey?: string | null;
  preferredTime?: string | null;
}): Promise<AvailabilityResult> {
  const { capacity, existing, clinicId, facilityName } = await loadDayContext({
    facilityName: params.facilityName,
    clinicId: params.clinicId ?? null,
    isoDate: params.isoDate,
  });

  const candidatePatientKey = params.patientKey ?? "__candidate__";
  const services = params.services.filter((s) => !!s?.resourceType);
  const primary = services[0] ?? null;

  const durations: Partial<Record<ResourceType, number>> = {};
  for (const s of services) durations[s.resourceType] = serviceDurationMinutes(s, capacity);

  const slots = primary
    ? computeSlots({ service: primary, capacity, existing, candidatePatientKey, isoDate: params.isoDate })
    : [];

  let conflict: Conflict | null = null;
  if (primary && params.preferredTime) {
    conflict = conflictForRequest(
      primary,
      hhmmToMinutes(params.preferredTime),
      capacity,
      existing,
      candidatePatientKey,
      params.isoDate,
    );
  }

  const suggestions =
    services.length > 0
      ? suggestSequences({
          services,
          capacity,
          existing,
          candidatePatientKey,
          preferredStartMinutes: params.preferredTime ? hhmmToMinutes(params.preferredTime) : null,
        })
      : [];

  // Per-resource operating-day info for the target date.
  const operatingDays = (["brainwave", "vitalwave", "ultrasound"] as ResourceType[]).map((rt) => ({
    resourceType: rt,
    label: rt === "brainwave" ? "BrainWave" : rt === "vitalwave" ? "VitalWave" : "Ultrasound",
    days: capacity[rt].operatingDays,
    isOperatingToday: isOperatingDay(rt, params.isoDate, capacity),
    nextEligibleDay: isOperatingDay(rt, params.isoDate, capacity)
      ? null
      : nextEligibleOperatingDay([rt], params.isoDate, capacity, { inclusive: false }),
  }));

  // Multi-service visit planning (one-visit vs split-visit). Loads occupancy
  // for candidate operating days so cross-day placement is capacity-accurate.
  let visit: { oneVisit: VisitPlan | null; splitVisit: VisitPlan | null } = {
    oneVisit: null,
    splitVisit: null,
  };
  if (services.length > 0) {
    const existingByDate = await loadOccupancyForCandidateDays({
      facilityName,
      capacity,
      services,
      isoDate: params.isoDate,
    });
    visit = planVisit({
      services,
      capacity,
      existingByDate,
      candidatePatientKey,
      isoDate: params.isoDate,
    });
  }

  const agenda = existing
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((e) => ({
      appointmentId: e.appointmentId ?? null,
      time: minutesToHHMM(e.startMinutes),
      endTime: minutesToHHMM(e.endMinutes),
      patient: e.label ?? "Patient",
      service: e.serviceLabel ?? e.resourceType,
      resourceType: e.resourceType,
    }));

  const equipment = (["brainwave", "vitalwave", "ultrasound"] as ResourceType[]).map((rt) => ({
    resourceType: rt,
    total: capacity[rt].machineCount,
    label:
      rt === "brainwave" ? "BrainWave" : rt === "vitalwave" ? "VitalWave" : "Ultrasound",
  }));

  return {
    clinicId,
    facility: facilityName,
    date: params.isoDate,
    capacity,
    durations,
    slots,
    conflict,
    suggestions,
    agenda,
    equipment,
    operatingDays,
    visit,
  };
}

/**
 * Load existing occupancy for the candidate days the visit planner may place
 * on: the target date plus each resource's next few eligible operating days.
 * Keeps the planner's cross-day capacity checks accurate without scanning the
 * whole calendar.
 */
async function loadOccupancyForCandidateDays(params: {
  facilityName: string | null;
  capacity: CapacityByResource;
  services: ServiceRequest[];
  isoDate: string;
}): Promise<Record<string, ExistingOccupancy[]>> {
  const resourceTypes = Array.from(new Set(params.services.map((s) => s.resourceType)));
  const candidateDates = new Set<string>([params.isoDate]);
  // One-visit candidate: earliest day all services share.
  const allDay = nextEligibleOperatingDay(resourceTypes, params.isoDate, params.capacity, {
    inclusive: true,
  });
  if (allDay) candidateDates.add(allDay);
  // Split-visit candidates: each resource's own next eligible day.
  for (const rt of resourceTypes) {
    const d = nextEligibleOperatingDay([rt], params.isoDate, params.capacity, { inclusive: true });
    if (d) candidateDates.add(d);
  }
  const out: Record<string, ExistingOccupancy[]> = {};
  for (const iso of candidateDates) {
    // eslint-disable-next-line no-await-in-loop
    out[iso] = await loadExistingOccupancy({
      facilityName: params.facilityName,
      isoDate: iso,
      capacity: params.capacity,
    });
  }
  return out;
}
