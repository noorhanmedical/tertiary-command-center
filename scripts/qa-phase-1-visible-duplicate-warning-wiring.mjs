// QA: Phase 1 visible duplicate-warning wiring (Part 5).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — Plexus IQ surface renders DuplicateWarningBadge via the new panel.
const PANEL = read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") ?? "";
for (const n of ["DuplicateWarningBadge", "DuplicateWarningSummary", "useLiveDuplicateWarnings"]) {
  if (!PANEL.includes(n)) failures.push(`PlexusIQRunOrganizationPanel missing "${n}"`);
}

// §2 — AdminApprovalControl imports + renders the guard + uses isApprovalHardBlocked.
const APPROVE = read("client/src/components/qualification/AdminApprovalControl.tsx") ?? "";
for (const n of [
  "AdminReviewDuplicateGuard",
  "isApprovalHardBlocked",
  "useLiveDuplicateWarnings",
  "<AdminReviewDuplicateGuard",
  "blocked &&",
]) if (!APPROVE.includes(n)) failures.push(`AdminApprovalControl missing "${n}"`);

// §3 — Engagement Center renders the duplicate banner.
const EC = read("client/src/pages/engagement-center.tsx") ?? "";
for (const n of [
  "EngagementDuplicateBanner",
  "<EngagementDuplicateBanner",
]) if (!EC.includes(n)) failures.push(`engagement-center page missing "${n}"`);

const BAN = read("client/src/components/engagement/EngagementDuplicateBanner.tsx") ?? "";
for (const n of [
  "EngagementHandoffDuplicateBar",
  "useLiveDuplicateWarnings",
  "PatientAuditTrailModal",
]) if (!BAN.includes(n)) failures.push(`EngagementDuplicateBanner missing "${n}"`);

// §4 — Team Portal CallListPanel renders a duplicate banner.
const CLP = read("client/src/components/outreach/CallListPanel.tsx") ?? "";
for (const n of [
  "CallListDuplicateBanner",
  "<CallListDuplicateBanner",
]) if (!CLP.includes(n)) failures.push(`CallListPanel missing "${n}"`);

const CDB = read("client/src/components/outreach/CallListDuplicateBanner.tsx") ?? "";
for (const n of [
  "EngagementHandoffDuplicateBar",
  "useLiveDuplicateWarnings",
  "PatientAuditTrailModal",
]) if (!CDB.includes(n)) failures.push(`CallListDuplicateBanner missing "${n}"`);

// §5 — Patient Directory live page also renders summaries (already wired).
const PDL = read("client/src/components/patient-directory/PatientDirectoryLivePage.tsx") ?? "";
if (!PDL.includes("warningResultsById")) failures.push("PatientDirectoryLivePage missing warningResultsById prop wiring");

if (failures.length > 0) {
  console.error("Phase 1 visible duplicate-warning wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 visible duplicate-warning wiring QA passed.");
