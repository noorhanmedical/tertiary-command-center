// QA: shared engagement-board contract (Bundle D).
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Locks the canonical location of EngagementBoardRow so future PRs
// cannot accidentally:
//   - Re-introduce a parallel BoardRow inline at the route or the
//     EngagementAssignmentBoard component.
//   - Drift the field set away from the shared contract.

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

// 1. Canonical contract exists with the expected field set.
requireFile("shared/contracts/engagementBoard.ts");
requireText("shared/contracts/engagementBoard.ts", [
  "export type EngagementBoardRow",
  "patientScreeningId",
  "executionCaseId",
  "engagementBucket",
  "engagementStatus",
  "assignedTeamMemberId",
  "missingInfo",
  "selectedServices",
]);

// 2. Server route consumes the contract — no parallel inline BoardRow.
requireText("server/routes/engagementAssignmentBoard.ts", [
  'from "@shared/contracts/engagementBoard"',
  "EngagementBoardRow",
]);
requireNotText("server/routes/engagementAssignmentBoard.ts", [
  "type BoardRow = {",
], "server route must not redefine BoardRow inline");

// 3. Client board component consumes the contract — no parallel inline
//    BoardRow.
requireText("client/src/components/engagement/EngagementAssignmentBoard.tsx", [
  'from "@shared/contracts/engagementBoard"',
  "EngagementBoardRow",
]);
requireNotText("client/src/components/engagement/EngagementAssignmentBoard.tsx", [
  "type BoardRow = {",
], "client board component must not redefine BoardRow inline");

if (failures.length > 0) {
  console.error("Shared engagement-board contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Shared engagement-board contract QA passed.");
}
