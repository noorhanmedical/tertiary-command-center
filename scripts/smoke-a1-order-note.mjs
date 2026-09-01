// Smoke — Slice A1: canonical Order Note generation/refresh/versioning wiring.
//
// Source-level (no DB): the pure engine + refresh + flag + migration exist and
// are wired into the screening-completion path, ICD/CPT is not injected into
// the Order Note body, and A1 added no signing behavior.
//
// Run: node scripts/smoke-a1-order-note.mjs

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

check("1. projection engine (no >=3 universal rule; crosswalk corroboration only)", "server/services/ancillaryDocuments/orderNoteProjection.ts", (s) =>
  s.includes("projectScreeningFindings") && s.includes("narratedFindings") && s.includes("PRIORITY_CONCEPTS") && s.includes("corroboratedByChart"));

check("2. body renderer has required sections and no code injection", "server/services/ancillaryDocuments/orderNoteBody.ts", (s) =>
  s.includes("MEDICAL NECESSITY / QUALIFICATION") && s.includes("ORDERING CLINICIAN ATTESTATION") &&
  !/\b__screening_meta__\b/.test(s) && !/icd10|cptCodes|cpt_codes/i.test(s));

check("3. Order Note evidence fingerprint distinct from screening version", "server/services/ancillaryDocuments/orderNoteFingerprint.ts", (s) =>
  s.includes("canonicalOrderNoteEvidenceString") && s.includes("narratedFindings"));

check("4. refresh: in-place v1, supersede+version, signed-immutable, flag-gated", "server/services/ancillaryDocuments/orderNoteRefresh.ts", (s) =>
  s.includes("populated_in_place") && s.includes("supersedesNoteId") && s.includes("signed_no_refresh") &&
  s.includes("featureFlags.canonicalOrderNote") && s.includes("featureFlags.orderNoteRefresh") &&
  s.includes("db.transaction"));

check("5. refresh writes evidence fingerprint + evaluated screening version", "server/services/ancillaryDocuments/orderNoteRefresh.ts", (s) =>
  s.includes("evidenceFingerprint") && s.includes("evaluatedScreeningEvidenceVersion"));

check("6. screening completion triggers the unsigned refresh (best-effort, non-throwing)", "server/services/screening/screeningEvidenceService.ts", (s) =>
  s.includes("refreshUnsignedOrderNoteForCase") && s.includes("order_note_refresh_threw"));

check("7. FEATURE_ORDER_NOTE_REFRESH flag defined (default OFF)", "server/lib/featureFlags.ts", (s) =>
  s.includes("orderNoteRefresh") && s.includes('readBool("FEATURE_ORDER_NOTE_REFRESH", false)'));

check("8. procedure_notes schema carries the A1 columns", "shared/schema/generatedNotes.ts", (s) =>
  s.includes('evidenceFingerprint: text("evidence_fingerprint")') &&
  s.includes('evaluatedScreeningEvidenceVersion: text("evaluated_screening_evidence_version")'));

check("9. additive migration 0076 present (not auto-applied)", "migrations/0076_add_order_note_evidence_fingerprint.sql", (s) =>
  s.includes("ADD COLUMN IF NOT EXISTS evidence_fingerprint") &&
  s.includes("ADD COLUMN IF NOT EXISTS evaluated_screening_evidence_version") &&
  /DO NOT RUN AUTOMATICALLY/i.test(s));

// 10. HONESTY — A1 introduced no signing behavior.
for (const file of [
  "server/services/ancillaryDocuments/orderNoteRefresh.ts",
  "server/services/ancillaryDocuments/orderNoteBody.ts",
  "server/services/ancillaryDocuments/orderNoteProjection.ts",
]) {
  const s = read(file) ?? "";
  if (/sign-order|signProcedureNote|signatureStatus\s*:\s*"signed"|\/api\/portal\/sign-order/.test(s)) {
    fails.push(`10. A1 must not add signing behavior — signing reference in ${file}`);
  }
}
if (!fails.some((f) => f.startsWith("10."))) passes.push("10. A1 introduces no signing behavior (no auto-sign, no sign-order route)");

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: A1 wiring intact, no signing behavior introduced.");
