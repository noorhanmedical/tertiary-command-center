import { describe, it } from "vitest";
// Operational Queue ↔ Team Task projection parity test (Bundle 45).
//
// Runnable via:
//   npx tsx server/modules/team-tasks/__tests__/operational-queue-projection-parity.test.ts
//
// PURPOSE
//   Locks the conceptual mapping between TeamTask (server/modules/
//   team-tasks/contracts.ts) and OperationalQueueItem (server/modules/
//   operational-queue/contracts.ts) so any future cutover that exposes
//   the same row through both APIs cannot silently drift on the load-
//   bearing fields the Team Portal call list reads:
//     - owner / user linkage (assignee, scheduler, ownerType, ownerId)
//     - task status (raw text, not normalized)
//     - source type
//     - due date / scheduled date
//     - completion state
//     - cancellation state when applicable
//
// SCOPE / SAFETY
//   - No DB, no app boot, no network.
//   - No PHI in fixtures (synthetic ids only).
//   - No route behavior changed by this test.
//   - The reference projections below MIRROR what
//     server/modules/team-tasks/repo.ts and
//     server/modules/operational-queue/repo.ts produce; they don't
//     replace them. A future cutover PR that adopts the real projections
//     can promote the §9 equivalence harness to import them.
//
// Exit 0 = pass; exit 1 = fail.

import {
  OPERATIONAL_QUEUE_ITEM_KINDS,
  type OperationalQueueItem,
} from "../../operational-queue/contracts";
import {
  TEAM_TASK_OWNER_TYPES,
  type TeamTask,
  type TeamTaskOwnerType,
} from "../contracts";

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

// ─── §1: Owner type enums cover both task sources ────────────────
check(
  TEAM_TASK_OWNER_TYPES.length === 2,
  `§1: TeamTask owner types must be exactly [plexus_task, scheduler_assignment]; got ${TEAM_TASK_OWNER_TYPES.length}`,
);
check(
  (TEAM_TASK_OWNER_TYPES as ReadonlyArray<string>).includes("plexus_task"),
  "§1: plexus_task must be in TEAM_TASK_OWNER_TYPES",
);
check(
  (TEAM_TASK_OWNER_TYPES as ReadonlyArray<string>).includes("scheduler_assignment"),
  "§1: scheduler_assignment must be in TEAM_TASK_OWNER_TYPES",
);

// OperationalQueue's `scheduler_task` kind covers BOTH plexus_tasks and
// engagement-board rows; its `call_list_item` kind covers
// scheduler_assignments specifically (per operational-queue/contracts.ts).
check(
  (OPERATIONAL_QUEUE_ITEM_KINDS as ReadonlyArray<string>).includes("scheduler_task"),
  "§1: OperationalQueue must expose scheduler_task kind",
);
check(
  (OPERATIONAL_QUEUE_ITEM_KINDS as ReadonlyArray<string>).includes("call_list_item"),
  "§1: OperationalQueue must expose call_list_item kind",
);

// ─── §2: Composite id rule mirrors across both views ─────────────
function makeTeamTaskCompositeId(
  ownerType: TeamTaskOwnerType,
  ownerId: number,
): string {
  return ownerType === "plexus_task" ? `pt:${ownerId}` : `sa:${ownerId}`;
}

function makeOpQueueCompositeIdFromTask(
  ownerType: TeamTaskOwnerType,
  ownerId: number,
): string {
  // OperationalQueue uses `cl:<id>` for call_list_item (scheduler
  // assignments) and `st-pt:<id>` / `st-ec:<id>` for scheduler_task
  // (plexus task vs engagement case).
  return ownerType === "plexus_task" ? `st-pt:${ownerId}` : `cl:${ownerId}`;
}

eq(makeTeamTaskCompositeId("plexus_task", 42), "pt:42", "§2: team-task pt id");
eq(
  makeTeamTaskCompositeId("scheduler_assignment", 17),
  "sa:17",
  "§2: team-task sa id",
);
eq(
  makeOpQueueCompositeIdFromTask("plexus_task", 42),
  "st-pt:42",
  "§2: op-queue st-pt id",
);
eq(
  makeOpQueueCompositeIdFromTask("scheduler_assignment", 17),
  "cl:17",
  "§2: op-queue cl id",
);

