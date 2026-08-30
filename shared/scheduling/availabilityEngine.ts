/**
 * Capacity-aware scheduling availability engine (pure, deterministic).
 *
 * This is the ONE place resource-capacity math lives. Both the full
 * UnifiedScheduler and the Quick Schedule popover consume its output (via the
 * server availability endpoint) so they can never disagree. No AI, no
 * randomness — every result is a function of the inputs.
 *
 * Resource model: each facility has independent machine POOLS
 * (brainwave / vitalwave / ultrasound). A service block occupies one machine
 * of its pool for an interval [start, end). The number of simultaneous
 * appointments a pool supports equals its machine count; concurrency is
 * checked by INTERVAL OVERLAP, not exact start-time equality.
 *
 * Durations:
 *   BrainWave / VitalWave — configured durationMinutes.
 *   Ultrasound — numberOfStudies × minutesPerStudy for the patient block,
 *     plus a turnover buffer applied AFTER the block before a DIFFERENT
 *     patient may use the machine (never between studies of the same patient).
 */

import type { ResourceType } from "../schema/schedulingCapacity";
import type { ResourceCapacityConfig } from "./capacityDefaults";
import {
  SCHEDULING_DAY_START_MINUTES,
  SCHEDULING_DAY_END_MINUTES,
  SCHEDULING_SLOT_STEP_MINUTES,
  RESOURCE_LABELS,
} from "./capacityDefaults";

// ─── Types ──────────────────────────────────────────────────────────────────

/** An existing booked block on a resource pool for the target day. */
export type ExistingOccupancy = {
  resourceType: ResourceType;
  /** Minutes from midnight (local clinic time). */
  startMinutes: number;
  endMinutes: number;
  /** Turnover buffer that trails this block before a DIFFERENT patient. */
  turnoverMinutes: number;
  /** Stable patient key so same-patient adjacency skips turnover. */
  patientKey: string;
  /** For agenda display. */
  label?: string;
  serviceLabel?: string;
  appointmentId?: number | null;
};

/** A request to schedule one service (or an ultrasound bundle) for a patient. */
export type ServiceRequest = {
  resourceType: ResourceType;
  /** Ultrasound only — number of studies selected (>=1). Ignored otherwise. */
  studyCount?: number;
};

export type CapacityByResource = Record<ResourceType, ResourceCapacityConfig>;

export type SlotAvailability = {
  /** "HH:MM" 24h. */
  time: string;
  startMinutes: number;
  /** Machines free for the requested service at this start. */
  available: number;
  /** Total machines in the pool for the requested service. */
  total: number;
  /** True when the block would fit (available >= 1 and within the day). */
  fits: boolean;
  /** Present when it does not fit — the human reason. */
  reason?: string;
};

export type Conflict = {
  resourceType: ResourceType;
  message: string;
  /** Earliest start (minutes) the requested block WOULD fit, if any. */
  nextAvailableMinutes: number | null;
};

export type SuggestionStep = {
  resourceType: ResourceType;
  startMinutes: number;
  endMinutes: number;
  time: string;
  serviceLabel: string;
};

