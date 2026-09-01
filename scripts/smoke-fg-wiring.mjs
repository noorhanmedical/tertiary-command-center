// Smoke — F/G DB generation wiring (source-level; DB path NOT verified here).
// Run: node scripts/smoke-fg-wiring.mjs

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

// ── F ──
check("F1. component persistence validates via typed schema (no arbitrary JSON)", "server/services/procedureLifecycle/procedureNoteContext.ts", (s) =>
  s.includes("recordProcedureComponents") && s.includes("parseProcedureComponents") && s.includes('status: "invalid_components"') && s.includes('procedureStatus !== "complete"'));

check("F2. generator renders canonical component-aware body via renderProcedureNoteBody", "server/services/procedureLifecycle/procedureNoteGenerator.ts", (s) =>
  s.includes("renderProcedureNoteBody") && s.includes("buildCanonicalProcedureNoteBody") && s.includes("loadProcedureComponents"));

check("F3. generator uses real completed_at as DOS (never now())", "server/services/procedureLifecycle/procedureNoteGenerator.ts", (s) =>
  s.includes("pe.completedAt?.toISOString()") && !/dateOfService:\s*new Date\(\)/.test(s));

check("F4. exact signed Order Note association persisted in sourceData", "server/services/procedureLifecycle/procedureNoteGenerator.ts", (s) =>
  s.includes("associated_order_note_id"));

check("F5. signed Order Note association resolved only when actually signed", "server/services/procedureLifecycle/procedureNoteContext.ts", (s) =>
  s.includes('signatureStatus === "signed"') && s.includes("getActiveOrderNoteForCase"));

check("F6. FAIL-CLOSED: no certification substitute; required-evidence failures classified", "server/services/procedureLifecycle/procedureNoteGenerator.ts", (s) =>
  !s.includes("Procedure Completion Certification") && // legacy certification not used in canonical generator
  s.includes("missing_signed_order_note") && s.includes("invalid_or_missing_component_evidence") &&
  s.includes("missing_procedure_completed_at") && s.includes("Do not mask a canonical generation failure"));

// ── G ──
// G1 — approved codes are RESOLVED (not read from an unpopulated snapshot field):
// CPT from the canonical approved service catalog, ICD from the admin-approved
// qualification reasoning; then intersected with performed components. No
// permissive fallback — absent evidence ⇒ no code.
check("G1. billing generator resolves approved CPT (catalog) + ICD (reasoning) and selects via selectBillingDocumentCodes", "server/services/billingLifecycle/billingDocumentGenerator.ts", (s) =>
  s.includes("selectBillingDocumentCodes") && s.includes("loadProcedureComponents") &&
  s.includes("approvedCptCatalogForService") && s.includes("extractApprovedIcd10FromReasoning") &&
  s.includes("patientScreenings") && s.includes("readiness.patientScreeningId"));

check("G2. packet emits ICD + CPT (billing doc only) and keeps not-a-claim disclaimer", "server/services/billingLifecycle/billingDocumentGenerator.ts", (s) =>
  s.includes("Diagnoses (ICD-10)") && s.includes("Procedures (CPT)") && s.includes("NOT a claim, invoice, remittance"));

// ── ICD/CPT boundary — enforced behaviorally by rendering real bodies and
// scanning the OUTPUT (source-text scanning would false-trip on comments). ──
check("B1. code-leakage guard test renders Order + Procedure bodies and scans output", "tests/unit/codeLeakageGuard.test.ts", (s) =>
  s.includes("renderOrderNoteBody") && s.includes("renderProcedureNoteBody") && s.includes("assertNoCodes") &&
  s.includes("CPT-like 5-digit") && s.includes("ICD-10-like"));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: F/G generation wired (DB path NOT verified — staging required).");