// ─── §3: Canned fixtures spanning the load-bearing field set ──────
const FIXED_CREATED = new Date("2026-06-09T08:00:00.000Z");
const FIXED_COMPLETED = new Date("2026-06-09T17:30:00.000Z");
const FIXED_DUE = "2026-06-12";
const FIXED_SCHEDULED_DATE = "2026-06-12";

type ProjectionAxes = {
  ownerType: TeamTaskOwnerType;
  ownerId: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  schedulerId: number | null;
  patientScreeningId: number | null;
  facility: string | null;
  status: string;
  source: string | null;
  dueOrScheduledDate: string | null;
  completedAt: Date | null;
  // Cancellation surfaces differently per source — see §6.
  cancellationLikeStatus: boolean;
};

const FIXTURES: ProjectionAxes[] = [
  // Plexus task — open, assigned, no scheduler, due date set.
  {
    ownerType: "plexus_task",
    ownerId: 42,
    assigneeUserId: "u-101",
    assigneeName: "Synth Tech A",
    schedulerId: null,
    patientScreeningId: 5001,
    facility: "Clinic A",
    status: "open",
    source: null,
    dueOrScheduledDate: FIXED_DUE,
    completedAt: null,
    cancellationLikeStatus: false,
  },
  // Plexus task — done.
  {
    ownerType: "plexus_task",
    ownerId: 43,
    assigneeUserId: "u-101",
    assigneeName: "Synth Tech A",
    schedulerId: null,
    patientScreeningId: 5002,
    facility: "Clinic A",
    status: "done",
    source: null,
    dueOrScheduledDate: FIXED_DUE,
    completedAt: FIXED_COMPLETED,
    cancellationLikeStatus: false,
  },
  // Scheduler assignment — active, scheduled today.
  {
    ownerType: "scheduler_assignment",
    ownerId: 17,
    assigneeUserId: "u-201",
    assigneeName: "Synth Scheduler B",
    schedulerId: 7,
    patientScreeningId: 5003,
    facility: "Clinic B",
    status: "active",
    source: "auto",
    dueOrScheduledDate: FIXED_SCHEDULED_DATE,
    completedAt: null,
    cancellationLikeStatus: false,
  },
  // Scheduler assignment — completed.
  {
    ownerType: "scheduler_assignment",
    ownerId: 18,
    assigneeUserId: "u-201",
    assigneeName: "Synth Scheduler B",
    schedulerId: 7,
    patientScreeningId: 5004,
    facility: "Clinic B",
    status: "completed",
    source: "auto",
    dueOrScheduledDate: FIXED_SCHEDULED_DATE,
    completedAt: FIXED_COMPLETED,
    cancellationLikeStatus: false,
  },
  // Scheduler assignment — released (the source's cancellation-shaped
  // status; see SCHEDULER_ASSIGNMENT_STATUSES in shared/schema/outreach.ts).
  {
    ownerType: "scheduler_assignment",
    ownerId: 19,
    assigneeUserId: "u-201",
    assigneeName: "Synth Scheduler B",
    schedulerId: 7,
    patientScreeningId: 5005,
    facility: "Clinic B",
    status: "released",
    source: "manual",
    dueOrScheduledDate: FIXED_SCHEDULED_DATE,
    completedAt: null,
    cancellationLikeStatus: true,
  },
  // Plexus task — closed (the plexus-side cancellation/wrap-up status).
  {
    ownerType: "plexus_task",
    ownerId: 44,
    assigneeUserId: "u-101",
    assigneeName: "Synth Tech A",
    schedulerId: null,
    patientScreeningId: null, // project-level task with no patient scope
    facility: "Clinic A",
    status: "closed",
    source: null,
    dueOrScheduledDate: null, // unscheduled task
    completedAt: null,
    cancellationLikeStatus: true,
  },
];

