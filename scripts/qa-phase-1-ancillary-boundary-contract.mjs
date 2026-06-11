// QA: Phase 1 ancillary boundary contract (Batch F1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-ancillary-boundary-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "ancillary workflow boundary contract",
  "What ancillary owns in Phase 1",
  "ancillary_appointments",
  "`documents` rows",
  "What ancillary does NOT own",
  "Qualification reasoning",
  "Admin Review approval",
  "Outbound calls, dispositions, callbacks",
  "Billing readiness aggregation",
  "Claims, ERA / remittance, denials, payment posting (NOT Phase 1)",
  "Phase 1 deliverables",
  "Feature flag posture",
  "USE_ANCILLARY_READ_MODEL",
  "USE_ANCILLARY_REPORT_UPLOAD",
  "USE_ANCILLARY_SIGNING_SERVICE",
  "VITE_USE_ANCILLARY_PANEL_SECTIONS",
  "All flags default OFF",
  "Boundaries with other modules",
  "Plexus IQ:",
  "Admin Review:",
  "Engagement:",
  "Billing readiness (G):",
  "Invoicing (G):",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Required upstream tables still in schema (modular split).
{
  const apt = read("shared/schema/appointments.ts") ?? "";
  if (!apt.includes("ancillaryAppointments") || !apt.includes('"ancillary_appointments"')) {
    failures.push("shared/schema/appointments.ts missing ancillaryAppointments table");
  }
  const docs = read("shared/schema/documents.ts") ?? "";
  if (!docs.includes('pgTable("documents"')) {
    failures.push("shared/schema/documents.ts missing documents table");
  }
}

// Authorized importers of each ancillary flag.
// Update alongside each new authorized batch.
{
  const ALLOWED_BY_FLAG = {
    USE_ANCILLARY_READ_MODEL: new Set([
      "server/services/ancillary/ancillaryReadModel.ts",
      "server/services/ancillary/__tests__/ancillaryReadModel.test.ts",
    ]),
    USE_ANCILLARY_REPORT_UPLOAD: new Set(),
    USE_ANCILLARY_SIGNING_SERVICE: new Set(),
    VITE_USE_ANCILLARY_PANEL_SECTIONS: new Set(),
  };
  const ROOTS = ["server", "client", "shared"];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      for (const [flag, allowed] of Object.entries(ALLOWED_BY_FLAG)) {
        if (allowed.has(rel)) continue;
        if (src.includes(flag)) failures.push(`Unauthorized reference: ${rel} references "${flag}"`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Phase 1 ancillary boundary contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 ancillary boundary contract QA passed.");
