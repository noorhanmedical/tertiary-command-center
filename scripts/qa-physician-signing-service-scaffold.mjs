// QA: physician signing service scaffold (Batch F6).
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

const SVC = "server/services/ancillary/signingService.ts";
const TEST = "server/services/ancillary/__tests__/signingService.test.ts";
requireFile(SVC);
requireFile(TEST);

requireText(SVC, [
  "SigningStatus",
  "SIGNING_TRANSITIONS",
  "TERMINAL_SIGNING_STATUSES",
  "isSigningServiceEnabled",
  "USE_ANCILLARY_SIGNING_SERVICE",
  "canTransition",
  "nextSigningStatus",
  "requiresPhysicianSignature",
  '"post_procedure_note"',
  '"report"',
]);

// Purity: no db / drizzle / express / schema / storage / routes / PHI / PDF libs.
requireNotText(SVC, [
  'from "../../db"',
  'from "../../../db"',
  'from "drizzle-orm"',
  'from "express"',
  'from "@shared/schema"',
  'from "../../routes/',
  'from "../../storage"',
  'from "pdfkit"',
  'from "html2pdf"',
  "console.log",
  "console.info",
  "patientName",
  "patientDob",
  "mrn",
  "ssn",
], "signing service must stay pure / no PDF deps / no db / no PHI");

// Dormancy: no route or job imports the signing service.
{
  const SCANS = [path.join(root, "server/routes"), path.join(root, "server/services/plexusIq")];
  const RE = /(?:from|import)\s+['"][^'"]*\/signingService(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`${rel} unauthorized importer of signingService`);
    }
  }
  for (const t of SCANS) walk(t);
}

// Plexus IQ + Admin Review UI don't import.
{
  const TARGETS = [
    path.join(root, "client/src/components/plexus-iq"),
    path.join(root, "client/src/components/qualification"),
  ];
  const RE = /(?:from|import)\s+['"][^'"]*\/signingService(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Protected UI surface ${rel} unauthorized importer`);
    }
  }
  for (const t of TARGETS) walk(t);
}

// Run the unit test.
if (failures.length === 0) {
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Signing service test FAILED"); }
}

if (failures.length > 0) {
  console.error("Physician signing service scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Physician signing service scaffold QA passed.");