// ─── Reference projections — TeamTask ─────────────────────────────
function buildTeamTaskFromAxes(a: ProjectionAxes): TeamTask {
  return {
    id: makeTeamTaskCompositeId(a.ownerType, a.ownerId),
    ownerType: a.ownerType,
    ownerId: a.ownerId,
    assigneeUserId: a.assigneeUserId,
    assigneeName: a.assigneeName,
    schedulerId: a.schedulerId,
    patientScreeningId: a.patientScreeningId,
    facility: a.facility,
    status: a.status,
    title: a.ownerType === "plexus_task" ? `Task ${a.ownerId}` : null,
    description: null,
    taskType: a.ownerType === "plexus_task" ? "general" : null,
    urgency: null,
    priority: null,
    parentTaskId: null,
    projectId: null,
    batchId: null,
    dueAt: a.ownerType === "plexus_task" ? a.dueOrScheduledDate : null,
    source: a.source,
    asOfDate: a.ownerType === "scheduler_assignment" ? a.dueOrScheduledDate : null,
    originalSchedulerId: null,
    reason: null,
    completedAt: a.completedAt,
    createdAt: FIXED_CREATED,
    updatedAt: null,
  };
}

// ─── Reference projections — OperationalQueueItem ────────────────
function buildOpQueueItemFromAxes(a: ProjectionAxes): OperationalQueueItem {
  const kind = a.ownerType === "plexus_task" ? "scheduler_task" : "call_list_item";
  const ownerType =
    a.ownerType === "plexus_task" ? "plexus_task" : "scheduler_assignment";
  // The OperationalQueue's `isOpen` is the only normalised flag in its
  // contract; everything else is raw. Closed-side statuses (closed /
  // done / completed / released) flip it to false.
  const closedSet = new Set(["closed", "done", "completed", "released"]);
  const isOpen = !closedSet.has(a.status);
  return {
    id: makeOpQueueCompositeIdFromTask(a.ownerType, a.ownerId),
    kind,
    ownerType,
    ownerId: a.ownerId,
    assigneeUserId: a.assigneeUserId,
    assigneeName: a.assigneeName,
    patientScreeningId: a.patientScreeningId,
    patientName: null,
    patientDob: null,
    facility: a.facility,
    scheduledDate: a.dueOrScheduledDate,
    scheduledTime: null,
    status: a.status,
    isOpen,
    metadata:
      a.source !== null ? ({ source: a.source } as Record<string, unknown>) : null,
    createdAt: FIXED_CREATED,
    updatedAt: null,
  };
}

// ─── §4: Owner linkage round-trips ────────────────────────────────
for (const a of FIXTURES) {
  const t = buildTeamTaskFromAxes(a);
  const q = buildOpQueueItemFromAxes(a);
  eq(t.ownerType, a.ownerType, `§4: TeamTask ${a.ownerType}:${a.ownerId} ownerType`);
  eq(q.ownerType, a.ownerType, `§4: OpQueue ${a.ownerType}:${a.ownerId} ownerType`);
  eq(t.ownerId, a.ownerId, `§4: TeamTask ${a.ownerType}:${a.ownerId} ownerId`);
  eq(q.ownerId, a.ownerId, `§4: OpQueue ${a.ownerType}:${a.ownerId} ownerId`);
  eq(
    t.assigneeUserId,
    q.assigneeUserId,
    `§4: assigneeUserId parity for ${a.ownerType}:${a.ownerId}`,
  );
  eq(
    t.assigneeName,
    q.assigneeName,
    `§4: assigneeName parity for ${a.ownerType}:${a.ownerId}`,
  );
}

// ─── §5: Status / source preserved verbatim ──────────────────────
for (const a of FIXTURES) {
  const t = buildTeamTaskFromAxes(a);
  const q = buildOpQueueItemFromAxes(a);
  eq(t.status, q.status, `§5: status verbatim for ${a.ownerType}:${a.ownerId}`);
  eq(t.status, a.status, `§5: TeamTask status not normalised for ${a.ownerType}:${a.ownerId}`);
  // OperationalQueue carries source under metadata; TeamTask carries it
  // top-level (scheduler_assignment) OR null (plexus_task). Source
  // round-trips through `metadata.source` on the OpQueue side.
  if (a.ownerType === "scheduler_assignment") {
    eq(t.source, a.source, `§5: TeamTask source for sa:${a.ownerId}`);
    eq(
      (q.metadata as Record<string, unknown> | null)?.source ?? null,
      a.source,
      `§5: OpQueue metadata.source for sa:${a.ownerId}`,
    );
  } else {
    eq(t.source, null, `§5: TeamTask source null for pt:${a.ownerId}`);
    eq(q.metadata ?? null, null, `§5: OpQueue metadata null for pt:${a.ownerId}`);
  }
}

