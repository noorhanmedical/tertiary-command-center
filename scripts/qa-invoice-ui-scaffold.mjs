// QA: invoice UI scaffold (Batch G5).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
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

const PANEL = "client/src/components/portal/InvoiceDraftPanel.tsx";
const CANVAS = "client/src/components/portal/PatientCommandCanvas.tsx";
requireFile(PANEL);
requireFile(CANVAS);

// §1 — Flag gate present.
requireText(PANEL, [
  "VITE_USE_INVOICE_UI",
  "INVOICE_UI_ENABLED",
  "if (!INVOICE_UI_ENABLED) return null",
]);

// §2 — Placeholder only — no fetch, no mutation, no useQuery.
requireNotText(PANEL, [
  "useQuery",
  "useMutation",
  'apiRequest("POST"',
  'apiRequest("PATCH"',
  'apiRequest("PUT"',
  'apiRequest("DELETE"',
  "fetch(",
  "/api/invoices",
  "/api/billing/",
  "submitClaim",
  "ingestRemittance",
  "postPayment",
], "invoice UI scaffold is placeholder-only");

// §3 — Wired into PatientCommandCanvas.
requireText(CANVAS, [
  'from "@/components/portal/InvoiceDraftPanel"',
  "<InvoiceDraftPanel",
]);

// §4 — Protected surfaces preserved.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
  "client/src/components/outreach/CallListPanel.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) requireFile(rel);

// §5 — Plexus IQ + Admin Review UI preserved.
for (const rel of [
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx",
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx",
  "client/src/components/qualification/AdminReviewDialog.tsx",
]) requireFile(rel);

// §6 — Flag dormancy: only the panel may reference VITE_USE_INVOICE_UI.
{
  const ALLOWED = new Set([PANEL]);
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
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("VITE_USE_INVOICE_UI")) {
        failures.push(`Unauthorized reference: ${rel} references VITE_USE_INVOICE_UI`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Invoice UI scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Invoice UI scaffold QA passed.");
