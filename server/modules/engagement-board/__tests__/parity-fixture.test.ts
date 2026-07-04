import { describe, it } from "vitest";
// Engagement Board v2 — parity fixture (Bundle 22).
//
// Runnable via:
//   npx tsx server/modules/engagement-board/__tests__/parity-fixture.test.ts
//
// PURPOSE
//   Pins the EngagementBoardRow projection used by the legacy
//   GET /api/engagement/assignment-board handler
//   (server/routes/engagementAssignmentBoard.ts:274-319) so any
//   future v2 read-model endpoint produces a byte-equivalent row
//   shape on the same canonical input. Same pattern as the
//   operational-queue projection-parity test (Bundle 12, PR #94)
//   and the patient-directory parity fixture (Bundle 21, PR #105).
//
// SAFETY / SCOPE
//   - No DB, no app boot, no network.
//   - No PHI in fixtures (synthetic names; 555- phones; no real
//     facility names beyond a "Clinic A" / "Clinic B" naming).
//   - Reference algorithm is read-only and never mutates input.
//   - The legacy assignment-board route is NOT touched by this
//     bundle — the test only encodes the projection rule.
//
// CONTRACT
//   shared/contracts/engagementBoard.ts (EngagementBoardRow)
//   server/modules/engagement-board/contracts.ts
//   server/routes/engagementAssignmentBoard.ts:274-319 (legacy projection)
//
// Exit 0 = pass; exit 1 = fail.

import type { EngagementBoardRow } from "../contracts";

// ─── Synthetic source-table row shapes ─────────────────────────────
//
// These mirror the SLICES of patient_execution_cases,
// patient_screenings, screening_batches, and outreach_schedulers
// the legacy route reads. Local declarations keep the test free of
// any Drizzle / @shared/schema runtime dep.

type ExecCaseRow = {
  id: number;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  nextActionAt: string | null;
  selectedServices: string[] | null;
};

type ScreeningRow = {
  id: number;
  name: string | null;
  dob: string | null;
  phoneNumber: string | null;
  facility: string | null;
  patientType: string | null;
  commitStatus: string | null;
  batchId: number | null;
  deletedAt: Date | null;
};

type BatchRow = {
  id: number;
  facility: string | null;
  scheduleDate: string | null;
};

type SchedulerRow = {
  id: number;
  name: string | null;
  facility: string | null;
};

type JourneyTip = {
  executionCaseId: number;
  createdAt: Date | null;
  summary: string | null;
};

// ─── Test infra ───────────────────────────────────────────────────
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

function eq<T>(actual: T, expected: T, label: string): void {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const b = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== b) {
    failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
  }
}

// ─── Reference computeMissingInfo (mirrors legacy lines 151-161) ───
function computeMissingInfo_REFERENCE(
  screening: ScreeningRow | undefined,
): string[] {
  const out: string[] = [];
  if (!screening) return ["patient_record"];
  if (!screening.name?.trim()) out.push("name");
  if (!screening.dob?.trim()) out.push("DOB");
  if (!screening.phoneNumber?.trim()) out.push("phone");
  if (!screening.facility?.trim()) out.push("facility");
  return out;
}

