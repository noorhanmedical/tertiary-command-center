// QA — A logged call result must refresh the PCS / ACS workspace
// call-list right panel. Without this, an operator logging a result
// would see the same row still in their queue until the next poll
// (60 seconds) — confusing and easy to mis-handle.
//
// DispositionSheet's onSuccess handler must invalidate both:
//   - the canonical /api/scheduler-portal/cases query key, AND
//   - any query whose key[0] === "team-workspace-call-list"
// (the shell's React-Query key for the workspace call list).
//
// Run: node scripts/qa-call-result-refreshes-assigned-queue.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/outreach/DispositionSheet.tsx"),
  "utf8",
);

// DispositionSheet has two mutations (legacy logCall + canonical
// logCanonicalCall). BOTH must invalidate the workspace queue or the
// flag-flip would silently break refresh. We assert by counting:
//   - 2× invalidation of /api/scheduler-portal/cases
//   - 2× predicate-invalidation for team-workspace-call-list
const schedulerPortalCount = (src.match(/queryKey: \["\/api\/scheduler-portal\/cases"\]/g) || []).length;
if (schedulerPortalCount < 2) {
  failures.push(`DispositionSheet must invalidate "/api/scheduler-portal/cases" in both the legacy AND canonical onSuccess handlers (found ${schedulerPortalCount})`);
}
const workspacePredicateCount = (src.match(/q\.queryKey\[0\] === "team-workspace-call-list"/g) || []).length;
if (workspacePredicateCount < 2) {
  failures.push(`DispositionSheet must invalidate the "team-workspace-call-list" predicate in both onSuccess handlers (found ${workspacePredicateCount})`);
}

if (failures.length > 0) {
  console.error("Call-result refresh QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Call-result refresh QA passed.");
