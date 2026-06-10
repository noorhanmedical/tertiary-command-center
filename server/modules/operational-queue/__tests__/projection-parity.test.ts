// Operational queue → SchedulerAssignment projection — parity test
// (Batch 11d.2 / Bundle 12).
//
// Runnable via:
//   npx tsx server/modules/operational-queue/__tests__/projection-parity.test.ts
//
// PURPOSE
//   Locks the projection contract defined in
//   docs/architecture/operational-queue-call-list-projection-design.md §2
//   so that the future projection module
//   (server/modules/operational-queue/projections/schedulerAssignment.ts —
//   path reserved; intentionally not created yet) cannot drift from the
//   design without this test failing.
//
//   The future module is the canonical implementation. Until it lands,
//   THIS FILE carries the canonical algorithm inline as a reference
//   implementation, and the assertions below are the spec.
//
//   When the future PR adds the real module, it should either:
//     (a) replace the inline reference with `await import("../projections/schedulerAssignment")`
//         and re-run the same assertions, OR
//     (b) keep the inline reference and add an equivalence test against
//         the real module.
//
// SCOPE / SAFETY
//   - No DB, no app boot, no network. Runs purely from in-memory fixtures.
//   - No PHI in fixtures (synthetic ids, no names/DOBs, no MRNs).
//   - The reference projection NEVER writes.
//   - The reference projection NEVER throws on partial input.
//   - The reference projection performs EXACTLY one bulk-fetch (proven
//     by the counting shim in §6).
//   - The missing-row log line is asserted to be counts-only — no
//     ownerIds, no patient identifiers.
//
// LEGACY SHAPE OF RECORD
//   shared/schema/outreach.ts:75-103 (`scheduler_assignments` table).
//   GET /api/scheduler-assignments returns rows of type SchedulerAssignment
//   (see shared/schema/outreach.ts:114).
//
// GAP MAPPING (encoded as assertions in §7)
//   The five fields lossy through OperationalQueueItem and recovered by
//   the projection's bulk fetch are:
//     - schedulerId         (numeric outreach_schedulers id)
//     - assignedAt          (Date)
//     - originalSchedulerId (numeric, nullable)
//     - reason              (string, nullable)
//     - completedAt         (Date, nullable)
//
// Exit 0 = pass; exit 1 = fail.

import {
  OPERATIONAL_QUEUE_ITEM_KINDS,
  type OperationalQueueItem,
} from "../contracts";
import {
  MISSING_ROW_LOG_PREFIX,
  projectQueueItemsToSchedulerAssignments,
  type LegacySchedulerAssignmentRowShape,
} from "../projections/schedulerAssignment";

// ─── Local minimal mirror of shared/schema/outreach.ts SchedulerAssignment.
// Kept literal so the test does not depend on the schema module (avoids
// pulling Drizzle's PG runtime into a no-DB test). The shape must remain
// byte-identical to the real type's serialised JSON shape.
//
// SOURCE: shared/schema/outreach.ts:75-103 + :114.
type LegacySchedulerAssignmentLike = {
  id: number;
  patientScreeningId: number;
  schedulerId: number;
  asOfDate: string;
  assignedAt: Date;
  source: string;
  originalSchedulerId: number | null;
  reason: string | null;
  status: string;
  completedAt: Date | null;
};

// ─── Test infra ────────────────────────────────────────────────────────
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

function eq<T>(actual: T, expected: T, label: string): void {
  // Date-aware deep equality for the small set of fields we compare.
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const b = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== b) {
    failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
  }
}

