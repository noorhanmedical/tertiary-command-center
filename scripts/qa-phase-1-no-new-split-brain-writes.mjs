// QA — No new split-brain call-result write paths.
//
// All call-result writes from the UI MUST go through
// engagementCallResultEndpoint() (the canonical resolver). Any inline
// POST to a hardcoded path like /api/engagement-center/call-result or
// /api/engagement-center/call-results would bypass the resolver and
// create a split-brain risk — if the rollback flag flips, the inline
// path is left on the deprecated endpoint.
//
// This QA scans the client/src tree for inline POSTs to either
// endpoint string outside the canonical resolver file. Any hit is a
// failure.
//
// Run: node scripts/qa-phase-1-no-new-split-brain-writes.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const CANONICAL_RESOLVER_FILE = path.join(
  "client",
  "src",
  "lib",
  "engagementCanonicalCallResultsUiFlag.ts",
);

// Walk client/src looking for any non-resolver file that hardcodes
// either endpoint string. Allow the resolver file itself to contain
// the string literals (it returns them) — that's the canonical site.
const SCAN_ROOT = path.join("client", "src");
const FORBIDDEN_STRINGS = [
  '"/api/engagement-center/call-result"',
  '"/api/engagement-center/call-results"',
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(next));
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(next);
    }
  }
  return out;
}

for (const file of walk(SCAN_ROOT)) {
  if (file === CANONICAL_RESOLVER_FILE) continue;
  const src = fs.readFileSync(path.join(root, file), "utf8");
  for (const needle of FORBIDDEN_STRINGS) {
    if (src.includes(needle)) {
      failures.push(
        `${file} hardcodes ${needle} — must use engagementCallResultEndpoint() instead`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("No new split-brain call-result writes QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No new split-brain call-result writes QA passed.");
