// Smoke — Slice E: semantic procedure readiness prerequisites.
// Run: node scripts/smoke-e-procedure-readiness.mjs

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

check("1. pure semantic resolver exists (screening_form + order_note_signature)", "server/services/procedureLifecycle/procedurePrerequisiteRules.ts", (s) =>
  s.includes("applySemanticPrerequisites") && s.includes('out.delete("screening_form")') && s.includes('"order_note_signature"'));

check("2. evaluator gathers structured screening + signed order note and applies the resolver", "server/services/procedureLifecycle/procedurePrerequisites.ts", (s) =>
  s.includes("getCurrentScreeningEvidence") && s.includes("getActiveOrderNoteForCase") &&
  s.includes("applySemanticPrerequisites(rawSatisfied") && s.includes('signatureStatus === "signed"'));

check("3. procedure_start still runs the evaluator (state machine wiring intact)", "server/services/procedureLifecycle/procedureStateMachine.ts", (s) =>
  s.includes("evaluateProcedurePrerequisites") && s.includes('stage: "procedure_start"') && s.includes("prerequisites_blocked"));

check("4. BW/VW default prerequisite seed exists (hard blockers at procedure_start)", "script/seedProcedurePrerequisites.ts", (s) =>
  s.includes("BrainWave") && s.includes("VitalWave") && s.includes("screening_form") && s.includes("order_note_signature") && s.includes("hard_procedure_blocker"));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: E semantic procedure readiness wired.");
