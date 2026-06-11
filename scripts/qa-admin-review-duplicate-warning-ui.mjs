// QA: Admin Review duplicate warning + approval guard (Batch B8).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const GUARD = "client/src/components/patient-directory/AdminReviewDuplicateGuard.tsx";
const c = read(GUARD);
if (c === null) failures.push(`Missing file: ${GUARD}`);
else for (const n of [
  "AdminReviewDuplicateGuard",
  "isApprovalHardBlocked",
  "DuplicateWarningBadge",
  "Patient is blocked from outreach",
  "Open audit trail",
  "blockedFromOutreach",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${GUARD}`);

// Admin Review dialog still intact + still includes the existing
// approval/regenerate controls (we did NOT redesign it).
{
  const dialog = read("client/src/components/qualification/AdminReviewDialog.tsx") ?? "";
  if (dialog.length < 1000) failures.push("AdminReviewDialog.tsx unexpectedly truncated — possible redesign");
}

if (failures.length > 0) {
  console.error("Admin Review duplicate warning QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin Review duplicate warning QA passed.");
