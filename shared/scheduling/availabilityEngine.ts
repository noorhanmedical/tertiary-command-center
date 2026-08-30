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

// Why a slot is not RECOMMENDED. All are SOFT — an authorized user may
// override. (Hard blocks — bad identity/service/time/auth — are enforced at
// the write layer, not here.)
export type SoftConstraint = "full" | "off_day" | "outage";

export type SlotAvailability = {
  /** "HH:MM" 24h. */
  time: string;
  startMinutes: number;
  /** Machines free for the requested service at this start. */
  available: number;
  /** Total machines in the pool for the requested service. */
  total: number;
  /** True when the block fits capacity AND falls on an operating day. */
  fits: boolean;
  /**
   * Capacity-only fit (ignores operating day). Distinguishes "the machine is
   * free but this isn't a normal service day" (off_day) from "full".
   */
  capacityFits: boolean;
  /** The soft constraint blocking a recommendation, if any. */
  constraint?: SoftConstraint;
  /** Present when it does not fit — the human reason. */
  reason?: string;
};

export type Conflict = {
  resourceType: ResourceType;
  /** The soft constraint kind (full / off_day / outage). */
  constraint: SoftConstraint;
  message: string;
  /** Earliest capacity opening (minutes) the same day, if any. */
  nextAvailableMinutes: number | null;
  /** Next date the resource is normally offered (YYYY-MM-DD), if relevant. */
  nextEligibleDay?: string | null;
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

// ─── Operating-day helpers ──────────────────────────────────────────────────

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD in local time. */
export function weekdayOf(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? -1 : d.getDay();
}

/** Add n days to a YYYY-MM-DD, returning YYYY-MM-DD. */
export function addDaysIso(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Is the resource NORMALLY offered on this date's weekday? */
export function isOperatingDay(
  resourceType: ResourceType,
  isoDate: string,
  capacity: CapacityByResource,
): boolean {
  const days = capacity[resourceType].operatingDays ?? [];
  return days.includes(weekdayOf(isoDate));
}

/**
 * The next date (YYYY-MM-DD, searching FORWARD from `fromIso` inclusive) that
 * is an operating day for ALL the given resources — i.e. the next day the whole
 * visit could normally happen. Returns null if none within `horizonDays`.
 * "Next eligible operating day" — never blindly tomorrow.
 */
export function nextEligibleOperatingDay(
  resourceTypes: ResourceType[],
  fromIso: string,
  capacity: CapacityByResource,
  opts: { inclusive?: boolean; horizonDays?: number } = {},
): string | null {
  const horizon = opts.horizonDays ?? 60;
  const start = opts.inclusive ? 0 : 1;
  for (let i = start; i <= horizon; i++) {
    const iso = addDaysIso(fromIso, i);
    if (resourceTypes.every((rt) => isOperatingDay(rt, iso, capacity))) return iso;
  }
  return null;
}

/** Per-resource next eligible operating day (used when services split). */
export function nextEligibleDayPerResource(
  resourceTypes: ResourceType[],
  fromIso: string,
  capacity: CapacityByResource,
  opts: { inclusive?: boolean; horizonDays?: number } = {},
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const rt of resourceTypes) {
    out[rt] = nextEligibleOperatingDay([rt], fromIso, capacity, opts);
  }
  return out;
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
  /** YYYY-MM-DD of the slots. When set, off-day classification applies. */
  isoDate?: string;
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
    isoDate,
    dayStartMinutes = SCHEDULING_DAY_START_MINUTES,
    dayEndMinutes = SCHEDULING_DAY_END_MINUTES,
    stepMinutes = SCHEDULING_SLOT_STEP_MINUTES,
  } = input;
  const duration = serviceDurationMinutes(service, capacity);
  const total = capacity[service.resourceType].machineCount;
  // Off-day is a SOFT constraint evaluated once per day (not per slot).
  const onOperatingDay =
    isoDate == null ? true : isOperatingDay(service.resourceType, isoDate, capacity);
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
    const capacityFits = free >= 1 && total >= 1;
    // "outage" = configured machines exist but temporary override zeroed them
    // for the day; "full" = machines exist but all occupied at this time.
    let constraint: SoftConstraint | undefined;
    if (total < 1) constraint = "outage";
    else if (!capacityFits) constraint = "full";
    else if (!onOperatingDay) constraint = "off_day";
    const fits = capacityFits && onOperatingDay;
    out.push({
      time: minutesToHHMM(t),
      startMinutes: t,
      available: Math.max(0, free),
      total,
      fits,
      capacityFits,
      constraint,
      reason:
        constraint === "outage"
          ? "Equipment unavailable"
          : constraint === "full"
            ? "FULL"
            : constraint === "off_day"
              ? "Not normally scheduled this day"
              : undefined,
    });
  }
  return out;
}

