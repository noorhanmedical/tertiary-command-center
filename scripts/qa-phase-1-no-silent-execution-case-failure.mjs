// QA — No silent execution case failure on Admin Review approval.
//
// Phase 1 Slice 1.3 contract: when commitPatient throws on an approval
// (which is the call that creates/updates the execution case and the
// engagement assignment), the handler must NOT return `ok: true` with
// `routedToEngagement: false` and no other signal. The failure must
// be surfaced via:
//   - commitFailed: true (a boolean flag in the JSON response)
//   - commitError: string (the error message)
//
// Without these flags, the client would see the same response shape
// for "no commit was attempted" and "commit failed", which is the
// silent-failure mode the guardrails forbid.
//
// Run: node scripts/qa-phase-1-no-silent-execution-case-failure.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

const handler = read("server/routes/patients.ts") ?? "";

// 1) Source-level: the catch block around commitPatient must capture
//    the error message into a variable that gets returned in the JSON
//    response. We check that the words "commitFailed" and "commitError"
//    both appear, and that they appear in the response.json(...) call.
if (!/commitFailed/.test(handler)) {
  failures.push("server/routes/patients.ts must surface `commitFailed` in the admin-approval response");
}
if (!/commitError/.test(handler)) {
  failures.push("server/routes/patients.ts must surface `commitError` in the admin-approval response");
}

// 2) The fields must travel through the actual res.json() payload.
//    Capture the body of the admin-approval handler and confirm
//    commitFailed + commitError appear inside res.json(...).
const handlerMatch = /\/api\/patient-screenings\/:id\/admin-approval[\s\S]*?res\.json\(\{[\s\S]*?\}\);/.exec(handler);
if (!handlerMatch) {
  failures.push("Could not locate the admin-approval res.json(...) block to verify the no-silent-failure shape");
} else {
  const body = handlerMatch[0];
  if (!body.includes("commitFailed")) {
    failures.push("admin-approval res.json(...) must include `commitFailed`");
  }
  if (!body.includes("commitError")) {
    failures.push("admin-approval res.json(...) must include `commitError`");
  }
}

// 3) Audit log must also capture the commit failure so it's visible in
//    the journey event even if the client missed it.
if (!/routedToEngagement[\s\S]{0,200}commitFailed/.test(handler) && !/commitFailed[\s\S]{0,200}routedToEngagement/.test(handler)) {
  // Not strict — the audit metadata may interleave fields in any order.
  // We only require that commitFailed appears alongside routedToEngagement
  // somewhere in the handler.
  failures.push("admin-approval audit metadata should carry `commitFailed` near `routedToEngagement` so the failure is auditable");
}

if (failures.length > 0) {
  console.error("No silent execution case failure QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No silent execution case failure QA passed.");
