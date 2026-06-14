// Smoke — Phase 2 PR 2.8 communication logging chain.
//
// Run: node scripts/smoke-phase-2-communication-logging.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check(
  "1. Logger service exists + records kind/recipient/subject",
  "server/services/communication/communicationLogService.ts",
  (s) => s.includes("logPatientCommunicationEvent") && s.includes("recipient") && s.includes("subject"),
);
check(
  "2. send-email route invokes the logger",
  "server/routes/email.ts",
  (s) => /send-email[\s\S]+?logPatientCommunicationEvent/.test(s),
);
check(
  "3. send-material route invokes the logger",
  "server/routes/email.ts",
  (s) => /send-material[\s\S]+?logPatientCommunicationEvent/.test(s),
);
check(
  "4. Timeline component filters call_result_logged + document_sent(comm)",
  "client/src/components/patient/CommunicationTimeline.tsx",
  (s) =>
    s.includes('eventType === "call_result_logged"') &&
    s.includes('eventType === "document_sent"') &&
    s.includes("communication_kind"),
);
check(
  "5. Center canvas mounts the timeline",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  (s) => s.includes("<CommunicationTimeline patientScreeningId={patientScreeningId}"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: communication logging chain intact.");
