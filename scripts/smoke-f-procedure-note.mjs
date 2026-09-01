// Smoke — Slice F: canonical Procedure Note body + component evidence.
// Run: node scripts/smoke-f-procedure-note.mjs

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

check("1. typed component evidence for BW + VW", "shared/schema/procedureComponents.ts", (s) =>
  s.includes("brainWaveComponentsSchema") && s.includes("vitalWaveComponentsSchema") &&
  s.includes("allExpectedComponentsPerformed") && s.includes("parseProcedureComponents"));

check("2. renderer uses approved paragraphs only when all components performed", "server/services/procedureLifecycle/procedureNoteBody.ts", (s) =>
  s.includes("APPROVED_BRAINWAVE") && s.includes("APPROVED_VITALWAVE") && s.includes("allExpectedComponentsPerformed"));

check("3. renderer uses real completed_at (never now()) + no ICD/CPT injection", "server/services/procedureLifecycle/procedureNoteBody.ts", (s) =>
  s.includes("dateOfService") && !/new Date\(\)/.test(s) && !/icd|cpt/i.test(s.replace(/\/\/.*$/gm, "")));

check("4. references exact signed Order Note (no embed of order body)", "server/services/procedureLifecycle/procedureNoteBody.ts", (s) =>
  s.includes("ASSOCIATED ORDER") && s.includes("orderNoteId") && s.includes("Signed Order Note on File") &&
  !s.includes("MEDICAL NECESSITY"));

check("5. proper procedure-note sections (no fake progress-note headings)", "server/services/procedureLifecycle/procedureNoteBody.ts", (s) =>
  s.includes('"INDICATION"') && s.includes('"PROCEDURE DETAILS"') && s.includes('"PROCEDURE STATUS"') &&
  !s.includes("Chief Complaint") && !s.includes("Assessment & Plan"));

check("6. component schema exported via shared barrel", "shared/schema/index.ts", (s) =>
  s.includes('export * from "./procedureComponents"'));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: F procedure note body + component evidence intact.");
