#!/usr/bin/env node
// QA — Phase 3 PR 3.3: exception human review workflow.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => readFileSync(path.join(root, p), "utf8");

function mustExist(p) { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); }

mustExist("shared/schema/exceptionReviews.ts");
mustExist("migrations/0040_phase3_exception_review_events.sql");
mustExist("server/services/exceptionIntelligence/exceptionReviewService.ts");
mustExist("server/routes/exceptions.ts");
mustExist("client/src/components/exceptions/ExceptionReviewPanel.tsx");
mustExist("docs/architecture/phase-3-exception-human-review-workflow.md");

if (failures.length) {
  console.error("[qa-phase-3-exception-human-review-workflow] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

// 1) Schema must declare 8 event types
const schema = read("shared/schema/exceptionReviews.ts");
for (const t of [
  "acknowledged", "assigned", "note_added", "dismissed",
  "resolved", "reopened", "recommendation_accepted", "recommendation_rejected",
]) {
  if (!schema.includes(`"${t}"`)) fail(`exceptionReviews schema missing event type "${t}"`);
}
if (!/exceptionReviewEvents\s*=\s*pgTable\("exception_review_events"/.test(schema)) {
  fail(`exceptionReviews schema must define exception_review_events table`);
}
if (!schema.includes(`onDelete: "cascade"`)) {
  fail(`exception_review_events.exception_snapshot_id must cascade on delete`);
}

// 2) Migration must create table and indexes
const mig = read("migrations/0040_phase3_exception_review_events.sql");
if (!/CREATE TABLE IF NOT EXISTS\s+"?exception_review_events"?/i.test(mig)) {
  fail("migration must CREATE TABLE exception_review_events");
}
if (!/idx_exception_review_events_snapshot_id/.test(mig)) fail("missing snapshot_id index in migration");
if (!/idx_exception_review_events_event_type/.test(mig)) fail("missing event_type index in migration");

// 3) Service must enforce state-machine rules
const svc = read("server/services/exceptionIntelligence/exceptionReviewService.ts");
for (const fn of ["acknowledge", "assign", "addNote", "dismiss", "resolve", "reopen", "listReviewEvents"]) {
  if (!new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`).test(svc)) fail(`service missing function: ${fn}`);
}
if (!/Cannot acknowledge an exception in status/.test(svc)) {
  fail(`acknowledge must reject closed/superseded statuses`);
}
if (!/Reason required/.test(svc) || !/dismiss[\s\S]{0,200}reason/i.test(svc)) {
  fail(`dismiss/resolve must require non-empty reason`);
}
if (!/Exception is already open/.test(svc)) {
  fail(`reopen must reject already-open exceptions`);
}
if (!/recordEvent/.test(svc)) {
  fail(`service must call recordEvent on transitions`);
}

// 4) Routes must wire all 7 endpoints with correct auth gates
const routes = read("server/routes/exceptions.ts");
const endpoints = [
  ["/api/exceptions/:id/acknowledge", "requireAuth"],
  ["/api/exceptions/:id/assign", "requireAuth"],
  ["/api/exceptions/:id/note", "requireAuth"],
  ["/api/exceptions/:id/dismiss", "requireAdminOrBiller"],
  ["/api/exceptions/:id/resolve", "requireAdminOrBiller"],
  ["/api/exceptions/:id/reopen", "requireAdminOrBiller"],
];
for (const [pathLit, guard] of endpoints) {
  const r = new RegExp(`app\\.post\\(\\s*"${pathLit.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"\\s*,\\s*${guard}`);
  if (!r.test(routes)) fail(`route missing or wrong guard: POST ${pathLit} (expected ${guard})`);
}
if (!/app\.get\(\s*"\/api\/exceptions\/:id\/review-events"\s*,\s*requireAuth/.test(routes)) {
  fail(`route missing: GET /api/exceptions/:id/review-events (requireAuth)`);
}

// 5) Client panel must surface action UI
const panel = read("client/src/components/exceptions/ExceptionReviewPanel.tsx");
for (const ds of [
  "exception-acknowledge-", "exception-assign-", "exception-add-note-",
  "exception-resolve-", "exception-dismiss-", "exception-reopen-",
  "exception-review-events-",
]) {
  if (!panel.includes(ds)) fail(`panel missing data-testid prefix: ${ds}`);
}
for (const fn of ["postAcknowledge", "postAssign", "postNote", "postDismiss", "postResolve", "postReopen", "fetchReviewEvents"]) {
  if (!panel.includes(fn)) fail(`panel must use client function: ${fn}`);
}

// 6) Honour absolute rules
if (/autoExecute|auto_execute/.test(svc)) fail("review service must not auto-execute anything");
if (/sendEmail|sendSms|sendInvoice/i.test(svc)) fail("review service must not send external messages");

if (failures.length) {
  console.error("[qa-phase-3-exception-human-review-workflow] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-exception-human-review-workflow] PASS");
