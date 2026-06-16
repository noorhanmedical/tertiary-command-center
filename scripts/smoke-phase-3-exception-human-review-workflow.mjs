#!/usr/bin/env node
// Smoke — Phase 3 PR 3.3.
// Static checks: schema, migration, service, routes wire up coherently.

import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const schema = read("shared/schema/exceptionReviews.ts");
if (!/EXCEPTION_REVIEW_EVENT_TYPES\s*=\s*\[/.test(schema)) fail("event-type constant missing");

const svc = read("server/services/exceptionIntelligence/exceptionReviewService.ts");
if (!/db\.update\(exceptionSnapshots\)/.test(svc)) fail("service must update exceptionSnapshots");
if (!/db\.insert\(exceptionReviewEvents\)/.test(svc)) fail("service must insert exceptionReviewEvents");

const routes = read("server/routes/exceptions.ts");
const expected = [
  "/api/exceptions/:id/acknowledge",
  "/api/exceptions/:id/assign",
  "/api/exceptions/:id/note",
  "/api/exceptions/:id/dismiss",
  "/api/exceptions/:id/resolve",
  "/api/exceptions/:id/reopen",
  "/api/exceptions/:id/review-events",
];
for (const e of expected) if (!routes.includes(e)) fail(`route missing: ${e}`);

const idx = read("shared/schema/index.ts");
if (!/exceptionReviews/.test(idx)) fail("shared/schema/index.ts must re-export exceptionReviews");

if (failures.length) {
  console.error("[smoke-phase-3-exception-human-review-workflow] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-exception-human-review-workflow] PASS");
