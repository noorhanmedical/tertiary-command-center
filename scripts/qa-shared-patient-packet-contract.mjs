// QA: shared patient-packet contract (Batch 2).
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Locks the canonical location of the patient-packet response shape so
// future PRs cannot accidentally:
//   - Move the contract back into the server repository.
//   - Define a parallel PatientPacket type in the client.
//   - Drop the re-export chain that lets server + client read from the
//     same source of truth.

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

// 1. The canonical contract exists in shared/.
requireFile("shared/contracts/patientPacket.ts");
requireText("shared/contracts/patientPacket.ts", [
  "export type PatientPacketLookup",
  "export type PatientPacketLookupWarning",
  "export type PatientPacket",
  "resolvedPatientScreeningId",
  "resolvedExecutionCaseId",
  "lookupWarning",
  "patientScreening",
  "executionCase",
  "journeyEvents",
  "globalScheduleEvents",
  "schedulingTriageCases",
  "insuranceEligibilityReviews",
  "cooldownRecords",
  "caseDocumentReadiness",
  "procedureEvents",
  "procedureNotes",
  "billingReadinessChecks",
  "billingDocumentRequests",
  "completedBillingPackages",
  "projectedInvoiceRows",
]);

// 2. Server repository re-exports from the shared contract.
requireText("server/repositories/patientPacket.repo.ts", [
  'from "@shared/contracts/patientPacket"',
  "export type {",
  "PatientPacket",
  "PatientPacketLookup",
  "PatientPacketLookupWarning",
]);

// And the server file no longer defines its own copy of the shape.
requireNotText("server/repositories/patientPacket.repo.ts", [
  "export type PatientPacket = {",
  "export type PatientPacketLookup = {",
  "export type PatientPacketLookupWarning =",
], "server repo must not redefine shared patient-packet types");

// 3. Client API helper imports from the shared contract — no parallel
//    PatientPacket definition allowed.
requireText("client/src/lib/workflow/patientPacketApi.ts", [
  'from "@shared/contracts/patientPacket"',
  "PatientPacket",
  "PatientPacketLookup",
  "fetchPatientPacket",
  "patientPacketQueryKey",
]);
requireNotText("client/src/lib/workflow/patientPacketApi.ts", [
  "export type PatientPacket = {",
  "export type PatientPacketLookup = {",
  // Defensive: catch the loose Record<string, unknown> shape returning.
  "Record<string, unknown> | null",
], "client API helper must not redefine PatientPacket as opaque records");

// 4. Three route aliases preserved at server/routes/patientPacket.ts.
requireText("server/routes/patientPacket.ts", [
  '"/api/patient-packet"',
  '"/api/scheduler-portal/patient-packet"',
  '"/api/technician-liaison/patient-packet"',
  "getPatientPacket",
]);

if (failures.length > 0) {
  console.error("Shared patient-packet contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Shared patient-packet contract QA passed.");
}
