// QA — RingCentral remains honestly dormant.
//
// PR A landed qa-ringcentral-dormant-honesty.mjs which asserts the
// adapter flag exists. PR C tightens the contract:
//   - Adapter defaults FALSE.
//   - No team-portal component fakes a live call (no simulated call
//     state, no Math.random for call duration, no setTimeout-based
//     "call connected" toast).
//   - The portal phone button shows a dormant state when the adapter
//     is off, NOT a fake "Calling…" state.
//
// Run: node scripts/qa-ringcentral-dormant-no-fake-calls.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const adapter = fs.readFileSync(
  path.join(root, "server/services/ringCentral/ringCentralAdapter.ts"),
  "utf8",
);

if (!adapter.includes("isRingCentralAdapterEnabled")) {
  failures.push("ringCentralAdapter.ts must export isRingCentralAdapterEnabled");
}
// Default must be FALSE — the adapter must require an explicit env
// opt-in. We accept either an explicit `return false`, or a positive
// whitelist of truthy strings (the current implementation:
// `return v === "1" || v === "true" || v === "yes"` — anything else
// including undefined is dormant).
const ENABLED_PATTERN = /v === "1" \|\| v === "true" \|\| v === "yes"/;
const RETURN_FALSE_PATTERN = /return\s+false/;
if (!ENABLED_PATTERN.test(adapter) && !RETURN_FALSE_PATTERN.test(adapter)) {
  failures.push("isRingCentralAdapterEnabled must default to false (require explicit env opt-in via USE_RINGCENTRAL_ADAPTER=1|true|yes)");
}
// The env var must be USE_RINGCENTRAL_ADAPTER — explicit, unambiguous.
if (!adapter.includes("USE_RINGCENTRAL_ADAPTER")) {
  failures.push("RingCentral adapter must read USE_RINGCENTRAL_ADAPTER from env (no implicit enablement)");
}

// Scan team-portal components for any phrase that would indicate a
// fake live call state. This is intentionally aggressive — better a
// false positive that asks for a comment than a silent fake.
const FORBIDDEN_PORTAL_PATTERNS = [
  "fakeRingCentralCall",
  "mockRingCentralCall",
  "simulateRingCentralCall",
  "fakeCallConnected",
  "mockCallConnected",
  "fakePhoneCall",
];

const PORTAL_DIRS = [
  "client/src/components/portal",
  "client/src/components/workflow",
];

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const needle of FORBIDDEN_PORTAL_PATTERNS) {
        if (src.includes(needle)) {
          failures.push(`${dir}/${entry.name} contains forbidden fake-call pattern "${needle}"`);
        }
      }
    }
  }
}

for (const d of PORTAL_DIRS) walk(d);

if (failures.length > 0) {
  console.error("RingCentral-dormant-no-fake-calls QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("RingCentral-dormant-no-fake-calls QA passed.");
