// QA: patient-packet aliases + lookup-precedence invariants (Bundle 3).
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Locks the three-alias contract + the 400 envelope message + the
// lookup precedence so future PRs cannot accidentally:
//   - Add a 4th alias without an explicit doc update.
//   - Drop one of the aliases.
//   - Change the lookup precedence order (executionCaseId →
//     patientScreeningId → patientName).
//   - Change the 400 envelope message text.
//   - Diverge the handler signature from the canonical aggregation
//     repo function.

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

function requireExactCount(rel, needle, expected) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  const matches = content.split(needle).length - 1;
  if (matches !== expected) {
    failures.push(
      `Expected exactly ${expected} occurrence(s) of "${needle}" in ${rel}; found ${matches}`,
    );
  }
}

// 1. Route file exists with three aliases pointing at the same handler.
requireFile("server/routes/patientPacket.ts");
requireText("server/routes/patientPacket.ts", [
  '"/api/patient-packet"',
  '"/api/scheduler-portal/patient-packet"',
  '"/api/technician-liaison/patient-packet"',
  "handlePatientPacket",
]);

// 2. All three aliases must be GET-only and use the same handler.
//    Enforce by counting handler references — 1 declaration + 3 route
//    callbacks = 4. A 5th occurrence means a new alias was added
//    without updating this invariant.
requireExactCount("server/routes/patientPacket.ts", "handlePatientPacket", 4);

// 3. The 400 envelope message is the exact contract clients rely on.
requireText("server/routes/patientPacket.ts", [
  '"One of executionCaseId, patientScreeningId, or patientName (DOB optional) is required"',
]);

// 4. Lookup precedence — handler walks in this exact order:
//    executionCaseId → patientScreeningId → patientName/patientDob
//    Enforce by line ordering (executionCaseId branch must appear
//    before patientScreeningId branch which must appear before
//    patientName branch).
{
  const content = read("server/routes/patientPacket.ts") ?? "";
  const idxExec = content.indexOf("q.executionCaseId");
  const idxScreening = content.indexOf("q.patientScreeningId");
  const idxName = content.indexOf("q.patientName");
  if (idxExec < 0 || idxScreening < 0 || idxName < 0) {
    failures.push("Lookup branches not all present in patientPacket.ts");
  } else if (!(idxExec < idxScreening && idxScreening < idxName)) {
    failures.push(
      "Lookup precedence broken: expected order executionCaseId → patientScreeningId → patientName",
    );
  }
}

// 5. Handler delegates to the canonical aggregation function — must
//    NOT inline an aggregation. The handler shape is res.json(packet)
//    where packet comes from getPatientPacket.
requireText("server/routes/patientPacket.ts", [
  "getPatientPacket",
  "res.json(packet)",
]);

// 6. Shared contract is the source of the response type — handler
//    must use the repo function whose return type is PatientPacket.
requireText("server/repositories/patientPacket.repo.ts", [
  "from \"@shared/contracts/patientPacket\"",
  "Promise<PatientPacket>",
]);

if (failures.length > 0) {
  console.error("Patient-packet aliases QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Patient-packet aliases QA passed.");
}
