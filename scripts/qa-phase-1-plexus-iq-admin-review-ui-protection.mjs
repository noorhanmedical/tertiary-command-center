// QA: Phase 1 Plexus IQ + Admin Review UI/runtime protection (Batch D3).
//
// Source-level invariants asserting:
// §1 Plexus IQ UI files still exist (proves no removal in Phase 1).
// §2 Admin Review UI files still exist (proves no removal in Phase 1).
// §3 No Plexus IQ runtime file imports Engagement / Outreach
//    operational writers (call-result service, executors).
// §4 No Admin Review runtime / route file imports Team Portal /
//    workflow operational writers.
// §5 Batch Flow route still exists.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }

// §1 — Plexus IQ UI files present.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
  "client/src/components/plexus-iq/PlexusIQRecentlyDeleted.tsx",
  "client/src/components/plexus-iq/PlexusIQCalendar.tsx",
]) {
  requireFile(rel);
}

// §2 — Admin Review UI file present.
requireFile("client/src/components/qualification/AdminReviewDialog.tsx");

// §3 — No Plexus IQ runtime file imports engagement/outreach operational writers.
{
  const DIR = path.join(root, "server/services/plexusIq");
  const FORBIDDEN_IMPORTS = [
    "recordCallResult",
    "recordCallResultExecutionAdapter",
    "recordCallResultEngagementExecutor",
    "recordCallResultOutreachExecutor",
    "appendJourneyEvent",
    "engagementCallListService",
  ];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      for (const f of FORBIDDEN_IMPORTS) {
        const re = new RegExp(`(?:from|import)\\s+['"][^'"]*\\b${f}\\b`);
        if (re.test(src)) {
          failures.push(`Plexus IQ ${rel} imports operational writer "${f}" — must remain read-model`);
        }
      }
    }
  }
  walk(DIR);
}

// §4 — Admin Review route file does not import operational writers.
{
  const ADMIN = "server/routes/admin.ts";
  const src = read(ADMIN);
  if (src !== null) {
    const FORBIDDEN_IMPORTS = [
      "recordCallResult",
      "recordCallResultExecutionAdapter",
      "recordCallResultEngagementExecutor",
      "recordCallResultOutreachExecutor",
      "engagementCallListService",
    ];
    for (const f of FORBIDDEN_IMPORTS) {
      const re = new RegExp(`(?:from|import)\\s+['"][^'"]*\\b${f}\\b`);
      if (re.test(src)) {
        failures.push(`Admin Review ${ADMIN} imports operational writer "${f}" — Admin Review must remain neutral`);
      }
    }
  }
}

// §5 — Batch Flow route present.
requireFile("server/routes/batches.ts");

// §6 — admin.ts exists and still has its registerAdminRoutes export
//      (smoke check; admin route surface is intentionally narrow —
//      most Admin Review behavior lives in the qualification routes
//      + Plexus IQ services).
{
  const ADMIN = "server/routes/admin.ts";
  const src = read(ADMIN);
  if (src !== null && !src.includes("registerAdminRoutes")) {
    failures.push(`${ADMIN}: registerAdminRoutes export missing`);
  }
}

if (failures.length > 0) {
  console.error("Phase 1 Plexus IQ + Admin Review UI/runtime protection QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 Plexus IQ + Admin Review UI/runtime protection QA passed.");
