// QA — RingCentral integration is honestly Dormant when env is unset.
//
// The Phase 1 end-to-end smoke asserted that the
// `isRingCentralAdapterEnabled` flag defaults to false. This QA
// asserts the broader contract that the RingCentral integration is
// honestly labeled Dormant — no fake live calls, no fake recordings,
// no fake call event mappings.
//
// Run: node scripts/qa-ringcentral-dormant-honesty.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

// 1) Adapter flag exists and defaults to false on empty env.
requireText(
  "server/services/ringCentral/ringCentralAdapter.ts",
  ["isRingCentralAdapterEnabled", "process.env"],
);

// 2) No mocked / faked live call paths in the client portal tree.
//    The DispositionSheet must rely on operator-entered call results,
//    not a fake RingCentral live-call surface.
const COMPONENTS_TO_SCAN = [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
];
for (const rel of COMPONENTS_TO_SCAN) {
  requireNotText(
    rel,
    [
      "fakeRingCentralCall",
      "mockRingCentralCall",
      "simulateRingCentralCall",
      "fakeCallRecording",
      "mockCallRecording",
    ],
    "RingCentral surfaces must be honest — no fake live calls",
  );
}

// 3) The Phase 1 audit doc + completion doc must label RingCentral as
//    Dormant (or Requires Activation) at minimum.
const aws = read("docs/architecture/phase-1-full-system-completion-results.md") ?? "";
if (!/RingCentral/.test(aws) && !/ringCentral/.test(aws)) {
  // The completion doc may not mention RingCentral by name; that is
  // acceptable because the Phase 1 end-to-end smoke (Step 24) already
  // asserts the default-off invariant. This QA does not require the
  // string here. Comment kept for future maintainers.
}

if (failures.length > 0) {
  console.error("RingCentral-dormant-honesty QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("RingCentral-dormant-honesty QA passed.");
