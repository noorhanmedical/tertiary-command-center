// QA — Left panel does NOT include marketing dashboards, outreach
// campaign metrics, revenue / productivity / financial / operational
// dashboards, or any Mission-Control-like surface.
//
// Same approach as the no-patient-timeline QA: scan only the rail
// region.
//
// Run: node scripts/qa-team-portal-left-panel-no-execution-metrics.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

function extractRailRegion() {
  const startMarker = 'data-testid="left-rail-tools-rail"';
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) return null;
  const endIdx = src.indexOf("})()}", startIdx);
  if (endIdx < 0) return src.slice(startIdx);
  return src.slice(startIdx, endIdx + 5);
}

const region = extractRailRegion();
if (region === null) {
  failures.push("Could not locate the left-rail-tools-rail region in TeamPortalShell.tsx");
} else {
  const FORBIDDEN = [
    "MissionControl",
    "RevenueDashboard",
    "ProductivityDashboard",
    "FinancialDashboard",
    "OperationalAnalytics",
    "CampaignMetrics",
    "MarketingDashboard",
    "OutreachDashboard",
    "MarketingMetrics",
    // The right rail is the queue. The left rail must NOT show the
    // outreach call list / patient queue / per-row outreach data.
    "Outreach call list",
    "outreach-row-",
  ];
  for (const needle of FORBIDDEN) {
    if (region.includes(needle)) {
      failures.push(
        `Left tools rail must not include execution metrics / queue surface "${needle}"`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Team Portal left rail (no execution metrics) QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal left rail (no execution metrics) QA passed.");
