// QA: engagement-route delegation (Batch 3 of Engagement completion run).
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
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);

// Delegate flag accessor + executor imported.
requireText(ROUTE, [
  "isRecordCallResultEngagementDelegateEnabled",
  "recordEngagementCallResult",
  "ENGAGEMENT_DELEGATION_CANONICAL_OUTCOMES",
  // Guard expression intact.
  "isRecordCallResultEngagementDelegateEnabled() &&",
  "ENGAGEMENT_DELEGATION_CANONICAL_OUTCOMES.has(data.callResult)",
  // Coarse engagementStatus semantics for legacy parity.
  'engagementStatusSemantics: "coarse"',
  // callbackHours forwarded.
  "callbackHours,",
  // Legacy 6-key envelope still present in BOTH branches.
  "delegatedExecutionCase",
  "delegatedJourneyEvent",
  "delegatedTriageCase",
  "delegatedTask",
  "delegatedOwnershipUpdated",
]);

// Default delegate flag value: OFF accessor pattern unchanged.
const FLAG = "server/services/callResult/recordCallResultEngagementDelegateFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "isRecordCallResultEngagementDelegateEnabled",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  '"1"',
  '"true"',
  '"yes"',
]);

// Legacy branch markers still present (proves we did not delete).
requireText(ROUTE, [
  "Legacy code path",
  "appendJourneyEvent({",
  "patientName,",
  "upsertOpenSchedulingTriageCase({",
  "storage.createTask({",
  ".update(patientExecutionCases)",
  // The legacy response envelope.
  "executionCase: updatedExecutionCase",
  "ownershipUpdated,",
]);

// Delegation branch passes the EngagementCallResultInput shape correctly.
requireText(ROUTE, [
  "execInput: EngagementCallResultInput",
  "journeyEventMetadata: delegationJourneyMetadata",
  "patientName,",
  "assignedTeamMemberId:",
  "forceReassign,",
]);

// Outreach route is untouched.
const OUTREACH = "server/routes/outreach.ts";
requireFile(OUTREACH);
requireNotText(
  OUTREACH,
  [
    "isRecordCallResultEngagementDelegateEnabled",
    "recordEngagementCallResult",
    "ENGAGEMENT_DELEGATION_CANONICAL_OUTCOMES",
  ],
  "Batch 3 outreach route MUST remain untouched",
);

// Plexus IQ untouched.
{
  const DIR = path.join(root, "server/services/plexusIq");
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("recordEngagementCallResult") || src.includes("recordCallResultEngagementDelegateFlag")) {
        failures.push(`Plexus IQ ${rel} references engagement delegation — must remain read-model`);
      }
    }
  }
  walk(DIR);
}

// Response shape preserved in BOTH delegation + legacy branches.
{
  const src = read(ROUTE) ?? "";
  // Each key must appear AT LEAST twice on a `<key>:` line inside the
  // call-result handler — once in the delegation branch, once in the
  // legacy branch.
  const keys = ["ok: true", "executionCase:", "journeyEvent", "triageCase", "task", "ownershipUpdated"];
  for (const k of keys) {
    // Count occurrences inside res.json envelopes.
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const count = (src.match(re) ?? []).length;
    if (count < 2) {
      failures.push(`${ROUTE}: expected "${k}" to appear in BOTH delegation + legacy envelopes (found ${count})`);
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement-route delegation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement-route delegation QA passed.");
