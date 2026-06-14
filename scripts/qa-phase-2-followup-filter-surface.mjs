// QA — Phase 2 follow-up filter surface is wired correctly.
//
// Asserts:
//   - Server classifier exists with the canonical tag set.
//   - Client classifier mirrors the server one.
//   - QueueFilterTabs component mounted inside portal-right-rail.
//   - No new Scheduler Portal product surface introduced.
//
// Run: node scripts/qa-phase-2-followup-filter-surface.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const serverFile = "server/services/operationalQueue/followUpQueueService.ts";
const clientFile = "client/src/lib/portal/followUpQueueClassifier.ts";

if (!fs.existsSync(path.join(root, serverFile))) failures.push(`missing ${serverFile}`);
if (!fs.existsSync(path.join(root, clientFile))) failures.push(`missing ${clientFile}`);

const REQUIRED_TAGS = [
  "callbacks_due_now",
  "lvm_follow_up",
  "no_answer_follow_up",
  "ready_to_schedule",
  "needs_follow_up",
  "unable_to_reach",
  "manager_review",
  "dnc_or_declined",
  "completed",
];

for (const file of [serverFile, clientFile]) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const src = fs.readFileSync(path.join(root, file), "utf8");
  for (const t of REQUIRED_TAGS) {
    if (!src.includes(`"${t}"`)) {
      failures.push(`${file} must include tag "${t}"`);
    }
  }
  if (!src.includes("export function classifyFollowUpRow") && !src.includes("export function countFollowUpTags")) {
    failures.push(`${file} must export classifyFollowUpRow + countFollowUpTags`);
  }
}

const tabsPath = "client/src/components/portal/QueueFilterTabs.tsx";
if (!fs.existsSync(path.join(root, tabsPath))) {
  failures.push(`missing ${tabsPath}`);
} else {
  const tabs = fs.readFileSync(path.join(root, tabsPath), "utf8");
  if (!tabs.includes("portal-queue-filter-tabs")) {
    failures.push("QueueFilterTabs must have data-testid=portal-queue-filter-tabs");
  }
  if (!tabs.includes("export function QueueFilterTabs")) {
    failures.push("QueueFilterTabs must be exported");
  }
  if (!tabs.includes("export function applyTagFilter")) {
    failures.push("QueueFilterTabs must also export applyTagFilter (parent applies filtering)");
  }
}

const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
if (!shell.includes("QueueFilterTabs")) {
  failures.push("TeamPortalShell must mount QueueFilterTabs");
}
if (!shell.includes("applyTagFilter")) {
  failures.push("TeamPortalShell must apply the filter via applyTagFilter (parent owns visible rows)");
}

// Right-rail layout guardrail: the tabs must be inside the call-list
// mode body which is within portal-right-rail.
const rightRailStart = shell.indexOf('data-testid="portal-right-rail"');
const tabsIdx = shell.indexOf("QueueFilterTabs", rightRailStart > 0 ? rightRailStart : 0);
if (rightRailStart < 0 || tabsIdx < rightRailStart) {
  failures.push("QueueFilterTabs must be rendered inside the portal-right-rail container");
}

// PR 2.3 must NOT introduce a new Scheduler Portal product or new
// top-level nav entry.
const nav = fs.existsSync(path.join(root, "client/src/components/GlobalNav.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/components/GlobalNav.tsx"), "utf8")
  : "";
if (/Scheduler Portal/.test(nav)) {
  failures.push("GlobalNav must not gain a 'Scheduler Portal' label");
}
if (/Follow-up Queue/i.test(nav) || /Triage Queue/i.test(nav)) {
  failures.push("Phase 2 must not add a top-level Follow-up Queue / Triage Queue nav item — surfaces live in existing portals");
}

if (failures.length > 0) {
  console.error("Phase-2 follow-up-filter-surface QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 follow-up-filter-surface QA passed.");
