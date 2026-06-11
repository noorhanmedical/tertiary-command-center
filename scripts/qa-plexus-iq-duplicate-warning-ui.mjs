// QA: Plexus IQ duplicate warning UI badge (Batch B7).
//
// Verifies the reusable badge module exists with all warning kinds
// mapped + tooltip wiring. Renderers for Plexus IQ / Admin Review /
// Engagement / Team Portal are covered by Batches B8 / B9 QA scripts.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const BADGE = "client/src/components/patient-directory/DuplicateWarningBadge.tsx";
const c = read(BADGE);
if (c === null) failures.push(`Missing file: ${BADGE}`);
else for (const n of [
  "DuplicateWarningBadge",
  "DuplicateWarningSummary",
  "matched_prior_run",
  "previously_sent_to_engagement",
  "do_not_contact",
  "active_cooldown",
  "expired_cooldown_historical",
  "prior_ancillary_test",
  "onOpenAudit",
  "TooltipProvider",
  "Prior run match",
  "Previously sent",
  "Do Not Contact",
  "Active cooldown",
  "Prior cooldown",
  "Prior ancillary",
  "blockedFromOutreach",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${BADGE}`);

// Plexus IQ + qualification surfaces still on disk (we did not redesign).
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/qualification/AdminReviewDialog.tsx",
]) if (read(rel) === null) failures.push(`Protected surface missing: ${rel}`);

if (failures.length > 0) {
  console.error("Plexus IQ duplicate warning UI QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ duplicate warning UI QA passed.");