export type Suggestion = {
  /** Ordered service blocks for the (possibly multi-service) patient. */
  steps: SuggestionStep[];
  /** The overall earliest start across steps. */
  startMinutes: number;
  time: string;
  /** Short deterministic explanation (never opaque "AI recommends"). */
  reason: string;
  recommended: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

export function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Compute the resource occupancy duration (minutes) for a single service
 * request, EXCLUDING trailing turnover. Ultrasound multiplies by study count.
 */
export function serviceDurationMinutes(
  req: ServiceRequest,
  capacity: CapacityByResource,
): number {
  const cfg = capacity[req.resourceType];
  if (req.resourceType === "ultrasound") {
    const perStudy = cfg.minutesPerStudy ?? cfg.durationMinutes;
    const count = Math.max(1, req.studyCount ?? 1);
    return perStudy * count;
  }
  return cfg.durationMinutes;
}

/**
 * How many machines of `resourceType` are OCCUPIED across the interval
 * [startMinutes, endMinutes) — the max concurrent overlap. Turnover buffers
 * extend an existing block's effective occupancy ONLY against a different
 * patient (we pass the candidate patientKey to know whether to apply it).
 */
export function concurrentOccupancy(
  resourceType: ResourceType,
  startMinutes: number,
  endMinutes: number,
  existing: ExistingOccupancy[],
  candidatePatientKey: string,
): number {
  let peak = 0;
  // Sweep at each existing block boundary + the candidate start; interval
  // overlap is what matters, so sampling boundaries is sufficient and exact.
  const sample = (t: number) => {
    let n = 0;
    for (const e of existing) {
      if (e.resourceType !== resourceType) continue;
      // Effective end includes turnover only when the candidate is a
      // DIFFERENT patient (same patient shares the machine continuously).
      const effEnd =
        e.patientKey === candidatePatientKey ? e.endMinutes : e.endMinutes + e.turnoverMinutes;
      if (t >= e.startMinutes && t < effEnd) n++;
    }
    return n;
  };
  // Also require that the candidate's own leading turnover-from-others is
  // respected: sample just at/after the candidate start across its span.
  const boundaries = new Set<number>([startMinutes]);
  for (const e of existing) {
    if (e.resourceType !== resourceType) continue;
    if (e.startMinutes > startMinutes && e.startMinutes < endMinutes) boundaries.add(e.startMinutes);
  }
  for (const t of boundaries) {
    if (t >= endMinutes) continue;
    peak = Math.max(peak, sample(t));
  }
  return peak;
}

/**
 * Can a block of [startMinutes, startMinutes+duration) fit for the resource
 * given machine count + existing occupancy? Returns remaining machines after
 * placing this block (>=0 means it fits).
 */
export function machinesFreeAt(
  resourceType: ServiceRequest["resourceType"],
  startMinutes: number,
  durationMinutes: number,
  capacity: CapacityByResource,
  existing: ExistingOccupancy[],
  candidatePatientKey: string,
): number {
  const total = capacity[resourceType].machineCount;
  const occ = concurrentOccupancy(
    resourceType,
    startMinutes,
    startMinutes + durationMinutes,
    existing,
    candidatePatientKey,
  );
  return total - occ;
}

// ─── Slot availability for a single service ─────────────────────────────────

export type ComputeSlotsInput = {
  service: ServiceRequest;
  capacity: CapacityByResource;
  existing: ExistingOccupancy[];
  candidatePatientKey: string;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  stepMinutes?: number;
};

/**
 * Generate every candidate start time across the operating window with the
 * remaining machine count for the requested service. A slot "fits" when at
 * least one machine is free for the full block and the block ends within the
 * day. This is what the capacity-aware time buttons render.
 */
export function computeSlots(input: ComputeSlotsInput): SlotAvailability[] {
  const {
    service,
    capacity,
    existing,
    candidatePatientKey,
    dayStartMinutes = SCHEDULING_DAY_START_MINUTES,
    dayEndMinutes = SCHEDULING_DAY_END_MINUTES,
    stepMinutes = SCHEDULING_SLOT_STEP_MINUTES,
  } = input;
  const duration = serviceDurationMinutes(service, capacity);
  const total = capacity[service.resourceType].machineCount;
  const out: SlotAvailability[] = [];
  for (let t = dayStartMinutes; t + duration <= dayEndMinutes; t += stepMinutes) {
    const free = machinesFreeAt(
      service.resourceType,
      t,
      duration,
      capacity,
      existing,
      candidatePatientKey,
    );
    const fits = free >= 1 && total >= 1;
    out.push({
      time: minutesToHHMM(t),
      startMinutes: t,
      available: Math.max(0, free),
      total,
      fits,
      reason: total < 1 ? "No machines configured" : !fits ? "FULL" : undefined,
    });
  }
  return out;
}

/** The earliest start (minutes) at which the service block fits, or null. */
export function earliestFit(input: ComputeSlotsInput): number | null {
  const slots = computeSlots(input);
  const hit = slots.find((s) => s.fits);
  return hit ? hit.startMinutes : null;
}

// ─── Multi-service sequencing suggestions ────────────────────────────────────

export type SuggestInput = {
  services: ServiceRequest[];
  capacity: CapacityByResource;
  existing: ExistingOccupancy[];
  candidatePatientKey: string;
  preferredStartMinutes?: number | null;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  stepMinutes?: number;
};

/**
 * Build up to two deterministic sequencing options for a patient's services.
 * Blocks are placed sequentially (a patient can't be in two machines at once)
 * choosing the earliest fit for each in the given order. Option 1 uses the
 * requested order; Option 2 reverses a 2-service order when that yields an
 * earlier overall start. Not a full optimizer — a sensible, explainable guide.
 */
export function suggestSequences(input: SuggestInput): Suggestion[] {
  const orders: ServiceRequest[][] = [input.services];
  if (input.services.length === 2) {
    orders.push([input.services[1], input.services[0]]);
  }
  const built = orders
    .map((order) => buildSequence(order, input))
    .filter((s): s is Suggestion => s !== null);

  // De-dupe identical start plans, then sort by overall earliest start.
  const seen = new Set<string>();
  const unique = built.filter((s) => {
    const key = s.steps.map((x) => `${x.resourceType}@${x.startMinutes}`).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.startMinutes - b.startMinutes);
  if (unique.length > 0) unique[0].recommended = true;
  return unique.slice(0, 2);
}

function buildSequence(
  order: ServiceRequest[],
  input: SuggestInput,
): Suggestion | null {
  const {
    capacity,
    existing,
    candidatePatientKey,
    preferredStartMinutes,
    dayStartMinutes = SCHEDULING_DAY_START_MINUTES,
    dayEndMinutes = SCHEDULING_DAY_END_MINUTES,
    stepMinutes = SCHEDULING_SLOT_STEP_MINUTES,
  } = input;

  // Simulate placement on a working copy of existing occupancy so later steps
  // see earlier steps of the SAME patient.
  const working: ExistingOccupancy[] = existing.slice();
  const steps: SuggestionStep[] = [];
  let cursor = preferredStartMinutes ?? dayStartMinutes;

  for (const svc of order) {
    const duration = serviceDurationMinutes(svc, capacity);
    let placed: number | null = null;
    for (let t = Math.max(cursor, dayStartMinutes); t + duration <= dayEndMinutes; t += stepMinutes) {
      const free = machinesFreeAt(
        svc.resourceType,
        t,
        duration,
        capacity,
        working,
        candidatePatientKey,
      );
      if (free >= 1) {
        placed = t;
        break;
      }
    }
    if (placed == null) return null; // no fit in the day for this order
    steps.push({
      resourceType: svc.resourceType,
      startMinutes: placed,
      endMinutes: placed + duration,
      time: minutesToHHMM(placed),
      serviceLabel: labelForService(svc, capacity),
    });
    working.push({
      resourceType: svc.resourceType,
      startMinutes: placed,
      endMinutes: placed + duration,
      turnoverMinutes: capacity[svc.resourceType].turnoverMinutes,
      patientKey: candidatePatientKey,
    });
    // Same patient proceeds to next service after this block ends.
    cursor = placed + duration;
  }

  const startMinutes = Math.min(...steps.map((s) => s.startMinutes));
  return {
    steps,
    startMinutes,
    time: minutesToHHMM(startMinutes),
    reason: explainSequence(steps, capacity),
    recommended: false,
  };
}

function labelForService(svc: ServiceRequest, capacity: CapacityByResource): string {
  if (svc.resourceType === "ultrasound") {
    const count = Math.max(1, svc.studyCount ?? 1);
    return count > 1 ? `Ultrasound — ${count} studies` : "Ultrasound";
  }
  return RESOURCE_LABELS[svc.resourceType];
}

function explainSequence(steps: SuggestionStep[], capacity: CapacityByResource): string {
  if (steps.length === 1) {
    const s = steps[0];
    return `${RESOURCE_LABELS[s.resourceType]} machine available at ${to12h(s.time)}.`;
  }
  const parts = steps.map((s) => `${to12h(s.time)} ${RESOURCE_LABELS[s.resourceType]}`);
  return `Uses available machines in sequence: ${parts.join(", ")}.`;
}

function to12h(hhmm: string): string {
  const m = hhmmToMinutes(hhmm);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

// ─── Conflict on a specific requested start ──────────────────────────────────

export function conflictForRequest(
  service: ServiceRequest,
  requestedStartMinutes: number,
  capacity: CapacityByResource,
  existing: ExistingOccupancy[],
  candidatePatientKey: string,
): Conflict | null {
  const duration = serviceDurationMinutes(service, capacity);
  const free = machinesFreeAt(
    service.resourceType,
    requestedStartMinutes,
    duration,
    capacity,
    existing,
    candidatePatientKey,
  );
  if (free >= 1) return null;
  const next = earliestFit({ service, capacity, existing, candidatePatientKey });
  const label = RESOURCE_LABELS[service.resourceType];
  return {
    resourceType: service.resourceType,
    message:
      capacity[service.resourceType].machineCount < 1
        ? `${label} has no machines available.`
        : `${label} capacity is full at ${to12h(minutesToHHMM(requestedStartMinutes))}.`,
    nextAvailableMinutes: next,
  };
}

// ─── Outage impact: which existing blocks exceed a reduced capacity ──────────

/**
 * Given existing occupancy on ONE resource and a reduced machine count,
 * return the blocks whose time overlaps a window where concurrent demand
 * exceeds the new capacity — i.e. the appointments now in conflict.
 */
export function findOverCapacityBlocks(
  resourceType: ResourceType,
  reducedCapacity: number,
  existing: ExistingOccupancy[],
): ExistingOccupancy[] {
  const pool = existing.filter((e) => e.resourceType === resourceType);
  const impacted: ExistingOccupancy[] = [];
  for (const block of pool) {
    // Count how many blocks (including this one) overlap this block's start.
    const overlap = pool.filter(
      (e) => e.startMinutes < block.endMinutes && e.endMinutes > block.startMinutes,
    ).length;
    if (overlap > reducedCapacity) impacted.push(block);
  }
  return impacted;
}