// ─── Reference projection (mirrors legacy lines 274-319) ──────────
function projectToEngagementBoardRows_REFERENCE(
  cases: ReadonlyArray<ExecCaseRow>,
  screenings: ReadonlyArray<ScreeningRow>,
  batches: ReadonlyArray<BatchRow>,
  schedulers: ReadonlyArray<SchedulerRow>,
  latestJourneyByCase: ReadonlyMap<number, JourneyTip>,
): EngagementBoardRow[] {
  const screeningById = new Map(screenings.map((s) => [s.id, s]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const schedulerById = new Map(schedulers.map((s) => [s.id, s]));

  const rows: EngagementBoardRow[] = cases.map((c) => {
    const screening =
      c.patientScreeningId != null ? screeningById.get(c.patientScreeningId) : undefined;
    const batch =
      screening?.batchId != null ? batchById.get(screening.batchId) : undefined;
    const assignedScheduler =
      c.assignedTeamMemberId != null
        ? schedulerById.get(c.assignedTeamMemberId)
        : undefined;
    const latest = latestJourneyByCase.get(c.id);
    const facility =
      screening?.facility ?? batch?.facility ?? c.facilityId ?? null;

    return {
      patientScreeningId: c.patientScreeningId ?? null,
      executionCaseId: c.id,
      patientName: c.patientName ?? screening?.name ?? "Unnamed",
      patientDob: c.patientDob ?? screening?.dob ?? null,
      phoneNumber: screening?.phoneNumber ?? null,
      facility,
      scheduleDate: batch?.scheduleDate ?? null,
      patientType: screening?.patientType ?? null,
      engagementBucket: c.engagementBucket ?? null,
      engagementStatus: c.engagementStatus ?? null,
      commitStatus: screening?.commitStatus ?? null,
      assignedTeamMemberId: c.assignedTeamMemberId ?? null,
      assignedRole: c.assignedRole ?? null,
      assignedName: assignedScheduler?.name ?? null,
      assignedFacility: assignedScheduler?.facility ?? null,
      nextActionAt: c.nextActionAt
        ? new Date(c.nextActionAt as unknown as string).toISOString()
        : null,
      lastActivityAt: latest?.createdAt
        ? new Date(latest.createdAt).toISOString()
        : null,
      lastActivitySummary: latest?.summary ?? null,
      missingInfo: computeMissingInfo_REFERENCE(screening),
      selectedServices: Array.isArray(c.selectedServices)
        ? (c.selectedServices as string[])
        : [],
    };
  });
  return rows;
}

// ─── Canned PHI-safe fixtures ──────────────────────────────────────

const FIXED_NEXT_ACTION = "2026-06-12T14:00:00.000Z";
const FIXED_LAST_ACTIVITY = new Date("2026-06-09T09:30:00.000Z");
const FIXED_SCHEDULE_DATE = "2026-06-10";

const fixtureScreenings: ScreeningRow[] = [
  {
    id: 1001,
    name: "Alpha One",
    dob: "1980-01-15",
    phoneNumber: "555-0101",
    facility: "Clinic A",
    patientType: "new",
    commitStatus: "Ready",
    batchId: 9001,
    deletedAt: null,
  },
  {
    id: 1002,
    name: "Beta Two",
    dob: null, // triggers missing DOB
    phoneNumber: null, // triggers missing phone
    facility: "Clinic B",
    patientType: "returning",
    commitStatus: "Draft",
    batchId: 9002,
    deletedAt: null,
  },
];
const fixtureBatches: BatchRow[] = [
  { id: 9001, facility: "Clinic A", scheduleDate: FIXED_SCHEDULE_DATE },
  { id: 9002, facility: "Clinic B", scheduleDate: null },
];
const fixtureSchedulers: SchedulerRow[] = [
  { id: 7, name: "Scheduler X", facility: "Clinic A" },
];
const fixtureLatestJourney = new Map<number, JourneyTip>([
  [
    501,
    {
      executionCaseId: 501,
      createdAt: FIXED_LAST_ACTIVITY,
      summary: "Outreach contact attempted",
    },
  ],
]);
const fixtureCases: ExecCaseRow[] = [
  {
    id: 501,
    patientScreeningId: 1001,
    patientName: "Alpha One",
    patientDob: "1980-01-15",
    facilityId: null,
    engagementBucket: "ready",
    engagementStatus: "assigned",
    assignedTeamMemberId: 7,
    assignedRole: "scheduler",
    nextActionAt: FIXED_NEXT_ACTION,
    selectedServices: ["service_a", "service_b"],
  },
  {
    id: 502,
    patientScreeningId: 1002,
    patientName: null, // forces fallback to screening name
    patientDob: null,
    facilityId: null,
    engagementBucket: null,
    engagementStatus: "new",
    assignedTeamMemberId: null, // unassigned
    assignedRole: null,
    nextActionAt: null,
    selectedServices: null, // forces fallback to []
  },
  {
    id: 503,
    patientScreeningId: null, // no screening link — name/dob from case
    patientName: "Gamma Three",
    patientDob: "1992-03-22",
    facilityId: "Clinic C", // case-level facility fallback
    engagementBucket: null,
    engagementStatus: "new",
    assignedTeamMemberId: null,
    assignedRole: null,
    nextActionAt: null,
    selectedServices: [],
  },
];

// ─── §1: Shape projection — every documented field round-trips ────
{
  const rows = projectToEngagementBoardRows_REFERENCE(
    fixtureCases,
    fixtureScreenings,
    fixtureBatches,
    fixtureSchedulers,
    fixtureLatestJourney,
  );
  check(rows.length === 3, `§1: expected 3 rows, got ${rows.length}`);
  const r0 = rows[0]!;
  // Fully populated row — every leg of fallback chains is exercised.
  eq(r0.patientScreeningId, 1001, "§1: row[0].patientScreeningId");
  eq(r0.executionCaseId, 501, "§1: row[0].executionCaseId");
  eq(r0.patientName, "Alpha One", "§1: row[0].patientName");
  eq(r0.patientDob, "1980-01-15", "§1: row[0].patientDob");
  eq(r0.phoneNumber, "555-0101", "§1: row[0].phoneNumber");
  eq(r0.facility, "Clinic A", "§1: row[0].facility");
  eq(r0.scheduleDate, FIXED_SCHEDULE_DATE, "§1: row[0].scheduleDate");
  eq(r0.patientType, "new", "§1: row[0].patientType");
  eq(r0.engagementBucket, "ready", "§1: row[0].engagementBucket");
  eq(r0.engagementStatus, "assigned", "§1: row[0].engagementStatus");
  eq(r0.commitStatus, "Ready", "§1: row[0].commitStatus");
  eq(r0.assignedTeamMemberId, 7, "§1: row[0].assignedTeamMemberId");
  eq(r0.assignedRole, "scheduler", "§1: row[0].assignedRole");
  eq(r0.assignedName, "Scheduler X", "§1: row[0].assignedName");
  eq(r0.assignedFacility, "Clinic A", "§1: row[0].assignedFacility");
  eq(r0.nextActionAt, new Date(FIXED_NEXT_ACTION).toISOString(), "§1: row[0].nextActionAt");
  eq(r0.lastActivityAt, FIXED_LAST_ACTIVITY.toISOString(), "§1: row[0].lastActivityAt");
  eq(r0.lastActivitySummary, "Outreach contact attempted", "§1: row[0].lastActivitySummary");
  // missingInfo: screening 1001 is fully populated → empty array.
  check(r0.missingInfo.length === 0, `§1: row[0].missingInfo expected [] got [${r0.missingInfo.join(",")}]`);
  check(
    r0.selectedServices.length === 2 && r0.selectedServices[0] === "service_a",
    "§1: row[0].selectedServices",
  );
}

// ─── §2: Missing-info compute — null/empty fields surface ──────────
{
  const rows = projectToEngagementBoardRows_REFERENCE(
    fixtureCases,
    fixtureScreenings,
    fixtureBatches,
    fixtureSchedulers,
    fixtureLatestJourney,
  );
  const r1 = rows[1]!; // Beta — missing DOB + phone
  const missing = r1.missingInfo.slice().sort();
  check(
    missing.length === 2 && missing[0] === "DOB" && missing[1] === "phone",
    `§2: row[1].missingInfo expected [DOB, phone] got [${missing.join(",")}]`,
  );
  // Beta is unassigned — assigned* fields fall back to null.
  eq(r1.assignedTeamMemberId, null, "§2: row[1] unassigned");
  eq(r1.assignedName, null, "§2: row[1].assignedName null");
  // patientName comes from the screening (case.patientName was null).
  eq(r1.patientName, "Beta Two", "§2: row[1].patientName from screening");
  // selectedServices null on the case → projection emits [].
  check(r1.selectedServices.length === 0, "§2: row[1].selectedServices [] from null");
}

// ─── §3: No-screening case — fallback to case-level identity + facility ─
{
  const rows = projectToEngagementBoardRows_REFERENCE(
    fixtureCases,
    fixtureScreenings,
    fixtureBatches,
    fixtureSchedulers,
    fixtureLatestJourney,
  );
  const r2 = rows[2]!;
  eq(r2.patientName, "Gamma Three", "§3: case-level patientName");
  eq(r2.patientDob, "1992-03-22", "§3: case-level patientDob");
  eq(r2.facility, "Clinic C", "§3: case-level facility fallback");
  eq(r2.phoneNumber, null, "§3: no screening → phone null");
  eq(r2.commitStatus, null, "§3: no screening → commitStatus null");
  eq(r2.scheduleDate, null, "§3: no screening → no batch → scheduleDate null");
  // computeMissingInfo for missing screening returns ["patient_record"].
  check(
    r2.missingInfo.length === 1 && r2.missingInfo[0] === "patient_record",
    `§3: missingInfo expected [patient_record] got [${r2.missingInfo.join(",")}]`,
  );
}

// ─── §4: Input not mutated ────────────────────────────────────────
{
  const frozenCases = Object.freeze(fixtureCases.map((c) => Object.freeze({ ...c })));
  const frozenScreenings = Object.freeze(fixtureScreenings.map((s) => Object.freeze({ ...s })));
  const frozenBatches = Object.freeze(fixtureBatches.map((b) => Object.freeze({ ...b })));
  const frozenSchedulers = Object.freeze(fixtureSchedulers.map((s) => Object.freeze({ ...s })));
  let threw = false;
  try {
    projectToEngagementBoardRows_REFERENCE(
      frozenCases as ExecCaseRow[],
      frozenScreenings as ScreeningRow[],
      frozenBatches as BatchRow[],
      frozenSchedulers as SchedulerRow[],
      fixtureLatestJourney,
    );
  } catch (err) {
    threw = true;
    failures.push(
      `§4: projection threw on frozen input — possible mutation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  check(!threw, "§4: projection must not mutate input");
}

// ─── §5: Empty cases → empty rows array ───────────────────────────
{
  const rows = projectToEngagementBoardRows_REFERENCE(
    [],
    fixtureScreenings,
    fixtureBatches,
    fixtureSchedulers,
    fixtureLatestJourney,
  );
  check(rows.length === 0, `§5: empty cases → empty rows, got ${rows.length}`);
}

// ─── §6: PHI-safe fixture guard ───────────────────────────────────
{
  for (const s of fixtureScreenings) {
    if (s.phoneNumber !== null) {
      check(s.phoneNumber.startsWith("555-"), `§6: phone "${s.phoneNumber}" must be 555-prefix`);
    }
    if (s.name !== null) {
      check(
        /^(alpha|beta|gamma|delta|epsilon)\s/i.test(s.name),
        `§6: screening name "${s.name}" must use synthetic Greek-letter convention`,
      );
    }
  }
  for (const c of fixtureCases) {
    if (c.patientName !== null) {
      check(
        /^(alpha|beta|gamma|delta|epsilon)\s/i.test(c.patientName),
        `§6: case name "${c.patientName}" must use synthetic Greek-letter convention`,
      );
    }
  }
}

describe("Engagement Board v2 parity fixture", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Engagement Board v2 parity fixture failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