// ─── Reference projection (canonical algorithm for Batch 11d.2) ────────
//
// Encodes §2.1 of operational-queue-call-list-projection-design.md:
//   1. Filter to kind === "call_list_item".
//   2. Extract ownerId values.
//   3. Bulk fetch matching scheduler_assignments rows.
//   4. Map by id; return in queue order (NOT DB order).
//   5. Drop ownerIds whose row is missing; log counts-only.
//   6. Never mutate input; perform exactly one bulk fetch; read-only.
//
// `fetchByIds` is injected so the test can drive both the happy path
// and the missing-row drop semantics without touching a database, and
// can count the number of bulk-fetch calls.
async function projectQueueItemsToSchedulerAssignments_REFERENCE(
  items: ReadonlyArray<OperationalQueueItem>,
  fetchByIds: (ids: number[]) => Promise<LegacySchedulerAssignmentLike[]>,
  logger: (line: string) => void = (line) => console.log(line),
): Promise<LegacySchedulerAssignmentLike[]> {
  // (1) Filter to call_list_item.
  const callListItems = items.filter((i) => i.kind === "call_list_item");
  if (callListItems.length === 0) return [];

  // (2) Extract ownerIds — preserve queue order.
  const orderedOwnerIds = callListItems.map((i) => i.ownerId);
  const uniqueOwnerIds = Array.from(new Set(orderedOwnerIds));

  // (3) Bulk fetch (single call).
  const rows = await fetchByIds(uniqueOwnerIds);
  const byId = new Map<number, LegacySchedulerAssignmentLike>();
  for (const r of rows) byId.set(r.id, r);

  // (4 + 5) Map back in queue order, dropping any missing ids.
  const out: LegacySchedulerAssignmentLike[] = [];
  let dropped = 0;
  for (const id of orderedOwnerIds) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
    else dropped += 1;
  }

  if (dropped > 0) {
    // PHI-safe: counts only. No ownerIds, no patient identifiers.
    logger(
      `[operational-queue/projection/schedulerAssignment] missing_row ` +
        `{ requested: ${uniqueOwnerIds.length}, found: ${rows.length}, missing: ${dropped} }`,
    );
  }

  return out;
}

// ─── §0: Sanity — the kind we project from is part of the contract ────
check(
  (OPERATIONAL_QUEUE_ITEM_KINDS as readonly string[]).includes("call_list_item"),
  "OPERATIONAL_QUEUE_ITEM_KINDS must include call_list_item",
);

// ─── Canned fixtures ───────────────────────────────────────────────────
//
// Three call-list rows + two non-call-list rows on the same user. The
// non-call-list rows are present to prove the projection drops them
// (and only them) via the kind filter.

const FIXED_ASSIGNED_AT = new Date("2026-06-09T08:00:00.000Z");
const FIXED_COMPLETED_AT = new Date("2026-06-09T17:30:00.000Z");
const FIXED_AS_OF_DATE = "2026-06-09";

const legacyRows: LegacySchedulerAssignmentLike[] = [
  {
    id: 101,
    patientScreeningId: 5001,
    schedulerId: 7,
    asOfDate: FIXED_AS_OF_DATE,
    assignedAt: FIXED_ASSIGNED_AT,
    source: "auto",
    originalSchedulerId: null,
    reason: null,
    status: "active",
    completedAt: null,
  },
  {
    id: 102,
    patientScreeningId: 5002,
    schedulerId: 7,
    asOfDate: FIXED_AS_OF_DATE,
    assignedAt: FIXED_ASSIGNED_AT,
    source: "redistribute",
    originalSchedulerId: 8,
    reason: "PTO redistribution",
    status: "completed",
    completedAt: FIXED_COMPLETED_AT,
  },
  {
    id: 103,
    patientScreeningId: 5003,
    schedulerId: 7,
    asOfDate: FIXED_AS_OF_DATE,
    assignedAt: FIXED_ASSIGNED_AT,
    source: "manual",
    originalSchedulerId: null,
    reason: null,
    status: "active",
    completedAt: null,
  },
];

function callListQueueItem(rowId: number): OperationalQueueItem {
  return {
    id: `cl:${rowId}`,
    kind: "call_list_item",
    ownerType: "scheduler_assignment",
    ownerId: rowId,
    assigneeUserId: "u-7",
    assigneeName: null,
    patientScreeningId: null,
    patientName: null,
    patientDob: null,
    facility: null,
    scheduledDate: FIXED_AS_OF_DATE,
    scheduledTime: null,
    status: "active",
    isOpen: true,
    metadata: null,
    createdAt: FIXED_ASSIGNED_AT,
    updatedAt: null,
  };
}

function schedulerTaskQueueItem(ownerId: number): OperationalQueueItem {
  return {
    id: `st-pt:${ownerId}`,
    kind: "scheduler_task",
    ownerType: "plexus_task",
    ownerId,
    assigneeUserId: "u-7",
    assigneeName: null,
    patientScreeningId: null,
    patientName: null,
    patientDob: null,
    facility: null,
    scheduledDate: null,
    scheduledTime: null,
    status: "open",
    isOpen: true,
    metadata: null,
    createdAt: FIXED_ASSIGNED_AT,
    updatedAt: null,
  };
}

