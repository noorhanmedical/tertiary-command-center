// Smoke — Slice B-minimal: Order Note portal state + version-token wiring.
// Run: node scripts/smoke-b-portal.mjs

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

check("1. pure derived state exists with the four lifecycle states", "server/services/physicianPortal/signatureRules.ts", (s) =>
  s.includes("deriveOrderNotePortalState") &&
  s.includes("awaiting_screening") && s.includes("ready_for_review") &&
  s.includes("updated_review_required") && s.includes('"signed"'));

check("2. signature item exposes state + version tokens", "server/services/physicianPortal/signatureRules.ts", (s) =>
  s.includes("orderNotePortalState") && s.includes("expectedEvidenceFingerprint") && s.includes("expectedScreeningVersion"));

check("3. worklist derives state from screening currency under the canonical flag", "server/services/physicianPortal/signatureWorkflow.ts", (s) =>
  s.includes("featureFlags.canonicalOrderNote") && s.includes("getCurrentScreeningEvidence") && s.includes("orderNoteCtx"));

check("4. client sends version tokens on sign", "client/src/components/physician/SignaturesTab.tsx", (s) =>
  s.includes("expectedEvidenceFingerprint") && s.includes("expectedScreeningVersion"));

check("5. client handles ORDER_NOTE_STALE + REQUIRED_SCREENING_INCOMPLETE", "client/src/components/physician/SignaturesTab.tsx", (s) =>
  s.includes("ORDER_NOTE_STALE") && s.includes("REQUIRED_SCREENING_INCOMPLETE") && s.includes("review the current Order Note"));

check("6. client renders the lifecycle labels", "client/src/components/physician/SignaturesTab.tsx", (s) =>
  s.includes("Awaiting Screening") && s.includes("Ready for Review") && s.includes("Updated — Review Required"));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: B-minimal portal state + token wiring intact.");
