// QA: billing readiness aggregator V2 scaffold (Batch G2).
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

const SVC = "server/services/billingReadiness/billingReadinessAggregator.ts";
const TEST = "server/services/billingReadiness/__tests__/billingReadinessAggregator.test.ts";
requireFile(SVC);
requireFile(TEST);

requireText(SVC, [
  "BillingReadinessSnapshot",
  "BillingReadinessBlocker",
  "BillingReadinessStatus",
  "computeBillingReadiness",
  "isBillingReadinessAggregatorEnabled",
  "USE_BILLING_READINESS_AGGREGATOR_V2",
  "BILLING_REQUIRED_DOCS",
  '"report"',
  '"order_note"',
  '"post_procedure_note"',
  '"billing_document"',
  "requiresPhysicianSignature",
]);

requireText(TEST, [
  "computeBillingReadiness",
  "isBillingReadinessAggregatorEnabled",
  '"ready"',
  '"incomplete"',
  '"blocked"',
  '"billed"',
]);

// Purity — no db / drizzle / express / schema / storage / routes / money helpers / PHI.
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
  "claimAmount",
  "fullAmountPaid",
  "remittanceAmount",
  "balanceDue",
], "billing readiness aggregator must stay pure / no money mutation / no PHI");

// Dormancy — no route file imports the aggregator.
{
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/billingReadinessAggregator(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} unauthorized importer of billingReadinessAggregator`);
    }
  }
  walk(ROUTES);
}

// Plexus IQ / Admin Review surfaces don't import.
{
  const TARGETS = [
    path.join(root, "server/services/plexusIq"),
    path.join(root, "client/src/components/plexus-iq"),
    path.join(root, "client/src/components/qualification"),
  ];
  const RE = /(?:from|import)\s+['"][^'"]*\/billingReadinessAggregator(?:\.\w+)?['"]/;
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
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Billing readiness aggregator test FAILED"); }
}

if (failures.length > 0) {
  console.error("Billing readiness aggregator V2 scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Billing readiness aggregator V2 scaffold QA passed.");
