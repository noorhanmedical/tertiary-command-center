// QA: Phase 1 completion summary (Batch I3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-completion-summary.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Phase 1 completion summary",
  "Segments shipped",
  "Live runtime changes shipped",
  "E4 structured selector",
  "E7 call-history panel",
  "E9 primary-write switch",
  "E10 query invalidations",
  "G5 invoice draft panel",
  "Dormant scaffolds shipped",
  "Boundary contracts pinned",
  "Flag posture summary",
  "QA coverage",
  "What did NOT ship",
  "Production cut-over to AWS",
  "Mission Control UI / runtime",
  "Claims submission",
  "ERA / remittance ingestion",
  "Plexus IQ UI / runtime change",
  "Admin Review UI / runtime change",
  "Next phase candidates",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Spot-check that the live runtime changes named in the summary are
// actually represented in source.
{
  const dispo = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  for (const n of [
    "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
    "VITE_USE_LEGACY_DISPOSITION_WRITE",
    "engagementCallResultEndpoint",
    '"/api/outreach/calls"',
    '"/api/portal/outreach-call-list"',
    '"/api/engagement-center/cases"',
  ]) if (!dispo.includes(n)) failures.push(`DispositionSheet missing live-change marker "${n}"`);

  const callHistory = read("client/src/components/portal/PatientCallHistoryPanel.tsx") ?? "";
  if (!callHistory.includes("VITE_USE_PATIENT_CALL_HISTORY_READ")) failures.push("PatientCallHistoryPanel missing flag reference");

  const invoice = read("client/src/components/portal/InvoiceDraftPanel.tsx") ?? "";
  if (!invoice.includes("VITE_USE_INVOICE_UI")) failures.push("InvoiceDraftPanel missing flag reference");
}

// Spot-check dormant scaffolds.
for (const rel of [
  "server/services/ringCentral/ringCentralAdapter.ts",
  "server/services/ancillary/ancillaryReadModel.ts",
  "server/services/ancillary/signingService.ts",
  "server/services/billingReadiness/billingReadinessAggregator.ts",
  "server/services/invoicing/invoicingScaffold.ts",
]) if (read(rel) === null) failures.push(`Scaffold missing: ${rel}`);

// QA file count: there must be at least 162 qa-*.mjs files after this batch lands.
{
  const files = fs.readdirSync(path.join(root, "scripts")).filter((f) => f.startsWith("qa-") && f.endsWith(".mjs"));
  if (files.length < 162) failures.push(`Expected ≥162 QA scripts; found ${files.length}`);
}

if (failures.length > 0) {
  console.error("Phase 1 completion summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 completion summary QA passed.");