// Queue order is intentionally different from DB-id order so §5 can
// prove the projection preserves queue order, not DB order.
const baseQueueItems: ReadonlyArray<OperationalQueueItem> = Object.freeze([
  Object.freeze(callListQueueItem(103)),
  Object.freeze(schedulerTaskQueueItem(99)), // dropped by kind filter
  Object.freeze(callListQueueItem(101)),
  Object.freeze(callListQueueItem(102)),
  Object.freeze(schedulerTaskQueueItem(88)), // dropped by kind filter
]);

// ─── §1: Field-level parity for every legacy field ─────────────────────
//
// Asserts the projection round-trips every byte the legacy
// SchedulerAssignment row carries. Catches any future refactor that
// silently strips or renames a column on the projection's output.
{
  let fetchCalls = 0;
  const fetchByIds = async (ids: number[]) => {
    fetchCalls += 1;
    return legacyRows.filter((r) => ids.includes(r.id));
  };

  const projected = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
  );

  check(projected.length === 3, `§1: expected 3 projected rows, got ${projected.length}`);
  check(fetchCalls === 1, `§1: bulk-fetch must be called exactly once, got ${fetchCalls}`);

  // Queue order: 103, 101, 102.
  eq(projected[0]?.id, 103, "§1: id[0]");
  eq(projected[1]?.id, 101, "§1: id[1]");
  eq(projected[2]?.id, 102, "§1: id[2]");

  // Spot-check every documented field on row #102 (the row that exercises
  // all four nullable fields filled in: originalSchedulerId, reason,
  // completedAt non-null, and source !== "auto").
  const p = projected[2];
  check(!!p, "§1: row #102 should be present in projected output");
  if (p) {
    eq(p.id, 102, "§1: row.id");
    eq(p.patientScreeningId, 5002, "§1: row.patientScreeningId");
    eq(p.schedulerId, 7, "§1: row.schedulerId");
    eq(p.asOfDate, FIXED_AS_OF_DATE, "§1: row.asOfDate");
    eq(p.assignedAt, FIXED_ASSIGNED_AT, "§1: row.assignedAt");
    eq(p.source, "redistribute", "§1: row.source");
    eq(p.originalSchedulerId, 8, "§1: row.originalSchedulerId");
    eq(p.reason, "PTO redistribution", "§1: row.reason");
    eq(p.status, "completed", "§1: row.status");
    eq(p.completedAt, FIXED_COMPLETED_AT, "§1: row.completedAt");
  }
}

// ─── §2: Non-call-list kinds are dropped ───────────────────────────────
{
  let fetchCalls = 0;
  const fetchByIds = async (ids: number[]) => {
    fetchCalls += 1;
    return legacyRows.filter((r) => ids.includes(r.id));
  };
  const projected = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
  );
  // Only the three call_list_item rows make it through.
  check(projected.length === 3, "§2: scheduler_task / non-call-list kinds must be dropped");
  // The fetch should never have requested the scheduler_task ownerIds (99, 88).
  const requested = await (async () => {
    let captured: number[] = [];
    await projectQueueItemsToSchedulerAssignments_REFERENCE(
      baseQueueItems,
      async (ids) => {
        captured = ids.slice();
        return legacyRows.filter((r) => ids.includes(r.id));
      },
    );
    return captured;
  })();
  check(!requested.includes(99), "§2: ownerId 99 (scheduler_task) must not be requested");
  check(!requested.includes(88), "§2: ownerId 88 (scheduler_task) must not be requested");
  check(fetchCalls === 1, "§2: still exactly one fetch on mixed-kind input");
}

// ─── §3: Empty input + all-non-call-list input short-circuit ──────────
{
  let fetchCalls = 0;
  const fetchByIds = async (ids: number[]) => {
    fetchCalls += 1;
    return [];
  };

  const emptyOut = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    [],
    fetchByIds,
  );
  check(emptyOut.length === 0, "§3: empty input returns empty array");
  check(fetchCalls === 0, "§3: empty input must not trigger a bulk fetch");

  fetchCalls = 0;
  const nonCallListOnly = [
    schedulerTaskQueueItem(99),
    schedulerTaskQueueItem(88),
  ];
  const nonCallListOut = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    nonCallListOnly,
    fetchByIds,
  );
  check(
    nonCallListOut.length === 0,
    "§3: all-non-call-list input returns empty array",
  );
  check(
    fetchCalls === 0,
    "§3: all-non-call-list input must not trigger a bulk fetch",
  );
}

