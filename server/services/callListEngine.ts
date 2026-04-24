import type { IStorage } from "../storage";
import type {
  OutreachScheduler,
  PatientScreening,
  SchedulerAssignment,
  ScreeningBatch,
  PtoRequest,
  InsertSchedulerAssignment,
  AncillaryAppointment,
} from "@shared/schema";
import { isEligibleForCallList, priorityKey, comparePriority } from "./callListPriority";
import { derivePatientType } from "@shared/patientType";

// ── Configuration ──────────────────────────────────────────────────────────
// "Base" daily target = how many calls a 100% capacity scheduler can handle
// in one day. A scheduler at capacity P% can hold up to round(P/100 * base)
// active assignments. Tunable via env without code change.
const DEFAULT_BASE_DAILY_TARGET = Number(process.env.CALL_LIST_BASE_DAILY_TARGET ?? 60);

export type EligibleCandidate = {
  patient: PatientScreening;
  facility: string;
  scheduleDate: string | null;
  batchAssignedSchedulerId: number | null;
  // Derived patient type computed at gather time. The engine pool only
  // ever contains derived "visit" patients today, but we still pass it
  // through ranking so prioritization never reads the (potentially stale)
  // stored `patient.patientType` column.
  derivedPatientType: "visit" | "outreach";
};

export type AssignmentDraft = {
  patientScreeningId: number;
  schedulerId: number;
  asOfDate: string;
  source: "auto" | "manual" | "reassigned";
  originalSchedulerId?: number | null;
  reason?: string | null;
};

export function dailyCapacity(scheduler: OutreachScheduler, baseDailyTarget = DEFAULT_BASE_DAILY_TARGET): number {
  const pct = Math.max(0, Math.min(100, scheduler.capacityPercent ?? 100));
  return Math.max(0, Math.round((pct / 100) * baseDailyTarget));
}

// Pure functional core: given a list of eligible patients (already sorted
// by priority) and a list of schedulers (with capacityPercent), greedily
// drop each patient into the scheduler with the most remaining capacity,
// breaking ties by capacityPercent then by id. Schedulers at full capacity
// are skipped. Returns one draft per patient that found a home.
export function buildAssignmentsForPool(
  candidates: EligibleCandidate[],
  schedulers: OutreachScheduler[],
  asOfDate: string,
  baseDailyTarget = DEFAULT_BASE_DAILY_TARGET,
): AssignmentDraft[] {
  if (schedulers.length === 0 || candidates.length === 0) return [];

  // Per-scheduler running load + cap. Capacity 0 means "off today".
  const load = new Map<number, number>();
  const cap = new Map<number, number>();
  for (const sc of schedulers) {
    load.set(sc.id, 0);
    cap.set(sc.id, dailyCapacity(sc, baseDailyTarget));
  }

  // Capacity-weighted round-robin: pick the scheduler with smallest
  // load/cap ratio. Tiebreaks: lower load, then lower id.
  const drafts: AssignmentDraft[] = [];
  const orderedSchedulers = [...schedulers].sort((a, b) => a.id - b.id);
  for (const c of candidates) {
    let best: OutreachScheduler | null = null;
    let bestRatio = Number.POSITIVE_INFINITY;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const sc of orderedSchedulers) {
      const c1 = cap.get(sc.id) ?? 0;
      if (c1 <= 0) continue;
      const l = load.get(sc.id) ?? 0;
      if (l >= c1) continue;
      const ratio = l / c1;
      if (
        ratio < bestRatio ||
        (ratio === bestRatio && l < bestLoad) ||
        (ratio === bestRatio && l === bestLoad && best && sc.id < best.id)
      ) {
        best = sc;
        bestRatio = ratio;
        bestLoad = l;
      }
    }
    if (!best) break;
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
    drafts.push({
      patientScreeningId: c.patient.id,
      schedulerId: best.id,
      asOfDate,
      source: "auto",
    });
  }
  return drafts;
}

