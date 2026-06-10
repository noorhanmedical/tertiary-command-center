// QA: PHI-safe logger contract (Bundle 8).
//
// Source-code invariant check. No DB, no app boot, no PHI.
// Locks the typed helper at server/lib/phiSafeLogger.ts so future PRs
// cannot accidentally:
//   - Widen LogSafePayload to accept free-form strings.
//   - Add a forbidden tag to LogSafeTag (patient name, dob, insurance,
//     summary, raw, etc.).
//   - Move the helper out of server/lib/.

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
  const content = read(rel);
  if (content === null) failures.push(`Missing file: ${rel}`);
  return content;
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

function requireNotText(rel, needles, label) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (content.includes(needle)) {
      failures.push(`${label}: ${rel} contains "${needle}"`);
    }
  }
}

// 1. Helper exists at the canonical location.
requireFile("server/lib/phiSafeLogger.ts");
requireText("server/lib/phiSafeLogger.ts", [
  "export type LogSafeTag",
  "export type LogSafePayload",
  "export function logPhiSafe",
  "export function warnPhiSafe",
  "export function errorPhiSafe",
]);

// 2. The helper must NOT name PHI fields anywhere in its type. (Sanity
//    check; if any of these tokens appear it's almost certainly a
//    leak path that future authors should review explicitly.)
requireNotText("server/lib/phiSafeLogger.ts", [
  "patientName:",
  "patientDob:",
  "patientPhone:",
  "patientEmail:",
  "insuranceId:",
  "rawPayload:",
  "remittancePayload:",
  "claimPayload:",
  "summary:",
  "metadata:",
], "phiSafeLogger must not expose PHI-shaped fields");

// 3. Helper has no DB or service-layer imports — keep it cheap to
//    import everywhere (no transitive DB pool wakeup).
requireNotText("server/lib/phiSafeLogger.ts", [
  'from "../db"',
  'from "../storage"',
  'from "../services"',
  'from "../repositories"',
], "phiSafeLogger must stay dependency-free");

if (failures.length > 0) {
  console.error("PHI-safe logger QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("PHI-safe logger QA passed.");
}
