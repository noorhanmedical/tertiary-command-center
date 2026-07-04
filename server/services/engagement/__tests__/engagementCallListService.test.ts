import { describe, it } from "vitest";
// Engagement call-list service — dormant scaffold test (Batch 15).
//
// Runnable via:
//   npx tsx server/services/engagement/__tests__/engagementCallListService.test.ts

import {
  getEngagementCallList,
  type EngagementCallListDependencies,
  type EngagementCallListItem,
} from "../engagementCallListService";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) { if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`); }

const sampleItems: ReadonlyArray<EngagementCallListItem> = [
  {
    patientScreeningId: "ps-1",
    patientExecutionCaseId: "ec-1",
    engagementStatus: "in_progress",
    lifecycleStatus: "active",
    assignedTeamMemberId: "tm-7",
    assignedRole: "scheduler",
    appointmentStatus: null,
    nextActionAt: "2026-06-12T12:00:00Z",
    facilityId: "f-1",
    callListAssignmentDate: "2026-06-11",
  },
  {
    patientScreeningId: "ps-2",
    patientExecutionCaseId: null,
    engagementStatus: null,
    lifecycleStatus: null,
    assignedTeamMemberId: null,
    assignedRole: null,
    appointmentStatus: "scheduled",
    nextActionAt: null,
    facilityId: "f-1",
    callListAssignmentDate: null,
  },
];

function makeFakeDeps(): { deps: EngagementCallListDependencies; lastCallFilters: { value: unknown } } {
  const lastCallFilters: { value: unknown } = { value: null };
  const deps: EngagementCallListDependencies = {
    listEngagementCallListItems: async (filters) => {
      lastCallFilters.value = filters;
      return sampleItems;
    },
  };
  return { deps, lastCallFilters };
}

// §1 — Default filter clamps limit to 100.
{
  const { deps, lastCallFilters } = makeFakeDeps();
  const r = await getEngagementCallList({}, deps);
  const f = lastCallFilters.value as { limit?: number };
  eq(f?.limit, 100, "§1: default limit clamped to 100");
  eq(r.count, sampleItems.length, "§1: count returned");
  eq(r.items.length, sampleItems.length, "§1: items returned");
}

// §2 — Explicit limit honored within max.
{
  const { deps, lastCallFilters } = makeFakeDeps();
  await getEngagementCallList({ limit: 250 }, deps);
  const f = lastCallFilters.value as { limit?: number };
  eq(f?.limit, 250, "§2: limit 250 honored");
}

// §3 — Limit clamped at MAX_LIMIT (500).
{
  const { deps, lastCallFilters } = makeFakeDeps();
  await getEngagementCallList({ limit: 9000 }, deps);
  const f = lastCallFilters.value as { limit?: number };
  eq(f?.limit, 500, "§3: limit clamped at 500");
}

// §4 — Filter envelope is forwarded.
{
  const { deps, lastCallFilters } = makeFakeDeps();
  await getEngagementCallList(
    {
      facilityId: "f-1",
      assignedTeamMemberId: "tm-7",
      engagementStatus: "needs_followup",
      callListAssignmentDate: "2026-06-11",
    },
    deps,
  );
  const f = lastCallFilters.value as { facilityId?: string; engagementStatus?: string };
  eq(f?.facilityId, "f-1", "§4: facilityId forwarded");
  eq(f?.engagementStatus, "needs_followup", "§4: engagementStatus forwarded");
}

// §5 — Items pass through unchanged.
{
  const { deps } = makeFakeDeps();
  const r = await getEngagementCallList({}, deps);
  check(r.items === sampleItems, "§5: items reference passes through");
}

describe("Engagement call-list service test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Engagement call-list service test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