export function rankCandidates(
  patients: {
    patient: PatientScreening;
    scheduleDate: string | null;
    facility: string;
    batchAssignedSchedulerId: number | null;
    derivedPatientType: "visit" | "outreach";
  }[],
  asOfDate: string,
  lastContactByPatient: Map<number, number> = new Map(), // pid -> epoch ms
): EligibleCandidate[] {
  // Tier-2 oldest-contact-first tiebreak: patients who have not been called
  // recently (or ever) move ahead of those just contacted. Tier-1 unchanged.
  // Age is computed relative to asOfDate midnight (UTC) — NOT Date.now() —
  // so backfill rebuilds for past or future dates produce stable orderings.
  const asOfMs = new Date(`${asOfDate}T00:00:00Z`).getTime();
  return patients
    .map((row) => {
      const k = priorityKey({
        // Use the derived classification (computed against live appointments
        // in the 90-day window). The stored `patient.patientType` column
        // can be stale and must NOT influence ranking.
        patientType: row.derivedPatientType,
        scheduleDate: row.scheduleDate,
        insurance: row.patient.insurance,
        qualifyingTests: row.patient.qualifyingTests,
        asOfDate,
      });
      let sort = k.sort;
      if (k.tier === 2) {
        // Tier 2: insurance → oldest last-contact → qualifying-test count.
        const last = lastContactByPatient.get(row.patient.id) ?? 0;
        const ageDays = last === 0 ? 9999 : Math.max(0, Math.round((asOfMs - last) / 86_400_000));
        sort = [k.sort[0], k.sort[1], -ageDays, k.sort[3]];
      }
      return { ...row, _key: sort };
    })
    .sort((a, b) => comparePriority(a._key, b._key))
    .map((row) => {
      const { _key, ...rest } = row;
      return rest;
    });
}

// ── Today's schedulers (PTO-aware) ────────────────────────────────────────
function ptoCoversDate(req: PtoRequest, day: string): boolean {
  return req.status === "approved" && req.startDate <= day && req.endDate >= day;
}

export async function activeSchedulersForToday(
  storage: IStorage,
  facility: string,
  asOfDate: string,
): Promise<OutreachScheduler[]> {
  const all = await storage.getOutreachSchedulers();
  const schedulers = all.filter((sc) => sc.facility === facility);
  if (schedulers.length === 0) return [];

  // Pull approved PTO that covers today and exclude any scheduler whose
  // user_id matches.
  const pto = await storage.getPtoRequests({ status: "approved", fromDate: asOfDate, toDate: asOfDate });
  const onPto = new Set<string>();
  for (const r of pto) if (ptoCoversDate(r, asOfDate)) onPto.add(r.userId);
  return schedulers.filter((sc) => !sc.userId || !onPto.has(sc.userId));
}

// ── Eligibility gather ────────────────────────────────────────────────────
// Eligibility is owned by `derivePatientType` (90-day classifier). The old
// 30-day VISIT_WINDOW_DAYS gate has been removed so the canonical signal
// drives both portal routing and engine selection.

async function gatherEligibleForFacility(
  storage: IStorage,
  facility: string,
  asOfDate: string,
): Promise<EligibleCandidate[]> {
  // Scheduler engine pool = derived "visit" patients only. The 90-day
  // classifier is the canonical eligibility window: any patient with a
  // scheduled appointment or batch visit date within the next 90 days
  // surfaces here. Outreach-tier patients are routed to the
  // technician/liaison portal instead. We deliberately do NOT apply the
  // legacy 30-day visit-window gate on top of derivedType — doing so
  // would exclude derived-visit patients in days 31–90 from scheduler
  // eligibility, which contradicts the canonical signal.
  const [batches, allScheduled] = await Promise.all([
    storage.getAllScreeningBatches(),
    storage.getAppointments({ status: "scheduled" }),
  ]);
  const facilityBatches: ScreeningBatch[] = batches.filter((b) => (b.facility ?? "") === facility);
  const apptsByPatient = new Map<number, AncillaryAppointment[]>();
  for (const a of allScheduled) {
    if (a.patientScreeningId == null) continue;
    const arr = apptsByPatient.get(a.patientScreeningId);
    if (arr) arr.push(a);
    else apptsByPatient.set(a.patientScreeningId, [a]);
  }

  const candidates: EligibleCandidate[] = [];
  for (const batch of facilityBatches) {
    const patients = await storage.getPatientScreeningsByBatch(batch.id);
    for (const p of patients) {
      const e = isEligibleForCallList(p);
      if (!e.eligible) continue;
      const derivedType = derivePatientType({
        appointments: apptsByPatient.get(p.id) ?? [],
        batchScheduleDate: batch.scheduleDate ?? null,
        storedPatientType: p.patientType,
        asOfDate,
      });
      if (derivedType !== "visit") continue;
      candidates.push({
        patient: p,
        facility,
        scheduleDate: batch.scheduleDate ?? null,
        batchAssignedSchedulerId: batch.assignedSchedulerId ?? null,
        derivedPatientType: derivedType,
      });
    }
  }
  return candidates;
}

