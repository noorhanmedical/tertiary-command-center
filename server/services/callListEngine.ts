import type { IStorage } from "../storage";
import type {
  OutreachScheduler,
  PatientScreening,
  SchedulerAssignment,
  ScreeningBatch,
  PtoRequest,
} from "@shared/schema";
import { isEligibleForCallList, priorityKey, comparePriority } from "./callListPriority";

// ── Configuration ──────────────────────────────────────────────────────────
// "Base" daily target = how many calls a 100% capacity scheduler can handle
// in one day. A scheduler at capacity P% can hold up to round(P/100 * base)
// active assignments. Tunable via env without code change.
const DEFAULT_BASE_DAILY_TARGET = Number(process.env.CALL_LIST_BASE_DAILY_TARGET ?? 60);

export type EligibleCandidate = {
  patient: PatientScreening;
  facility: string;
  scheduleDate: string | null;
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

  const drafts: AssignmentDraft[] = [];
  for (const c of candidates) {
    let best: OutreachScheduler | null = null;
    let bestRemaining = -1;
    for (const sc of schedulers) {
      const remaining = (cap.get(sc.id) ?? 0) - (load.get(sc.id) ?? 0);
      if (remaining <= 0) continue;
      if (
        remaining > bestRemaining ||
        (remaining === bestRemaining && best && (sc.capacityPercent ?? 100) > (best.capacityPercent ?? 100)) ||
        (remaining === bestRemaining && best && sc.id < best.id)
      ) {
        best = sc;
        bestRemaining = remaining;
      }
    }
    if (!best) break; // Pool fully saturated.
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
  patients: { patient: PatientScreening; scheduleDate: string | null; facility: string }[],
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
        patientType: row.patient.patientType,
        scheduleDate: row.scheduleDate,
        insurance: row.patient.insurance,
        qualifyingTests: row.patient.qualifyingTests,
        asOfDate,
      });
      let sort = k.sort;
      if (k.tier === 2) {
        const last = lastContactByPatient.get(row.patient.id) ?? 0;
        const ageDays = last === 0 ? 9999 : Math.max(0, Math.round((asOfMs - last) / 86_400_000));
        sort = [k.sort[0], k.sort[1], k.sort[2], -ageDays];
      }
      return { ...row, _key: sort };
    })
    .sort((a, b) => comparePriority(a._key, b._key))
    .map(({ _key, ...rest }) => rest);
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
const VISIT_WINDOW_DAYS = Number(process.env.CALL_LIST_VISIT_WINDOW_DAYS ?? 30);

function withinVisitWindow(scheduleDate: string | null, asOfDate: string): boolean {
  if (!scheduleDate) return true; // outreach-only patients have no scheduleDate
  const d = scheduleDate.slice(0, 10);
  if (d < asOfDate) return false; // visit already passed — Tier-2 path uses outreach
  const start = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const dest = new Date(`${d}T00:00:00Z`).getTime();
  if (isNaN(start) || isNaN(dest)) return false;
  const diffDays = Math.round((dest - start) / 86_400_000);
  return diffDays <= VISIT_WINDOW_DAYS;
}

async function gatherEligibleForFacility(
  storage: IStorage,
  facility: string,
  asOfDate: string,
): Promise<EligibleCandidate[]> {
  // Visit-tier patients = anyone in a batch within the next 30 days for
  // this facility. Outreach-tier patients (patientType='outreach') bypass
  // the visit window — they have no upcoming visit anchoring them to a
  // date and should remain eligible until contacted/completed.
  const batches = await storage.getAllScreeningBatches();
  const facilityBatches: ScreeningBatch[] = batches.filter((b) => (b.facility ?? "") === facility);

  const candidates: EligibleCandidate[] = [];
  for (const batch of facilityBatches) {
    const inVisitWindow = withinVisitWindow(batch.scheduleDate ?? null, asOfDate);
    const patients = await storage.getPatientScreeningsByBatch(batch.id);
    for (const p of patients) {
      const e = isEligibleForCallList(p);
      if (!e.eligible) continue;
      // Visit-type patients are gated by the 30-day window; outreach-type
      // are always eligible regardless of the batch's schedule date.
      const isOutreach = (p.patientType ?? "").toLowerCase() === "outreach";
      if (!isOutreach && !inVisitWindow) continue;
      candidates.push({ patient: p, facility, scheduleDate: batch.scheduleDate ?? null });
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
  // Pull last-contact timestamps for the remaining-pool patients so the
  // Tier-2 ranker can prefer oldest-untouched first.
  const lastContact = new Map<number, number>();
  await Promise.all(
    remainingPool.map(async (c) => {
      const last = await storage.latestOutreachCallForPatient(c.patient.id);
      if (last) {
        const t = new Date(last.startedAt as unknown as string).getTime();
        if (!isNaN(t)) lastContact.set(c.patient.id, t);
      }
    }),
  );
  const ranked = rankCandidates(remainingPool, asOfDate, lastContact);

  // Subtract kept-load from each scheduler's capacity before greedy fill.
  const adjusted = schedulers.map((sc) => {
    const used = keep.filter((k) => k.schedulerId === sc.id).length;
    const cap = dailyCapacity(sc, baseDailyTarget);
    const remaining = Math.max(0, cap - used);
    return { ...sc, capacityPercent: Math.round((remaining / Math.max(1, baseDailyTarget)) * 100) };
  });

  const drafts = buildAssignmentsForPool(ranked, adjusted, asOfDate, baseDailyTarget);

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
  const existing = await storage.getActiveAssignmentForPatient(patient.id);
  if (existing) return existing;
  const e = isEligibleForCallList(patient);
  if (!e.eligible) return null;
  const schedulers = await activeSchedulersForToday(storage, facility, asOfDate);
  if (schedulers.length === 0) return null;
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
  const released = await storage.releaseSchedulerAssignmentsForScheduler(schedulerId, asOfDate, reason);
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
  const releasedPatients = await Promise.all(
    released.map(async (r) => {
      const p = await storage.getPatientScreening(r.patientScreeningId);
      const scheduleDate = p?.batchId ? batchById.get(p.batchId)?.scheduleDate ?? null : null;
      return { release: r, patient: p, scheduleDate };
    }),
  );
  const releasedRanked = releasedPatients
    .filter((rp): rp is { release: typeof released[number]; patient: PatientScreening; scheduleDate: string | null } => !!rp.patient)
    .map((rp) => ({
      ...rp,
      _key: priorityKey({
        patientType: rp.patient.patientType,
        scheduleDate: rp.scheduleDate,
        insurance: rp.patient.insurance,
        qualifyingTests: rp.patient.qualifyingTests,
        asOfDate,
      }).sort,
    }))
    .sort((a, b) => comparePriority(a._key, b._key));

  let reassigned = 0;
  for (const { release: r } of releasedRanked) {
    let best: OutreachScheduler | null = null;
    let bestRemaining = -1;
    for (const sc of activeToday) {
      const remaining = dailyCapacity(sc, baseDailyTarget) - (load.get(sc.id) ?? 0);
      if (remaining <= 0) continue;
      if (remaining > bestRemaining) { best = sc; bestRemaining = remaining; }
    }
    if (!best) break;
    await storage.createSchedulerAssignment({
      patientScreeningId: r.patientScreeningId,
      schedulerId: best.id,
      asOfDate,
      source: "reassigned",
      originalSchedulerId: schedulerId,
      reason,
    });
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
    reassigned += 1;
  }

  return {
    schedulerId,
    asOfDate,
    released: released.length,
    reassigned,
    unassigned: released.length - reassigned,
  };
}
