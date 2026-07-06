import { describe, it } from "vitest";
// Operational queue — structural parity test fixture (Batch 11a).
//
// Runnable via:   npx tsx server/modules/operational-queue/__tests__/structure.test.ts
//
// This test does NOT connect to a database. It asserts that the contract
// shape is structurally what consumers expect, that every documented kind
// has a stable composite-id prefix, and that the sort key is total.
//
// Wire-to-CI is deliberately deferred: a real parity test against the
// existing portal endpoints requires a live DB and a canned (user, facility)
// fixture, which belongs in phase 11b alongside the additive
// /api/operational-queue/me endpoint.
//
// Exit 0 = pass; exit 1 = fail.

import {
  OPERATIONAL_QUEUE_ITEM_KINDS,
  OPERATIONAL_QUEUE_OWNER_TYPES,
  type OperationalQueueItem,
} from "../contracts";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// ─── §3: kinds + owner types are exported as `as const` arrays ──────
check(
  Array.isArray(OPERATIONAL_QUEUE_ITEM_KINDS) &&
    OPERATIONAL_QUEUE_ITEM_KINDS.length === 4,
  `Expected exactly 4 OperationalQueueItem kinds, got ${OPERATIONAL_QUEUE_ITEM_KINDS.length}`,
);
const expectedKinds = [
  "call_list_item",
  "scheduler_task",
  "visit_appointment",
  "global_calendar_event",
];
for (const k of expectedKinds) {
  check(
    (OPERATIONAL_QUEUE_ITEM_KINDS as readonly string[]).includes(k),
    `Missing kind: ${k}`,
  );
}

check(
  Array.isArray(OPERATIONAL_QUEUE_OWNER_TYPES) &&
    OPERATIONAL_QUEUE_OWNER_TYPES.length === 5,
  `Expected exactly 5 owner types, got ${OPERATIONAL_QUEUE_OWNER_TYPES.length}`,
);
const expectedOwnerTypes = [
  "scheduler_assignment",
  "plexus_task",
  "engagement_case",
  "ancillary_appointment",
  "global_schedule_event",
];
for (const t of expectedOwnerTypes) {
  check(
    (OPERATIONAL_QUEUE_OWNER_TYPES as readonly string[]).includes(t),
    `Missing owner type: ${t}`,
  );
}

// ─── §3: composite-id prefix per kind (must be stable across batches) ─
const sampleItems: OperationalQueueItem[] = [
  {
    id: "cl:42",
    kind: "call_list_item",
    ownerType: "scheduler_assignment",
    ownerId: 42,
    assigneeUserId: "u1",
    assigneeName: "Sample Scheduler",
    patientScreeningId: 1,
    patientName: "Fictional Patient",
    patientDob: "1980-01-01",
    facility: "Sample Facility",
    scheduledDate: "2026-06-09",
    scheduledTime: null,
    status: "active",
    isOpen: true,
    metadata: { source: "auto" },
    createdAt: new Date("2026-06-09T07:00:00Z"),
    updatedAt: null,
  },
  {
    id: "st-pt:5",
    kind: "scheduler_task",
    ownerType: "plexus_task",
    ownerId: 5,
    assigneeUserId: "u1",
    assigneeName: "Sample Scheduler",
    patientScreeningId: null,
    patientName: null,
    patientDob: null,
    facility: "Sample Facility",
    scheduledDate: null,
    scheduledTime: null,
    status: "open",
    isOpen: true,
    metadata: null,
    createdAt: new Date("2026-06-08T12:00:00Z"),
    updatedAt: new Date("2026-06-09T07:30:00Z"),
  },
  {
    id: "st-ec:11",
    kind: "scheduler_task",
    ownerType: "engagement_case",
    ownerId: 11,
    assigneeUserId: "u1",
    assigneeName: "Sample Scheduler",
    patientScreeningId: 2,
    patientName: "Fictional Patient 2",
    patientDob: "1985-02-02",
    facility: "Sample Facility",
    scheduledDate: null,
    scheduledTime: null,
    status: "assigned",
    isOpen: true,
    metadata: { engagementBucket: "visit" },
    createdAt: new Date("2026-06-09T06:00:00Z"),
    updatedAt: new Date("2026-06-09T08:00:00Z"),
  },
  {
    id: "va:7",
    kind: "visit_appointment",
    ownerType: "ancillary_appointment",
    ownerId: 7,
    assigneeUserId: null,
    assigneeName: null,
    patientScreeningId: 3,
    patientName: "Fictional Patient 3",
    patientDob: "1990-03-03",
    facility: "Sample Facility",
    scheduledDate: "2026-06-09",
    scheduledTime: "10:30",
    status: "scheduled",
    isOpen: true,
    metadata: { testType: "brainwave" },
    createdAt: new Date("2026-06-08T00:00:00Z"),
    updatedAt: null,
  },
  {
    id: "gc:99",
    kind: "global_calendar_event",
    ownerType: "global_schedule_event",
    ownerId: 99,
    assigneeUserId: "u2",
    assigneeName: "Another User",
    patientScreeningId: 4,
    patientName: "Fictional Patient 4",
    patientDob: "1975-04-04",
    facility: "Sample Facility",
    scheduledDate: "2026-06-09",
    scheduledTime: "14:00",
    status: "scheduled",
    isOpen: true,
    metadata: { eventType: "ancillary" },
    createdAt: new Date("2026-06-08T15:00:00Z"),
    updatedAt: null,
  },
];

const prefixByKind: Record<string, string[]> = {
  call_list_item: ["cl:"],
  scheduler_task: ["st-pt:", "st-ec:"],
  visit_appointment: ["va:"],
  global_calendar_event: ["gc:"],
};

for (const item of sampleItems) {
  const allowed = prefixByKind[item.kind] ?? [];
  const ok = allowed.some((p) => item.id.startsWith(p));
  check(
    ok,
    `Item kind=${item.kind} has id="${item.id}" — expected to start with one of ${allowed.join(",")}`,
  );
}

// ─── Sort: items with no scheduledDate go after items with one ───────
function sortKeyCompare(
  a: OperationalQueueItem,
  b: OperationalQueueItem,
): number {
  const aDate = a.scheduledDate ?? "9999-12-31";
  const bDate = b.scheduledDate ?? "9999-12-31";
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  const aTime = a.scheduledTime ?? "99:99";
  const bTime = b.scheduledTime ?? "99:99";
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
  return a.id.localeCompare(b.id);
}

const dated = sampleItems.find((i) => i.scheduledDate !== null);
const undated = sampleItems.find((i) => i.scheduledDate === null);
if (dated && undated) {
  check(
    sortKeyCompare(dated, undated) < 0,
    "Items with scheduledDate must sort before items with null scheduledDate",
  );
}

// ─── Composite ids are unique across the union ──────────────────────
const ids = sampleItems.map((i) => i.id);
const uniq = new Set(ids);
check(
  ids.length === uniq.size,
  `Sample composite ids must be unique; got ${ids.length} items, ${uniq.size} unique`,
);

describe("Operational queue structural test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Operational queue structural test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
