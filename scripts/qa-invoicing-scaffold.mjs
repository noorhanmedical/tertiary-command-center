// QA: invoicing scaffold V2 (Batch G4).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

const SVC = "server/services/invoicing/invoicingScaffold.ts";
const TEST = "server/services/invoicing/__tests__/invoicingScaffold.test.ts";
requireFile(SVC);
requireFile(TEST);

requireText(SVC, [
  "InvoiceDraft",
  "InvoiceLineItemDraft",
  "CashPricingInput",
  "createDraftInvoice",
  "isInvoicingScaffoldEnabled",
  "USE_INVOICING_SCAFFOLD_V2",
  '"draft"',
  '"USD"',
  "InvoicingScaffoldError",
  "totalCents",
]);
requireText(TEST, [
  "createDraftInvoice",
  "isInvoicingScaffoldEnabled",
  "InvoicingScaffoldError",
]);

// Purity — no db / drizzle / express / schema / storage / routes / claim/remittance/denial verbs.
requireNotText(SVC, [
  'from "../../db"',
  'from "../../../db"',
  'from "drizzle-orm"',
  'from "express"',
  'from "@shared/schema"',
  'from "../../routes/',
  'from "../../storage"',
  "console.log",
  "console.info",
  "patientName",
  "patientDob",
  "mrn",
  "ssn",
  "submitClaim",
  "ingestRemittance",
  "postPayment",
  "routeDenial",
], "invoicing scaffold must stay pure / no claims / no PHI / no db");

// Dormancy — no route imports the scaffold.
{
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/invoicingScaffold(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} unauthorized importer of invoicingScaffold`);
    }
  }
  walk(ROUTES);
}

// Protected surfaces — Plexus IQ + Admin Review don't import.
{
  const TARGETS = [
    path.join(root, "server/services/plexusIq"),
    path.join(root, "client/src/components/plexus-iq"),
    path.join(root, "client/src/components/qualification"),
  ];
  const RE = /(?:from|import)\s+['"][^'"]*\/invoicingScaffold(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Protected surface ${rel} unauthorized importer`);
    }
  }
  for (const t of TARGETS) walk(t);
}

// Run the unit test.
if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Invoicing scaffold test FAILED"); }
}

if (failures.length > 0) {
  console.error("Invoicing scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Invoicing scaffold QA passed.");