// ── Idempotent build per (facility, day) ──────────────────────────────────
// Strategy: keep existing active assignments where the patient is still
// eligible AND the scheduler is still active today; release the rest;
// fill remaining capacity from the unassigned eligible pool. Single
// transaction so the daily build either fully applies or not at all.

export type BuildSummary = {
  facility: string;
  asOfDate: string;
  kept: number;
  released: number;
  created: number;
  schedulers: number;
  eligible: number;
};

export async function buildDailyAssignments(
  storage: IStorage,
  facility: string,
  asOfDate: string,
  baseDailyTarget = DEFAULT_BASE_DAILY_TARGET,
): Promise<BuildSummary> {
  // Sweep stale active rows from prior days before reading state.
  await storage.releaseStaleActiveAssignments(asOfDate, "stale_day_sweep");

  const [allSchedulers, schedulers, eligibleAll, existingAll] = await Promise.all([
    storage.getOutreachSchedulers(),
    activeSchedulersForToday(storage, facility, asOfDate),
    gatherEligibleForFacility(storage, facility, asOfDate),
    storage.listActiveSchedulerAssignments({ asOfDate }),
  ]);

  const eligibleByPatient = new Map<number, EligibleCandidate>();
  for (const c of eligibleAll) eligibleByPatient.set(c.patient.id, c);

  const facilitySchedulerIds = new Set(allSchedulers.filter((s) => s.facility === facility).map((s) => s.id));
  const activeSchedulerIds = new Set(schedulers.map((s) => s.id));

  // FACILITY SCOPING — only consider assignments whose scheduler belongs to
  // this facility. Releasing rows tied to other facilities' schedulers would
  // be a cross-facility data corruption bug.
  const facilityExisting = existingAll.filter((ex) => facilitySchedulerIds.has(ex.schedulerId));

  // Patients with active assignments anywhere (other facility too) must NOT
  // be re-assigned in this facility's pool.
  const patientsAssignedElsewhere = new Set(
    existingAll.filter((ex) => !facilitySchedulerIds.has(ex.schedulerId)).map((ex) => ex.patientScreeningId),
  );

  // Within facility: keep eligible+still-active pairs, release the rest.
  const keep: SchedulerAssignment[] = [];
  const release: SchedulerAssignment[] = [];
  for (const ex of facilityExisting) {
    if (eligibleByPatient.has(ex.patientScreeningId) && activeSchedulerIds.has(ex.schedulerId)) {
      keep.push(ex);
    } else {
      release.push(ex);
    }
  }

  const keptPatients = new Set(keep.map((k) => k.patientScreeningId));
  const remainingPool = eligibleAll.filter(
    (c) => !keptPatients.has(c.patient.id) && !patientsAssignedElsewhere.has(c.patient.id),
  );

  const directlyAssignedPool = remainingPool.filter(
    (c) =>
      c.batchAssignedSchedulerId != null &&
      facilitySchedulerIds.has(c.batchAssignedSchedulerId) &&
      activeSchedulerIds.has(c.batchAssignedSchedulerId),
  );

  const genericPool = remainingPool.filter((c) => c.batchAssignedSchedulerId == null);

  // Pull last-contact timestamps for the generic pool so the Tier-2 ranker
  // can prefer oldest-untouched first.
  const lastContact = new Map<number, number>();
  await Promise.all(
    genericPool.map(async (c) => {
      const last = await storage.latestOutreachCallForPatient(c.patient.id);
      if (last) {
        const t = new Date(last.startedAt as unknown as string).getTime();
        if (!isNaN(t)) lastContact.set(c.patient.id, t);
      }
    }),
  );
  const ranked = rankCandidates(genericPool, asOfDate, lastContact);

  const directCounts = new Map<number, number>();
  for (const c of directlyAssignedPool) {
    const schedulerId = c.batchAssignedSchedulerId!;
    directCounts.set(schedulerId, (directCounts.get(schedulerId) ?? 0) + 1);
  }

  // Subtract kept-load and direct-assignment load from each scheduler's capacity before greedy fill.
  const adjusted = schedulers.map((sc) => {
    const keptUsed = keep.filter((k) => k.schedulerId === sc.id).length;
    const directUsed = directCounts.get(sc.id) ?? 0;
    const cap = dailyCapacity(sc, baseDailyTarget);
    const remaining = Math.max(0, cap - keptUsed - directUsed);
    return { ...sc, capacityPercent: Math.round((remaining / Math.max(1, baseDailyTarget)) * 100) };
  });

  const directDrafts: AssignmentDraft[] = directlyAssignedPool.map((c) => ({
    patientScreeningId: c.patient.id,
    schedulerId: c.batchAssignedSchedulerId!,
    asOfDate,
    source: "manual",
  }));

  const balancedDrafts = buildAssignmentsForPool(ranked, adjusted, asOfDate, baseDailyTarget);
  const drafts = [...directDrafts, ...balancedDrafts];

  // Single transaction — release+create either both apply or neither does.
  await storage.applySchedulerAssignmentDiff(
    release.map((r) => r.id),
    drafts,
    "rebuild:patient_or_scheduler_no_longer_active",
  );

  return {
    facility,
    asOfDate,
    kept: keep.length,
    released: release.length,
    created: drafts.length,
    schedulers: schedulers.length,
    eligible: eligibleAll.length,
  };
}

