// Smoke — A0-UI: real ACS/PCS screening UI wiring (source-level, no browser).
// Run: node scripts/smoke-a0-ui-screening.mjs

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

check("1. render model derives from the SHARED registry (no duplicated questions)", "client/src/features/screening/screeningRegistryView.ts", (s) =>
  s.includes('from "@shared/schema/screeningEvidence"') && s.includes("SCREENING_REGISTRY") &&
  !/bw_dx_|bw_sym_|vw_dx_/.test(s.replace(/import[\s\S]*?;/g, "")));

check("2. questionnaire posts to the real A0 route + no ICD/CPT in the form", "client/src/features/screening/ScreeningQuestionnaire.tsx", (s) =>
  s.includes('"/api/screening-evidence"') && s.includes("completionMode") &&
  !/\bICD\b/.test(s) && !/\bCPT\b/.test(s));

check("3. questionnaire captures provenance (origin + transcription + sourceForm)", "client/src/features/screening/ScreeningQuestionnaire.tsx", (s) =>
  s.includes("transcribed_from_paper") && s.includes("sourceForm") && s.includes("direct_entry"));

check("4. page resolves real context + hosts questionnaire", "client/src/pages/ancillary-screening.tsx", (s) =>
  s.includes('"/api/screening-evidence/context"') && s.includes("ScreeningQuestionnaire"));

check("5. route registered in App.tsx", "client/src/App.tsx", (s) =>
  s.includes("AncillaryScreeningPage") && s.includes("/ancillary-screening/:ancillaryCaseId"));

check("6. context endpoint exists (ensure readiness + ids)", "server/routes/screeningEvidence.ts", (s) =>
  s.includes('"/api/screening-evidence/context"') && s.includes("ensureScreeningContext"));

check("7. server stamps documenter identity from session (no client trust)", "server/routes/screeningEvidence.ts", (s) =>
  s.includes("cap.documentedByUserId = userId") && s.includes("Not authenticated"));

check("8. registry carries the exact source label for the UI", "shared/schema/screeningEvidence.ts", (s) =>
  s.includes("label: string;") && s.includes("function bwDx([slug, label, concept]"));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: A0-UI wired to the real A0 backend.");
