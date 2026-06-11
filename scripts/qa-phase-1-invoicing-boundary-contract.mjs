// QA: Phase 1 invoicing boundary contract (Batch G3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-invoicing-boundary-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "invoicing boundary contract",
  "What invoicing owns in Phase 1",
  "`invoices`",
  "`invoice_line_items`",
  "What invoicing does NOT own",
  "Claims submission. (NOT Phase 1.)",
  "ERA / remittance ingestion. (NOT Phase 1.)",
  "Denial routing. (NOT Phase 1.)",
  "Payment posting",
  "Mission Control",
  "Invoice lifecycle (Phase 1)",
  "draft",
  "finalized",
  "delivered",
  "voided",
  "What G4 scaffold provides",
  "createDraftInvoice",
  "USE_INVOICING_SCAFFOLD_V2",
  "VITE_USE_INVOICE_UI",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Existing invoices tables still present.
{
  const inv = read("shared/schema/invoices.ts") ?? "";
  for (const t of ['"invoices"', '"invoice_line_items"', '"invoice_payments"']) {
    if (!inv.includes(t)) failures.push(`shared/schema/invoices.ts missing ${t}`);
  }
}

// G3 is docs+QA only — the new flags must not appear in code yet.
{
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
      for (const flag of ["USE_INVOICING_SCAFFOLD_V2", "VITE_USE_INVOICE_UI"]) {
        if (src.includes(flag)) failures.push(`G3 is docs+QA only: ${rel} already references "${flag}"`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Phase 1 invoicing boundary contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 invoicing boundary contract QA passed.");