// ─── §6: Due date / scheduled date axes ───────────────────────────
for (const a of FIXTURES) {
  const t = buildTeamTaskFromAxes(a);
  const q = buildOpQueueItemFromAxes(a);
  // OperationalQueue exposes scheduledDate uniformly; TeamTask splits it:
  // plexus → dueAt, scheduler_assignment → asOfDate.
  eq(
    q.scheduledDate,
    a.dueOrScheduledDate,
    `§6: OpQueue scheduledDate for ${a.ownerType}:${a.ownerId}`,
  );
  if (a.ownerType === "plexus_task") {
    eq(t.dueAt, a.dueOrScheduledDate, `§6: TeamTask dueAt for pt:${a.ownerId}`);
    eq(t.asOfDate, null, `§6: TeamTask asOfDate null for pt:${a.ownerId}`);
  } else {
    eq(t.asOfDate, a.dueOrScheduledDate, `§6: TeamTask asOfDate for sa:${a.ownerId}`);
    eq(t.dueAt, null, `§6: TeamTask dueAt null for sa:${a.ownerId}`);
  }
}

// ─── §7: Completion + cancellation state ──────────────────────────
for (const a of FIXTURES) {
  const t = buildTeamTaskFromAxes(a);
  const q = buildOpQueueItemFromAxes(a);
  // Completion: TeamTask carries completedAt (Date | null); OpQueue
  // derives isOpen=false when the status is closed-side.
  eq(t.completedAt, a.completedAt, `§7: TeamTask completedAt for ${a.ownerType}:${a.ownerId}`);
  if (a.status === "completed" || a.status === "done") {
    check(
      q.isOpen === false,
      `§7: OpQueue isOpen must be false for ${a.ownerType}:${a.ownerId} (status=${a.status})`,
    );
  }
  // Cancellation-like statuses (closed for plexus, released for
  // scheduler_assignment) flip isOpen=false too.
  if (a.cancellationLikeStatus) {
    check(
      q.isOpen === false,
      `§7: OpQueue isOpen must be false for cancellation-like ${a.ownerType}:${a.ownerId}`,
    );
  }
  // Open statuses keep isOpen=true.
  if (!a.cancellationLikeStatus && a.completedAt === null) {
    check(
      q.isOpen === true,
      `§7: OpQueue isOpen must be true for open ${a.ownerType}:${a.ownerId}`,
    );
  }
}

// ─── §8: Patient + facility parity ────────────────────────────────
for (const a of FIXTURES) {
  const t = buildTeamTaskFromAxes(a);
  const q = buildOpQueueItemFromAxes(a);
  eq(
    t.patientScreeningId,
    q.patientScreeningId,
    `§8: patientScreeningId parity for ${a.ownerType}:${a.ownerId}`,
  );
  eq(t.facility, q.facility, `§8: facility parity for ${a.ownerType}:${a.ownerId}`);
}

// ─── §9: PHI envelope guard ───────────────────────────────────────
// No fixture carries a patient name, DOB, MRN, insurance, diagnosis,
// or email. The OpQueue contract permits patientName / patientDob
// fields, but for this parity test we explicitly leave them null —
// the test asserts the absence on the OpQueue side.
for (const a of FIXTURES) {
  const q = buildOpQueueItemFromAxes(a);
  eq(q.patientName, null, `§9: OpQueue patientName must be null in fixture for ${a.ownerType}:${a.ownerId}`);
  eq(q.patientDob, null, `§9: OpQueue patientDob must be null in fixture for ${a.ownerType}:${a.ownerId}`);
}

// ─── §10: Input not mutated ───────────────────────────────────────
{
  const frozen = Object.freeze(
    FIXTURES.map((a) => Object.freeze({ ...a })),
  );
  let threw = false;
  try {
    for (const a of frozen) {
      buildTeamTaskFromAxes(a);
      buildOpQueueItemFromAxes(a);
    }
  } catch (err) {
    threw = true;
    failures.push(
      `§10: reference projection threw on frozen input: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  check(!threw, "§10: projections must not mutate input");
}

describe("OperationalQueue ↔ TeamTask parity test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "OperationalQueue ↔ TeamTask parity test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