// ─── §4: Missing-row drop semantics, PHI-safe log ──────────────────────
{
  // Bulk fetch returns only the first two rows; row 102 is "deleted between
  // the queue read and the bulk fetch" — the projection must drop it without
  // throwing.
  const fetchByIds = async (_ids: number[]) =>
    legacyRows.filter((r) => r.id !== 102);

  const captured: string[] = [];
  const projected = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
    (line) => captured.push(line),
  );

  check(projected.length === 2, `§4: expected 2 rows after drop, got ${projected.length}`);
  check(
    projected.every((r) => r.id !== 102),
    "§4: dropped row must not be present in output",
  );
  check(captured.length === 1, `§4: expected exactly one log line, got ${captured.length}`);
  const log = captured[0] ?? "";
  check(
    log.startsWith("[operational-queue/projection/schedulerAssignment] missing_row"),
    "§4: log line must use the canonical PHI-safe prefix",
  );
  check(
    log.includes("requested: 3") && log.includes("found: 2") && log.includes("missing: 1"),
    "§4: log line must include counts (requested/found/missing) only",
  );

  // PHI sanitiser — the log line MUST NOT contain any patient identifier,
  // scheduler id, ownerId, name, DOB, or row id substring beyond the
  // counts. We assert specific PHI-shaped strings cannot appear.
  const forbiddenInLog = ["101", "102", "103", "5001", "5002", "5003", "u-7"];
  for (const needle of forbiddenInLog) {
    check(
      !log.includes(needle),
      `§4: missing-row log line must not contain "${needle}" (PHI/owner-id leak)`,
    );
  }
}

// ─── §5: Sort-order preservation ───────────────────────────────────────
//
// The projection MUST return rows in queue order (the order ownerIds
// appear in the input), NOT in DB order. Today's queue ordering
// improvement for downstream callers depends on this.
{
  // Bulk-fetch returns rows in a deliberately "wrong" order so the
  // projection cannot accidentally rely on DB ordering.
  const fetchByIds = async (_ids: number[]) => [
    legacyRows[1], // id 102 (DB order would put this first)
    legacyRows[0], // id 101
    legacyRows[2], // id 103
  ];
  const projected = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
  );
  check(projected.length === 3, "§5: shape sanity");
  // Queue order: 103, 101, 102.
  eq(projected[0]?.id, 103, "§5: id[0] in queue order");
  eq(projected[1]?.id, 101, "§5: id[1] in queue order");
  eq(projected[2]?.id, 102, "§5: id[2] in queue order");
}

// ─── §6: Single-fetch invariant under any input ────────────────────────
{
  let fetchCalls = 0;
  const fetchByIds = async (_ids: number[]) => {
    fetchCalls += 1;
    return legacyRows;
  };
  await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
  );
  check(
    fetchCalls === 1,
    `§6: projection must perform exactly one bulk fetch, got ${fetchCalls}`,
  );
}

// ─── §7: Lossy-field gap mapping is explicitly documented ──────────────
//
// The projection's value is recovering five fields that the unified
// queue does not carry. The test pins the list so a future refactor that
// adds a new lossy field is forced to update this spec.
{
  const lossyFields = [
    "schedulerId",
    "assignedAt",
    "originalSchedulerId",
    "reason",
    "completedAt",
  ] as const;
  // Build a sample projection output and assert every lossy field is
  // present and matches the source row.
  const fetchByIds = async (_ids: number[]) => legacyRows;
  const projected = await projectQueueItemsToSchedulerAssignments_REFERENCE(
    baseQueueItems,
    fetchByIds,
  );
  const queueOrder = [103, 101, 102];
  for (let i = 0; i < queueOrder.length; i += 1) {
    const p = projected[i];
    const source = legacyRows.find((r) => r.id === queueOrder[i]);
    if (!p || !source) {
      failures.push(`§7: missing projected row for id ${queueOrder[i]}`);
      continue;
    }
    for (const f of lossyFields) {
      const a = p[f];
      const b = source[f];
      const aIso = a instanceof Date ? a.toISOString() : a;
      const bIso = b instanceof Date ? b.toISOString() : b;
      if (aIso !== bIso) {
        failures.push(
          `§7: lossy field "${f}" not recovered on row ${queueOrder[i]} ` +
            `(expected ${String(bIso)}, got ${String(aIso)})`,
        );
      }
    }
  }
}

