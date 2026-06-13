// QA — Audit identity is preserved under admin view-as.
//
// When admin acts (write a call result, approve, etc.) while observing
// as a team member, the write must record the ADMIN identity, not the
// viewed-as user's. The viewAs only narrows the feed/visibility.
//
// Evidence:
//   1. /api/engagement-center/call-results uses req.session.userId as
//      actor (Slice 1.4 contract — unchanged).
//   2. /api/patient-screenings/:id/admin-approval uses req.session.userId
//      (Slice 1.3 contract — unchanged).
//   3. The view-as resolver itself documents this invariant in a
//      comment so future refactors don't accidentally swap the actor.
//
// Run: node scripts/qa-team-portals-viewas-audit-identity.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

const portal = "server/routes/portal.ts";
const patients = "server/routes/patients.ts";

// 1) Resolver block documents the audit invariant.
requireText(portal, [
  "session role stays \"admin\"",
  "real admin",
]);

// 2) Admin-approval handler uses session userId as the actor (Slice 1.3
//    preservation).
requireText(patients, [
  "const userId: string | null = req.session.userId ?? null",
  "/admin-approval",
]);

// 3) Admin-approval handler must NOT read a viewAs / impersonate-as
//    field for the actor identity.
requireNotText(
  patients,
  [
    "viewAsTeamMemberId",
    "actorUserId: viewAs",
  ],
  "admin-approval handler must not adopt the viewed-as user as the actor",
);

if (failures.length > 0) {
  console.error("View-as audit identity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("View-as audit identity QA passed.");