// Single-patient hot path used when a patient becomes newly eligible
// outside the morning build (e.g. completed analysis, status reset).
export async function assignNewlyEligiblePatient(
  storage: IStorage,
  patient: PatientScreening,
  facility: string,
  asOfDate: string,
  baseDailyTarget = DEFAULT_BASE_DAILY_TARGET,
): Promise<SchedulerAssignment | null> {
  // Date-scoped so a stale prior-day row cannot block today's hot path.
  const existing = await storage.getActiveAssignmentForPatientOnDate(patient.id, asOfDate);
  if (existing) return existing;
  const e = isEligibleForCallList(patient);
  if (!e.eligible) return null;
  // Apply the canonical 90-day derived classifier on this hot path too —
  // outreach-tier patients must not enter the scheduler engine even when
  // they become "newly eligible" via status changes mid-day.
  const [allAppts, batch] = await Promise.all([
    storage.getAppointmentsByPatient(patient.id),
    patient.batchId ? storage.getScreeningBatch(patient.batchId) : Promise.resolve(undefined),
  ]);
  const derivedType = derivePatientType({
    appointments: allAppts.filter((a) => (a.status || "").toLowerCase() === "scheduled"),
    batchScheduleDate: batch?.scheduleDate ?? null,
    storedPatientType: patient.patientType,
    asOfDate,
  });
  if (derivedType !== "visit") return null;

  const schedulers = await activeSchedulersForToday(storage, facility, asOfDate);
  if (schedulers.length === 0) return null;

  if (batch?.assignedSchedulerId != null) {
    const assigned = schedulers.find((s) => s.id === batch.assignedSchedulerId);
    if (!assigned) return null;
    return storage.createSchedulerAssignment({
      patientScreeningId: patient.id,
      schedulerId: assigned.id,
      asOfDate,
      source: "manual",
    });
  }

  const existingDay = await storage.listActiveSchedulerAssignments({ asOfDate });
  const load = new Map<number, number>();
  for (const a of existingDay) load.set(a.schedulerId, (load.get(a.schedulerId) ?? 0) + 1);

  let best: OutreachScheduler | null = null;
  let bestRemaining = -1;
  for (const sc of schedulers) {
    const remaining = dailyCapacity(sc, baseDailyTarget) - (load.get(sc.id) ?? 0);
    if (remaining <= 0) continue;
    if (remaining > bestRemaining) { best = sc; bestRemaining = remaining; }
  }
  if (!best) return null;
  return storage.createSchedulerAssignment({
    patientScreeningId: patient.id,
    schedulerId: best.id,
    asOfDate,
    source: "auto",
  });
}

// ── PTO release + redistribute ────────────────────────────────────────────
export type RedistributeSummary = {
  schedulerId: number;
  asOfDate: string;
  released: number;
  reassigned: number;
  unassigned: number;
};

