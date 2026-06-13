// QA — Facility identity dual-write parity guard.
//
// The repo currently stores facility identity as plain text in 27+
// columns (some named `facility`, some `facilityId`) with no master
// `facilities` table. A canonical facilities migration is intentionally
// deferred to Phase 2/5 per the migration ADR.
//
// This QA asserts:
//
// 1. The canonical name list in `shared/plexus.ts` (VALID_FACILITIES)
//    is still the source of truth.
// 2. No NEW schema file added to `shared/schema/` without using the
//    canonical `facilityId: text("facility_id")` shape (new tables
//    naming the column just `facility` are forbidden).
// 3. The migration ADR documents the canonical-facilities deferral.
//
// Run: node scripts/qa-phase-1-facility-dual-write-parity.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

// 1) Source of truth.
requireText("shared/plexus.ts", [
  "VALID_FACILITIES",
  '"Taylor Family Practice"',
  '"NWPG - Spring"',
  '"NWPG - Veterans"',
]);

// 2) New schema files: any tables created from Slice 1.2 onward use
//    `facilityId: text("facility_id")` (or no facility column). The
//    forbidden pattern is `facility: text("facility")` in any file
//    that did NOT exist on Slice 1.0 baseline. We use a soft heuristic:
//    schema files that already use `facility: text("facility")` are
//    grandfathered (patient_screenings, screening_batches, etc.); only
//    flag a regression if a NEW schema file is added with that shape
//    in a future slice. This script does a structural check — it
//    counts files in `shared/schema/` that contain
//    `facility: text("facility")` and asserts the count stays within
//    the known-grandfathered set documented below.
const SCHEMA_DIR = "shared/schema";
// Schema files that already use the legacy `facility: text("facility")`
// shape on the Phase 1 baseline. These are grandfathered — the
// canonical migration to `facilityId: text("facility_id")` (+ a master
// facilities table FK) is intentionally deferred to Phase 2/5 per
// docs/architecture/migration-policy-adr.md. The QA only catches NEW
// schema files (post-baseline) that regress to the legacy shape.
const KNOWN_GRANDFATHERED = new Set([
  path.join(SCHEMA_DIR, "appointments.ts"),
  path.join(SCHEMA_DIR, "billing.ts"),
  path.join(SCHEMA_DIR, "documents.ts"),
  path.join(SCHEMA_DIR, "invoices.ts"),
  path.join(SCHEMA_DIR, "notes.ts"),
  path.join(SCHEMA_DIR, "outbox.ts"),
  path.join(SCHEMA_DIR, "outreach.ts"),
  path.join(SCHEMA_DIR, "plexus.ts"),
  path.join(SCHEMA_DIR, "screening.ts"),
]);

const dir = path.join(root, SCHEMA_DIR);
let actualUsing = [];
if (fs.existsSync(dir)) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const rel = path.join(SCHEMA_DIR, entry.name);
    const src = read(rel) ?? "";
    if (/facility:\s*text\("facility"\)/.test(src)) {
      actualUsing.push(rel);
    }
  }
}
for (const rel of actualUsing) {
  if (!KNOWN_GRANDFATHERED.has(rel)) {
    failures.push(
      `New schema file uses legacy facility-string shape: ${rel} — new tables must use facilityId: text("facility_id"). See docs/architecture/migration-policy-adr.md.`,
    );
  }
}

// 3) The migration ADR documents the canonical-facilities deferral so a
//    future engineer can find the rationale.
requireText("docs/architecture/migration-policy-adr.md", [
  "Dual-write window",
  "facilities table",
]);

if (failures.length > 0) {
  console.error("Facility dual-write parity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Facility dual-write parity QA passed.");
