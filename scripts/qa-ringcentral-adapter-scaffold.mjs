// QA: RingCentral adapter scaffold (Batch E6).
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
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains forbidden "${n}"`);
}

const CLIENT = "server/services/ringCentral/ringCentralClient.ts";
const ADAPTER = "server/services/ringCentral/ringCentralAdapter.ts";
const TEST = "server/services/ringCentral/__tests__/ringCentralAdapter.test.ts";

requireFile(CLIENT);
requireFile(ADAPTER);
requireFile(TEST);

requireText(CLIENT, [
  "RingCentralCallStatus",
  "InitiateCallInput",
  "InitiateCallResult",
  "RingCentralClient",
  "DormantRingCentralClient",
  "ringCentralCallId",
  "patientScreeningId",
  "USE_RINGCENTRAL_ADAPTER OFF",
]);
requireText(ADAPTER, [
  "RingCentralAdapter",
  "isRingCentralAdapterEnabled",
  "createRingCentralAdapter",
  "USE_RINGCENTRAL_ADAPTER",
]);
requireText(TEST, [
  "createRingCentralAdapter",
  "isRingCentralAdapterEnabled",
  "dormant",
]);

// Purity: scaffold may not import db, drizzle, express, schema, storage, or routes.
for (const rel of [CLIENT, ADAPTER]) {
  requireNotText(rel, [
    'from "../../db"',
    'from "../../../db"',
    'from "drizzle-orm"',
    'from "express"',
    'from "@shared/schema"',
    'from "../../routes/',
    'from "../../storage"',
    'from "../storage"',
    "console.log",
    "console.info",
    "patientName",
    "patientDob",
    "mrn",
    "ssn",
  ], "RingCentral scaffold must stay pure / no PHI / no db");
}

// Dormancy: no route file imports the adapter or client.
{
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/ringCentral(?:Adapter|Client)(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} unauthorized importer of RingCentral scaffold`);
    }
  }
  walk(ROUTES);
}

// Dormancy: no Plexus IQ or Admin Review file imports.
{
  const TARGETS = [
    path.join(root, "server/services/plexusIq"),
    path.join(root, "client/src/components/plexus-iq"),
    path.join(root, "client/src/components/qualification"),
  ];
  const RE = /(?:from|import)\s+['"][^'"]*\/ringCentral(?:Adapter|Client)(?:\.\w+)?['"]/;
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
  catch { failures.push("RingCentral adapter test FAILED"); }
}

if (failures.length > 0) {
  console.error("RingCentral adapter scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("RingCentral adapter scaffold QA passed.");
