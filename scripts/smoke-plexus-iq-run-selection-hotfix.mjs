#!/usr/bin/env node
// Plexus IQ run selection hotfix smoke.
// 14-step source + child-process smoke proving:
//   1. no giant Qualification runs panel
//   2. compact run selector under date/list
//   3. selected run only (state + reduceToActive)
//   4. visible alphabetical / appointment-time ordering
//   5. packet popup before generation
//   6. selected patients only in packet
//   7. existing Phase 1 smokes still green

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const results = [];
let hadFailure = false;
const STATUSES = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP" };

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function step(num, name, runner) {
  let status = STATUSES.PASS;
  let detail = "";
  try {
    const r = runner();
    if (r && typeof r === "object" && "status" in r) { status = r.status; detail = r.detail ?? ""; }
  } catch (e) {
    status = STATUSES.FAIL; detail = e instanceof Error ? e.message : String(e);
  }
  if (status === STATUSES.FAIL) hadFailure = true;
  results.push({ num, name, status, detail });
  const tag = status === STATUSES.PASS ? "\x1b[32mPASS\x1b[0m"
            : status === STATUSES.SKIP ? "\x1b[33mSKIP\x1b[0m"
            : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${tag}] Step ${String(num).padStart(2, " ")}: ${name}${detail ? "  — " + detail : ""}`);
}

function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) throw new Error(`Missing file: ${rel}`);
  const missing = needles.filter((n) => !c.includes(n));
  if (missing.length > 0) throw new Error(`${rel}: missing ${missing.map((n) => `"${n}"`).join(", ")}`);
}

function runTest(rel) {
  execSync(`npx tsx ${rel}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

console.log("\nPlexus IQ run-selection hotfix smoke\n=========================================");

// 1) No giant panel file.
step(1, "PlexusIQRunOrganizationPanel.tsx is deleted", () => {
  if (read("client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx") !== null)
    throw new Error("file must be deleted");
});

// 2) Workspace doesn't reference it.
step(2, "PlexusIQWorkspace does not reference the giant panel or its title", () => {
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (wk.includes("PlexusIQRunOrganizationPanel")) throw new Error("workspace references the removed panel");
  if (wk.includes("Qualification runs")) throw new Error('workspace contains forbidden "Qualification runs" string');
});

// 3) Compact selector exists.
step(3, "PlexusIQRunSelector compact module present", () => {
  requireText("client/src/components/plexus-iq/PlexusIQRunSelector.tsx", [
    "PlexusIQRunSelector",
    "plexus-iq-run-selector",
    "plexus-iq-run-pick-",
    "plexus-iq-run-all",
    "All runs for this date",
    "explicit only",
  ]);
});

// 4) Workspace renders compact selector and tracks selection state.
step(4, "Workspace tracks selectedBatchByBucket + renders compact selector", () => {
  requireText("client/src/components/plexus-iq/PlexusIQWorkspace.tsx", [
    "selectedBatchByBucket",
    "allRunsModeByBucket",
    "resolveSelection",
    "reduceToActive",
    "<PlexusIQRunSelector",
  ]);
});

// 5) Default selection = most recent.
step(5, "Default selection falls back to the most recent run", () => {
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (!/picked \?\? newest/.test(wk)) throw new Error("default selection missing");
});

// 6) Visible ordering invariants.
step(6, "Outreach alphabetical + visit appointment-time visible test", () => runTest("tests/unit/visibleOrdering.test.ts"));

// 7) PlexusIQWorkspace's WorklistGroupCard sorts before render.
step(7, "WorklistGroupCard maps source patients through orderPatientsWithinRun", () => {
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (!/patientsToRender\s*=\s*orderPatientsWithinRun\(/.test(wk)) throw new Error("patientsToRender must be ordered");
});

// 8) Packet popup state.
step(8, "ClinicDetailPackets has openPacketPicker + packetSel state + PdfPatientSelectDialog", () => {
  requireText("client/src/components/plexus-iq/PlexusIQWorkspace.tsx", [
    "openPacketPicker",
    "packetSel",
    "<PdfPatientSelectDialog",
    'openPacketPicker("plexus"',
    'openPacketPicker("clinician"',
  ]);
});

// 9) Buttons no longer fire packet generation directly.
step(9, "Plexus / Clinician packet buttons do not call handlePacket directly", () => {
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (/onClick=\{\(\)\s*=>\s*handlePacket\(/.test(wk))
    throw new Error("packet buttons must route through openPacketPicker, not handlePacket");
});

// 10) Selected patients only passed to generation.
step(10, "Workspace filters packetSel.patients to selected before handlePacket", () => {
  const wk = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
  if (!/handlePacket\([^,]+,\s*[^,]+,\s*filtered\)/.test(wk))
    throw new Error("packet onGenerate must hand handlePacket the filtered patients");
});

// 11-14) Existing Phase 1 smokes remain green.
step(11, "smoke-phase-1-end-to-end remains green", () => {
  execSync(`node ${path.join(root, "scripts/smoke-phase-1-end-to-end.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});
step(12, "smoke-patient-directory-duplicates remains green", () => {
  execSync(`node ${path.join(root, "scripts/smoke-patient-directory-duplicates.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});
step(13, "smoke-patient-directory-full-activation remains green", () => {
  execSync(`node ${path.join(root, "scripts/smoke-patient-directory-full-activation.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});
step(14, "smoke-phase-1-full-completion remains green", () => {
  execSync(`node ${path.join(root, "scripts/smoke-phase-1-full-completion.mjs")}`, { stdio: ["ignore", "pipe", "pipe"] });
});

console.log("\nSummary\n---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nHotfix smoke FAILED");
  process.exit(1);
}
console.log("\nHotfix smoke passed.");
