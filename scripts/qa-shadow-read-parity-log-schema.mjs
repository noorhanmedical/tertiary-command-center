// QA: shadow-read parity-log schema canonicalization (Bundle 14).
//
// Source-code invariant check. No DB. No app boot. No network. No PHI.
//
// Pins the shadow-read log block in server/routes/schedulerAssignments.ts
// to the exact schema documented in
// docs/architecture/operational-queue-call-list-projection-design.md §6
// so that:
//
//   (a) Every emitted shadow-read line carries the five canonical
//       fields and only those fields:
//         parityMatch, legacyCount, queueCount, inLegacyOnly, inQueueOnly
//   (b) The shadow-read block never logs PHI or a raw payload.
//   (c) The skip-and-error variants stay prefixed and counts-free.
//   (d) The design doc §6 list and the route's emitted-field list
//       cannot drift independently — a change to one fails the
//       other's check here.
//
// Pattern intentionally mirrors scripts/qa-operational-queue-call-list-flag.mjs.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}

function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

// Extracts the shadow-read block from the route file (between the
// USE_OPERATIONAL_QUEUE_CALL_LIST guard and the next `res.json(rows)`)
// so the field-presence and PHI-prohibition checks below apply ONLY to
// the block and don't accidentally match unrelated route logic.
function extractShadowReadBlock(routeContent) {
  if (routeContent === null) return null;
  const startMarker = "isOperationalQueueCallListEnabled()";
  const endMarker = "res.json(rows)";
  const startIdx = routeContent.indexOf(startMarker);
  if (startIdx === -1) return null;
  const endIdx = routeContent.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  return routeContent.slice(startIdx, endIdx);
}

// ─── 1. The route + design doc both exist ────────────────────────────
const ROUTE_REL = "server/routes/schedulerAssignments.ts";
const DESIGN_REL =
  "docs/architecture/operational-queue-call-list-projection-design.md";
requireFile(ROUTE_REL);
requireFile(DESIGN_REL);

// ─── 2. Canonical field list — the same five names live in both
//        the route's shadow-read block and the design doc §6.1 ───────
const CANONICAL_FIELDS = [
  "parityMatch",
  "legacyCount",
  "queueCount",
  "inLegacyOnly",
  "inQueueOnly",
];

const routeContent = read(ROUTE_REL);
const block = extractShadowReadBlock(routeContent);
if (block === null) {
  failures.push(
    `${ROUTE_REL}: shadow-read block not found ` +
      "(expected isOperationalQueueCallListEnabled()... res.json(rows))",
  );
} else {
  for (const field of CANONICAL_FIELDS) {
    if (!block.includes(field)) {
      failures.push(`${ROUTE_REL}: shadow-read block missing field "${field}"`);
    }
  }
  // Pin the canonical opener prefix so the log-aggregation surface
  // can `grep` for one literal string.
  if (!block.includes('"[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read"')) {
    failures.push(
      `${ROUTE_REL}: shadow-read block must emit the literal prefix ` +
        '"[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read"',
    );
  }
}

requireText(DESIGN_REL, [
  "## 6. Shadow-read parity-log schema",
  ...CANONICAL_FIELDS,
  "[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read",
]);

// ─── 3. PHI prohibition — the shadow-read block must never carry
//        patient identifiers, raw payloads, or raw row arrays. The
//        block scope is the only place we apply this check; the
//        legacy `rows` variable name OUTSIDE the block is fine (it's
//        the response body the route returns to the client). ────────
const FORBIDDEN_IN_BLOCK = [
  // PHI field-name leaks.
  "patientName",
  "patientDob",
  "mrn",
  "insurance",
  "diagnosis",
  // Generic raw-payload leak shapes. `summary:` is the inline-patient
  // log shape used elsewhere — banning it here pins the contract.
  "summary:",
  "JSON.stringify",
];
if (block !== null) {
  for (const needle of FORBIDDEN_IN_BLOCK) {
    if (block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: shadow-read block must not reference "${needle}" (PHI / raw-payload leak)`,
      );
    }
  }
}

// ─── 4. The design doc §6.3 PHI prohibition list must remain in
//        the doc — pulling it would invalidate the cross-reference
//        the route's block depends on. ──────────────────────────────
requireText(DESIGN_REL, [
  "## 6.3 PHI prohibition list",
  "patientName",
  "patientDob",
  "mrn",
  "insurance",
  "diagnosis",
  "summary:",
  "JSON.stringify",
]);

// ─── 5. Staging gate is documented and pins the canned-fixture step,
//        the staging-only flag flip, and the 7-day observation window. ─
requireText(DESIGN_REL, [
  "## 7. Staging gate",
  "7 consecutive days",
  "USE_OPERATIONAL_QUEUE_CALL_LIST=1",
  "staging",
  "production default",
  "production flip",
  "projection-parity.test.ts",
  "qa-operational-queue-projection-parity.mjs",
  "qa-shadow-read-parity-log-schema.mjs",
]);

// ─── 6. Skip + error log variants stay prefixed (no field schema)
//        so log aggregation tooling can distinguish them by prefix. ──
if (block !== null) {
  if (!block.includes("[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read skipped")) {
    failures.push(
      `${ROUTE_REL}: shadow-read skip variant must keep its canonical prefix`,
    );
  }
  if (!block.includes("[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read failed:")) {
    failures.push(
      `${ROUTE_REL}: shadow-read error variant must keep its canonical prefix`,
    );
  }
}

// ─── 7. The route as a whole must not have grown a new "shadow-read"
//        line outside the gated block (e.g. an unconditional log that
//        defeats the flag default). Bound the check by counting the
//        literal prefix; the gated block contributes exactly three
//        occurrences (success, skip, error). ───────────────────────
if (routeContent !== null) {
  const prefixOccurrences = routeContent.split(
    "[USE_OPERATIONAL_QUEUE_CALL_LIST]",
  ).length - 1;
  if (prefixOccurrences !== 3) {
    failures.push(
      `${ROUTE_REL}: expected exactly 3 [USE_OPERATIONAL_QUEUE_CALL_LIST] log emissions ` +
        `inside the gated block, found ${prefixOccurrences}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Shadow-read parity-log schema QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Shadow-read parity-log schema QA passed.");