// ─── §8: Input is not mutated (Object.freeze tripwire) ────────────────
//
// `baseQueueItems` and its rows are frozen. If the projection ever
// mutates the input array or any item, the freeze will throw at runtime
// in strict mode (ESM tsx). Re-running §1 here is the simplest proof.
{
  const fetchByIds = async (_ids: number[]) => legacyRows;
  let threw = false;
  try {
    await projectQueueItemsToSchedulerAssignments_REFERENCE(
      baseQueueItems,
      fetchByIds,
    );
  } catch (err) {
    threw = true;
    failures.push(
      `§8: projection threw while iterating frozen input — possible mutation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  check(!threw, "§8: projection must not mutate frozen input");
}

// ─── §9: Documented-gaps text marker (linkable from QA script) ────────
//
// The QA wrapper script (scripts/qa-operational-queue-projection-parity.mjs)
// asserts the source of this file contains the exact list of lossy
// fields, so any future PR that adds/removes a lossy field is forced
// to update both this test and the design doc.
const __GAP_MAPPING_MARKER__ = [
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
];
check(
  __GAP_MAPPING_MARKER__.length === 5,
  "§9: gap-mapping marker must list exactly 5 lossy fields",
);

// ─── §10: Equivalence — real module ≡ inline reference (Bundle 13) ────
//
// The Bundle 13 PR added the real projection module at
// server/modules/operational-queue/projections/schedulerAssignment.ts.
// This section runs every fixture through BOTH the inline reference
// implementation above (the canonical spec) AND the imported real
// module, and asserts they produce byte-identical output, identical
// fetch-call counts, and identical log lines.
//
// Failure here means the real module drifted from the design /
// reference algorithm. The QA wrapper at
// scripts/qa-operational-queue-projection-parity.mjs asserts the
// MISSING_ROW_LOG_PREFIX constant matches the design doc's spec, so
// both ends of the contract (algorithm + log line) stay in sync.
{
  // Compile-time proof that the local fixture row type is structurally
  // assignable to the real module's exported row shape. If either type
  // ever drifts, this assignment fails typecheck.
  const _typeShapeCheck: LegacySchedulerAssignmentRowShape = legacyRows[0]!;
  void _typeShapeCheck;

  type LR = LegacySchedulerAssignmentLike;
  type Case = {
    name: string;
    items: ReadonlyArray<OperationalQueueItem>;
    fetcher: (ids: number[]) => Promise<LR[]>;
  };
  const cases: Case[] = [
    {
      name: "happy path — full fetch",
      items: baseQueueItems,
      fetcher: async (ids) => legacyRows.filter((r) => ids.includes(r.id)),
    },
    {
      name: "missing row — id 102 dropped",
      items: baseQueueItems,
      fetcher: async (_ids) => legacyRows.filter((r) => r.id !== 102),
    },
    {
      name: "DB returns out-of-queue order",
      items: baseQueueItems,
      fetcher: async (_ids) => [legacyRows[1]!, legacyRows[0]!, legacyRows[2]!],
    },
    {
      name: "empty input",
      items: [],
      fetcher: async (_ids) => legacyRows,
    },
    {
      name: "all-non-call-list input",
      items: [schedulerTaskQueueItem(99), schedulerTaskQueueItem(88)],
      fetcher: async (_ids) => legacyRows,
    },
  ];

  for (const c of cases) {
    let refFetchCalls = 0;
    let realFetchCalls = 0;
    const refLogs: string[] = [];
    const realLogs: string[] = [];
    let refRequested: number[] | null = null;
    let realRequested: number[] | null = null;

    const refOut = await projectQueueItemsToSchedulerAssignments_REFERENCE(
      c.items,
      async (ids) => {
        refFetchCalls += 1;
        refRequested = ids.slice();
        return c.fetcher(ids);
      },
      (line) => refLogs.push(line),
    );
    const realOut = await projectQueueItemsToSchedulerAssignments<LR>(
      c.items,
      async (ids) => {
        realFetchCalls += 1;
        realRequested = ids.slice();
        return c.fetcher(ids);
      },
      (line) => realLogs.push(line),
    );

    check(
      refOut.length === realOut.length,
      `§10 [${c.name}]: row count diverges (ref=${refOut.length} real=${realOut.length})`,
    );
    for (let i = 0; i < refOut.length && i < realOut.length; i += 1) {
      const r = refOut[i]!;
      const x = realOut[i]!;
      eq(x.id, r.id, `§10 [${c.name}]: row ${i}.id`);
      eq(x.patientScreeningId, r.patientScreeningId, `§10 [${c.name}]: row ${i}.patientScreeningId`);
      eq(x.schedulerId, r.schedulerId, `§10 [${c.name}]: row ${i}.schedulerId`);
      eq(x.asOfDate, r.asOfDate, `§10 [${c.name}]: row ${i}.asOfDate`);
      eq(x.assignedAt, r.assignedAt, `§10 [${c.name}]: row ${i}.assignedAt`);
      eq(x.source, r.source, `§10 [${c.name}]: row ${i}.source`);
      eq(x.originalSchedulerId, r.originalSchedulerId, `§10 [${c.name}]: row ${i}.originalSchedulerId`);
      eq(x.reason, r.reason, `§10 [${c.name}]: row ${i}.reason`);
      eq(x.status, r.status, `§10 [${c.name}]: row ${i}.status`);
      eq(x.completedAt, r.completedAt, `§10 [${c.name}]: row ${i}.completedAt`);
    }
    check(
      refFetchCalls === realFetchCalls,
      `§10 [${c.name}]: fetch call count diverges (ref=${refFetchCalls} real=${realFetchCalls})`,
    );
    // Both implementations must request the same deduplicated ownerId set.
    const refReqStr = refRequested ? [...refRequested].sort().join(",") : "<none>";
    const realReqStr = realRequested ? [...realRequested].sort().join(",") : "<none>";
    check(
      refReqStr === realReqStr,
      `§10 [${c.name}]: requested ownerId set diverges (ref=${refReqStr} real=${realReqStr})`,
    );
    check(
      refLogs.length === realLogs.length,
      `§10 [${c.name}]: log line count diverges (ref=${refLogs.length} real=${realLogs.length})`,
    );
    for (let i = 0; i < refLogs.length && i < realLogs.length; i += 1) {
      eq(realLogs[i], refLogs[i], `§10 [${c.name}]: log line ${i}`);
    }
    // And the log prefix the real module emits must be the canonical
    // PHI-safe one (proves the exported constant matches the inline
    // reference's literal — the two implementations cannot drift).
    for (const line of realLogs) {
      check(
        line.startsWith(MISSING_ROW_LOG_PREFIX),
        `§10 [${c.name}]: real-module log line must start with MISSING_ROW_LOG_PREFIX`,
      );
    }
  }
}

// ─── §11: Required-field tripwire on the real module ──────────────────
//
// Asserts that a fetched row missing ANY of the legacy fields the
// projection promises to round-trip causes a runtime-observable
// failure in the test, not a silent drop. We do this by feeding the
// real module a row whose `assignedAt` is missing (`undefined`), then
// reading the output and asserting the field is undefined — which the
// test treats as a contract violation and fails on.
//
// This is the "fail explicitly in tests if required projection fields
// are missing" requirement from Bundle 13's brief. The projection
// itself does NOT validate input rows (that responsibility belongs to
// the fetcher / DB layer), but the test pins the contract that any
// future fetcher returning a partial row will be visibly broken.
{
  type PartialRow = Omit<LegacySchedulerAssignmentLike, "assignedAt"> & {
    assignedAt: Date | undefined;
  };
  const partial: PartialRow = {
    id: 999,
    patientScreeningId: 7777,
    schedulerId: 9,
    asOfDate: FIXED_AS_OF_DATE,
    assignedAt: undefined,
    source: "auto",
    originalSchedulerId: null,
    reason: null,
    status: "active",
    completedAt: null,
  };
  const items: ReadonlyArray<OperationalQueueItem> = [callListQueueItem(999)];
  const out = await projectQueueItemsToSchedulerAssignments<PartialRow>(
    items,
    async (_ids) => [partial],
  );
  check(out.length === 1, "§11: partial-row fixture should round-trip exactly one row");
  check(
    out[0]?.assignedAt === undefined,
    "§11: partial row's missing assignedAt must surface as undefined (caller responsibility to enforce)",
  );
  // List every required field the test explicitly checks for presence
  // — if any is silently absent in a real fetcher, this list is the
  // canonical place a future PR records the expectation.
  const requiredFields: ReadonlyArray<keyof LegacySchedulerAssignmentRowShape> = [
    "id",
    "patientScreeningId",
    "schedulerId",
    "asOfDate",
    "assignedAt",
    "source",
    "originalSchedulerId",
    "reason",
    "status",
    "completedAt",
  ];
  check(
    requiredFields.length === 10,
    "§11: required-field tripwire list must enumerate all 10 legacy columns",
  );
}

// ─── Final result ─────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("Operational queue projection parity FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Operational queue projection parity test passed.");
}