export async function releaseAndRedistribute(
  storage: IStorage,
  schedulerId: number,
  asOfDate: string,
  reason: string,
  baseDailyTarget = DEFAULT_BASE_DAILY_TARGET,
): Promise<RedistributeSummary> {
  // Find the scheduler's facility so we know the redistribute pool.
  const allScheds = await storage.getOutreachSchedulers();
  const sched = allScheds.find((s) => s.id === schedulerId);
  if (!sched) {
    return { schedulerId, asOfDate, released: 0, reassigned: 0, unassigned: 0 };
  }
  // Compute what would be released by reading active rows for this scheduler
  // & day; we'll do the actual release + reassignment inserts atomically
  // below so a crash mid-loop can never leave released-but-not-reassigned rows.
  const released = (await storage.listActiveSchedulerAssignments({ schedulerId, asOfDate }));
  if (released.length === 0) {
    return { schedulerId, asOfDate, released: 0, reassigned: 0, unassigned: 0 };
  }

  // Pool = remaining active schedulers in same facility (PTO-aware via
  // activeSchedulersForToday — but we explicitly drop the released one).
  const activeToday = (await activeSchedulersForToday(storage, sched.facility, asOfDate))
    .filter((s) => s.id !== schedulerId);

  if (activeToday.length === 0) {
    return { schedulerId, asOfDate, released: released.length, reassigned: 0, unassigned: released.length };
  }

  const existingDay = await storage.listActiveSchedulerAssignments({ asOfDate });
  const load = new Map<number, number>();
  for (const a of existingDay) load.set(a.schedulerId, (load.get(a.schedulerId) ?? 0) + 1);

  // URGENT-FIRST: rank released patients by priority before redistributing,
  // so the most time-sensitive (Tier-1 visit-soon) patients are placed first
  // when remaining capacity is scarce. We must look up each patient's
  // batch.scheduleDate so visit urgency is preserved — passing null here
  // would collapse all released patients into Tier-2 and lose the urgency
  // signal entirely.
  const allBatches = await storage.getAllScreeningBatches();
  const batchById = new Map(allBatches.map((b) => [b.id, b]));
  // Bulk-fetch scheduled appointments once so we can derive each released
  // patient's type without N round-trips. The derived type — not the
  // possibly-stale stored column — drives ranking for redistribution.
  const allScheduled = await storage.getAppointments({ status: "scheduled" });
  const apptsByPatient = new Map<number, AncillaryAppointment[]>();
  for (const a of allScheduled) {
    if (a.patientScreeningId == null) continue;
    const arr = apptsByPatient.get(a.patientScreeningId);
    if (arr) arr.push(a);
    else apptsByPatient.set(a.patientScreeningId, [a]);
  }
  const releasedPatients = await Promise.all(
    released.map(async (r) => {
      const p = await storage.getPatientScreening(r.patientScreeningId);
      const scheduleDate = p?.batchId ? batchById.get(p.batchId)?.scheduleDate ?? null : null;
      return { release: r, patient: p, scheduleDate };
    }),
  );
  const releasedRanked = releasedPatients
    .filter((rp): rp is { release: typeof released[number]; patient: PatientScreening; scheduleDate: string | null } => !!rp.patient)
    .map((rp) => {
      const derivedType = derivePatientType({
        appointments: apptsByPatient.get(rp.patient.id) ?? [],
        batchScheduleDate: rp.scheduleDate,
        storedPatientType: rp.patient.patientType,
        asOfDate,
      });
      return {
        ...rp,
        derivedPatientType: derivedType,
        _key: priorityKey({
          // Derived type drives priority — stored column is stale-prone.
          patientType: derivedType,
          scheduleDate: rp.scheduleDate,
          insurance: rp.patient.insurance,
          qualifyingTests: rp.patient.qualifyingTests,
          asOfDate,
        }).sort,
      };
    })
    .sort((a, b) => comparePriority(a._key, b._key));

  // Build the set of reassignment drafts in memory first, then apply
  // release + insert atomically through applySchedulerAssignmentDiff.
  const drafts: InsertSchedulerAssignment[] = [];
  for (const { release: r } of releasedRanked) {
    let best: OutreachScheduler | null = null;
    let bestRemaining = -1;
    for (const sc of activeToday) {
      const remaining = dailyCapacity(sc, baseDailyTarget) - (load.get(sc.id) ?? 0);
      if (remaining <= 0) continue;
      if (remaining > bestRemaining) { best = sc; bestRemaining = remaining; }
    }
    if (!best) break;
    drafts.push({
      patientScreeningId: r.patientScreeningId,
      schedulerId: best.id,
      asOfDate,
      source: "reassigned",
      originalSchedulerId: schedulerId,
      reason,
    });
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
  }

  await storage.applySchedulerAssignmentDiff(
    released.map((r) => r.id),
    drafts,
    reason,
  );
  const reassigned = drafts.length;

  return {
    schedulerId,
    asOfDate,
    released: released.length,
    reassigned,
    unassigned: released.length - reassigned,
  };
}
