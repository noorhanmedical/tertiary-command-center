// QA: Team Portal structured call-result selector contract (Batch E3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/team-portal-structured-call-result-selector-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "structured call-result selector",
  "15 canonical outcomes",
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
  "completed",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
  "Payload shape",
  "engagementCallResultEndpoint",
  "Validation rules",
  "callbackAt",
  "desiredAppointmentStatus",
  "terminalCompletionReason",
  "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
  "NOT allowed in Phase 1",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Canonical fixture still pins 15 entries.
{
  const f = read("tests/fixtures/callResultCanonicalization.fixture.ts");
  if (f === null) failures.push("Missing canonical fixture");
  else {
    const must = [
      "scheduled", "callback", "no_answer", "voicemail", "wrong_number",
      "declined", "needs_records", "insurance_prior_auth_issue",
      "manager_review", "facility_specific_issue",
      "completed", "dnc", "do_not_contact", "deceased", "cancelled",
    ];
    for (const n of must) if (!f.includes(`"${n}"`)) failures.push(`Canonical fixture missing outcome "${n}"`);
  }
}

// Authorized importers of the structured selector flag.
// Batch E4 wires the flag into DispositionSheet; no other source file may
// reference it. Update this allowlist alongside each new authorized batch.
{
  const ALLOWED = new Set([
    "client/src/components/outreach/DispositionSheet.tsx",
  ]);
  const ROOTS = ["server", "client", "shared"];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR")) {
        failures.push(`Unauthorized reference: ${rel} references VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

// Existing endpoint helper still present — selector must reuse it.
{
  const helper = read("client/src/lib/engagementCanonicalCallResultsUiFlag.ts");
  if (helper === null) failures.push("Missing engagementCanonicalCallResultsUiFlag.ts helper");
  else if (!helper.includes("engagementCallResultEndpoint")) failures.push("engagementCallResultEndpoint export missing");
}

if (failures.length > 0) {
  console.error("Team Portal structured call-result selector contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal structured call-result selector contract QA passed.");
