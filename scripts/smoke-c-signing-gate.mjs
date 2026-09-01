// Smoke — Slice C: physician-portal signing gate hardening (no new sign route).
// Run: node scripts/smoke-c-signing-gate.mjs

import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const fails = [];
const passes = [];
const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };
function check(label, file, pred) {
  const s = read(file);
  if (s == null) return fails.push(`${label} — missing ${file}`);
  if (pred(s)) passes.push(label); else fails.push(`${label} — failed for ${file}`);
}

check("1. pure gate defines the required reject codes", "server/services/physicianPortal/signatureRules.ts", (s) =>
  s.includes("orderNoteSigningEligibility") && s.includes("ORDER_NOTE_STALE") &&
  s.includes("REQUIRED_SCREENING_INCOMPLETE") && s.includes("CLINICIAN_NOT_AUTHORIZED"));

check("2. workflow runs the gate for order_note under the canonical flag", "server/services/physicianPortal/signatureWorkflow.ts", (s) =>
  s.includes("orderNoteSigningEligibility") && s.includes('note.noteType === "order_note"') &&
  s.includes("featureFlags.canonicalOrderNote") && s.includes("getCurrentScreeningEvidence"));

check("3. workflow accepts client version tokens", "server/services/physicianPortal/signatureWorkflow.ts", (s) =>
  s.includes("expectedEvidenceFingerprint") && s.includes("expectedScreeningVersion"));

check("4. route forwards version tokens + returns reason", "server/routes/physicianPortal.ts", (s) =>
  s.includes("expectedEvidenceFingerprint") && s.includes("expectedScreeningVersion") && s.includes("reason: outcome.reason"));

// 5. HONESTY — the forbidden route still does not exist anywhere.
{
  let offenders = [];
  for (const f of ["server/routes/portal.ts", "server/routes/physicianPortal.ts"]) {
    const s = read(f) ?? "";
    if (s.includes("/api/portal/sign-order")) offenders.push(f);
  }
  if (offenders.length === 0) passes.push("5. /api/portal/sign-order remains absent (uses existing physician-portal sign route)");
  else fails.push(`5. /api/portal/sign-order present in: ${offenders.join(", ")}`);
}

// 6. Signed-note immutability is not weakened: gate never sets a signed status.
check("6. gate does not fabricate signature state", "server/services/physicianPortal/signatureRules.ts", (s) =>
  !/signatureStatus\s*:\s*"signed"/.test(s));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: C signing gate hardened, no new signing route.");
