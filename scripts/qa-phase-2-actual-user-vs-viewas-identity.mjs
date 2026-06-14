// QA — Admin view-as must NEVER overwrite the actor identity on a
// call-result audit row. The real session user is the audit actor;
// the viewed-as user is recorded separately as view_as_user_id.
//
// Run: node scripts/qa-phase-2-actual-user-vs-viewas-identity.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const id = fs.readFileSync(
  path.join(root, "server/services/callResult/callResultAuditIdentity.ts"),
  "utf8",
);

// Helper returns actorUserId = session user, never the view-as user.
if (!/actorUserId = req\.session\?\.userId/.test(id)) {
  failures.push("resolveCallResultAuditIdentity must read actorUserId from req.session.userId");
}
// Non-admin callers cannot use view-as — silently dropped.
if (!/actorIsAdmin\s*\?\s*\(rawViewAsTeamMemberId/.test(id)) {
  failures.push("Non-admin callers must have viewAsTeamMemberId dropped to null");
}
// Metadata helper emits both actor + view-as.
if (!/actor_user_id:\s*identity\.actorUserId/.test(id) || !/view_as_user_id:\s*identity\.viewAsTeamMemberId/.test(id)) {
  failures.push("callResultAuditMetadata must emit both actor_user_id AND view_as_user_id");
}

// Route uses the helper + threads its output into the journey
// metadata.
const route = fs.readFileSync(path.join(root, "server/routes/executionCases.ts"), "utf8");
if (!/resolveCallResultAuditIdentity\(\s*req/.test(route)) {
  failures.push("route handler must call resolveCallResultAuditIdentity(req, …)");
}
const metadataSpreadCount = (route.match(/\.\.\.callResultAuditMetadata\(auditIdentity\)/g) || []).length;
if (metadataSpreadCount < 2) {
  failures.push(`route handler must spread callResultAuditMetadata(auditIdentity) into BOTH delegation + legacy journey metadata paths (found ${metadataSpreadCount})`);
}

if (failures.length > 0) {
  console.error("Phase-2 actor-vs-view-as identity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 actor-vs-view-as identity QA passed.");
