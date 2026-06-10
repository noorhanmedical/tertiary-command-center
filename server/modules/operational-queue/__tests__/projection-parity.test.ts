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

// ─── Final result ─────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("Operational queue projection parity FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Operational queue projection parity test passed.");
}
