// QA — Phase 2 PR 2.8 communication timeline is wired end-to-end.
//
// Run: node scripts/qa-phase-2-communication-timeline.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const service = fs.readFileSync(
  path.join(root, "server/services/communication/communicationLogService.ts"),
  "utf8",
);
if (!service.includes("export async function logPatientCommunicationEvent")) {
  failures.push("communicationLogService must export logPatientCommunicationEvent");
}
if (!service.includes("communication_kind")) {
  failures.push("communicationLogService must record communication_kind in metadata");
}
// PHI hygiene: email body must not appear in the metadata template.
if (/metadata:\s*\{[\s\S]*?body:/.test(service)) {
  failures.push("communicationLogService must NOT record email body in journey metadata");
}

const email = fs.readFileSync(path.join(root, "server/routes/email.ts"), "utf8");
// Both send-email + send-material call the logger.
const sendCalls = (email.match(/logPatientCommunicationEvent\(/g) || []).length;
if (sendCalls < 2) {
  failures.push(`Both send-email AND send-material must call logPatientCommunicationEvent (found ${sendCalls})`);
}
// Logger is best-effort (try/catch around it).
if (!/try \{\s*await logPatientCommunicationEvent/.test(email)) {
  failures.push("logger calls in email routes must be inside try/catch (best-effort, never block send response)");
}

const timeline = fs.readFileSync(
  path.join(root, "client/src/components/patient/CommunicationTimeline.tsx"),
  "utf8",
);
if (!timeline.includes("/api/patient-journey-events")) {
  failures.push("CommunicationTimeline must fetch from /api/patient-journey-events");
}
if (!timeline.includes("communication_kind")) {
  failures.push("CommunicationTimeline must filter on metadata.communication_kind");
}

const canvas = fs.readFileSync(path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"), "utf8");
if (!canvas.includes("CommunicationTimeline")) {
  failures.push("PatientCommandCanvas must mount CommunicationTimeline");
}

if (failures.length > 0) {
  console.error("Phase-2 communication-timeline QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 communication-timeline QA passed.");