/**
 * The earliest start (minutes) at which the service block fits, or null.
 * By default requires a full recommendation (capacity + operating day); pass
 * `capacityOnly` to find the earliest capacity opening regardless of day.
 */
export function earliestFit(
  input: ComputeSlotsInput & { capacityOnly?: boolean },
): number | null {
  const slots = computeSlots(input);
  const hit = slots.find((s) => (input.capacityOnly ? s.capacityFits : s.fits));
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

// ─── Multi-service VISIT planning (one-visit vs split-visit) ────────────────

export type VisitPlanStep = {
  resourceType: ResourceType;
  studyCount?: number;
  isoDate: string;
  startMinutes: number;
  endMinutes: number;
  time: string;
  serviceLabel: string;
  /** Off the resource's normal operating day (would need an override). */
  offDay: boolean;
};

export type VisitPlan = {
  kind: "one_visit" | "split_visit";
  steps: VisitPlanStep[];
  /** Distinct dates the plan spans. */
  dates: string[];
  /** Overall earliest start of the plan. */
  isoDate: string;
  startMinutes: number;
  /** True when any step lands on an off-day (needs an override to keep as-is). */
  requiresOverride: boolean;
  reason: string;
  recommended: boolean;
};

export type PlanVisitInput = {
  services: ServiceRequest[];
  capacity: CapacityByResource;
  /** Existing occupancy keyed by date (YYYY-MM-DD → blocks that day). */
  existingByDate: Record<string, ExistingOccupancy[]>;
  candidatePatientKey: string;
  /** The date the user is currently looking at. */
  isoDate: string;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  stepMinutes?: number;
  horizonDays?: number;
};

/**
 * Plan a multi-service visit. Prefers completing ALL selected services in ONE
 * visit on a single operating day; when that isn't possible on the target day
 * (or an operating day at all within the horizon), returns a split-visit plan
 * grouping services onto their respective next eligible operating days.
 *
 * Deterministic. Placement within a day reuses the same sequential logic as
 * suggestSequences (a patient occupies one machine at a time).
 */
export function planVisit(input: PlanVisitInput): {
  oneVisit: VisitPlan | null;
  splitVisit: VisitPlan | null;
} {
  const {
    services,
    capacity,
    existingByDate,
    candidatePatientKey,
    isoDate,
    horizonDays = 60,
  } = input;
  const resourceTypes = Array.from(new Set(services.map((s) => s.resourceType)));

  // ── One-visit: the earliest single operating day (>= target) where every
  // selected service is offered AND the whole sequence fits. ──
  let oneVisit: VisitPlan | null = null;
  for (let i = 0; i <= horizonDays; i++) {
    const day = addDaysIso(isoDate, i);
    if (!resourceTypes.every((rt) => isOperatingDay(rt, day, capacity))) continue;
    const seq = placeSequentialOnDay(services, day, existingByDate[day] ?? [], input);
    if (seq) {
      oneVisit = {
        kind: "one_visit",
        steps: seq,
        dates: [day],
        isoDate: day,
        startMinutes: Math.min(...seq.map((s) => s.startMinutes)),
        requiresOverride: false,
        reason:
          i === 0
            ? `All ${services.length} services fit in one visit on ${day}.`
            : `Earliest one-visit day where every selected service is offered: ${day}.`,
        recommended: false,
      };
      break;
    }
  }

  // ── Split-visit: each service on its own next eligible operating day. Only
  // meaningful when services have DIFFERENT operating-day sets (else one-visit
  // already covers it). ──
  let splitVisit: VisitPlan | null = null;
  const perResourceDay = nextEligibleDayPerResource(resourceTypes, isoDate, capacity, {
    inclusive: true,
    horizonDays,
  });
  const distinctDays = new Set(Object.values(perResourceDay).filter(Boolean) as string[]);
  if (distinctDays.size > 1) {
    const steps: VisitPlanStep[] = [];
    // Group services by their resource's eligible day, placing each group.
    const byDay: Record<string, ServiceRequest[]> = {};
    for (const svc of services) {
      const day = perResourceDay[svc.resourceType];
      if (!day) continue;
      (byDay[day] ??= []).push(svc);
    }
    let ok = true;
    for (const [day, group] of Object.entries(byDay)) {
      const seq = placeSequentialOnDay(group, day, existingByDate[day] ?? [], input);
      if (!seq) {
        ok = false;
        break;
      }
      steps.push(...seq);
    }
    if (ok && steps.length > 0) {
      const dates = Array.from(new Set(steps.map((s) => s.isoDate))).sort();
      steps.sort((a, b) =>
        a.isoDate === b.isoDate ? a.startMinutes - b.startMinutes : a.isoDate < b.isoDate ? -1 : 1,
      );
      splitVisit = {
        kind: "split_visit",
        steps,
        dates,
        isoDate: dates[0],
        startMinutes: steps[0].startMinutes,
        requiresOverride: false,
        reason: `Services split across their normal days: ${dates.join(", ")}.`,
        recommended: false,
      };
    }
  }

  // Prefer a one-visit completion when available (spec §25).
  if (oneVisit) oneVisit.recommended = true;
  else if (splitVisit) splitVisit.recommended = true;
  return { oneVisit, splitVisit };
}

/**
 * Place a group of services sequentially on ONE day, returning ordered visit
 * steps or null if any doesn't fit that day. Off-day steps are allowed here
 * (flagged offDay) so callers can offer "override to keep on this day"; the
 * planVisit one-visit path only calls this on operating days.
 */
export function placeSequentialOnDay(
  services: ServiceRequest[],
  isoDate: string,
  existing: ExistingOccupancy[],
  cfg: {
    capacity: CapacityByResource;
    candidatePatientKey: string;
    dayStartMinutes?: number;
    dayEndMinutes?: number;
    stepMinutes?: number;
  },
): VisitPlanStep[] | null {
  const {
    capacity,
    candidatePatientKey,
    dayStartMinutes = SCHEDULING_DAY_START_MINUTES,
    dayEndMinutes = SCHEDULING_DAY_END_MINUTES,
    stepMinutes = SCHEDULING_SLOT_STEP_MINUTES,
  } = cfg;
  const working = existing.slice();
  const steps: VisitPlanStep[] = [];
  let cursor = dayStartMinutes;
  for (const svc of services) {
    const duration = serviceDurationMinutes(svc, capacity);
    let placed: number | null = null;
    for (let t = Math.max(cursor, dayStartMinutes); t + duration <= dayEndMinutes; t += stepMinutes) {
      if (machinesFreeAt(svc.resourceType, t, duration, capacity, working, candidatePatientKey) >= 1) {
        placed = t;
        break;
      }
    }
    if (placed == null) return null;
    steps.push({
      resourceType: svc.resourceType,
      studyCount: svc.studyCount,
      isoDate,
      startMinutes: placed,
      endMinutes: placed + duration,
      time: minutesToHHMM(placed),
      serviceLabel: labelForService(svc, capacity),
      offDay: !isOperatingDay(svc.resourceType, isoDate, capacity),
    });
    working.push({
      resourceType: svc.resourceType,
      startMinutes: placed,
      endMinutes: placed + duration,
      turnoverMinutes: capacity[svc.resourceType].turnoverMinutes,
      patientKey: candidatePatientKey,
    });
    cursor = placed + duration;
  }
  return steps;
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
  isoDate?: string,
): Conflict | null {
  const label = RESOURCE_LABELS[service.resourceType];
  const total = capacity[service.resourceType].machineCount;
  const duration = serviceDurationMinutes(service, capacity);
  const free = machinesFreeAt(
    service.resourceType,
    requestedStartMinutes,
    duration,
    capacity,
    existing,
    candidatePatientKey,
  );
  const onOperatingDay =
    isoDate == null ? true : isOperatingDay(service.resourceType, isoDate, capacity);
  const capacityOk = free >= 1 && total >= 1;

  // No conflict only when capacity is available AND it's a normal service day.
  if (capacityOk && onOperatingDay) return null;

  const nextEligibleDay =
    isoDate != null && !onOperatingDay
      ? nextEligibleOperatingDay([service.resourceType], isoDate, capacity, { inclusive: false })
      : null;

  if (total < 1) {
    return {
      resourceType: service.resourceType,
      constraint: "outage",
      message: `${label} is unavailable (equipment outage).`,
      nextAvailableMinutes: null,
      nextEligibleDay,
    };
  }
  if (!onOperatingDay) {
    return {
      resourceType: service.resourceType,
      constraint: "off_day",
      message: `${label} is not normally scheduled on this day.`,
      // On an off-day the same-day capacity opening is not a recommendation;
      // point at the next normal day instead.
      nextAvailableMinutes: null,
      nextEligibleDay,
    };
  }
  // Capacity full on a normal day → earliest same-day capacity opening.
  const next = earliestFit({ service, capacity, existing, candidatePatientKey, isoDate, capacityOnly: true });
  return {
    resourceType: service.resourceType,
    constraint: "full",
    message: `${label} capacity is full at ${to12h(minutesToHHMM(requestedStartMinutes))}.`,
    nextAvailableMinutes: next,
    nextEligibleDay: null,
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
