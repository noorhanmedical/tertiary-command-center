// QA — Phase 3 must not fake AI confidence or model provider.
//
// Run: node scripts/qa-phase-3-no-fake-ai-confidence.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const SCAN_DIRS = [
  "server/services/ai",
  "server/services/exceptionIntelligence",
];

const FORBIDDEN_PHRASES = [
  // Faking high confidence on a rule output is forbidden.
  'confidenceLabel: "high"', // require justification block above any high label
  // Model provider must be one of the canonical values.
  'modelProvider: "anthropic"',
  'modelProvider: "claude"',
  'modelProvider: "gpt"',
];

// Allowed canonical model providers.
const ALLOWED_PROVIDERS = [
  '"rules_engine"',
  '"openai"',
  '"other"',
  '"not_configured"',
];

function walk(dir, fn) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), fn);
    else if (/\.ts$/.test(entry.name)) fn(path.join(dir, entry.name), fs.readFileSync(path.join(full, entry.name), "utf8"));
  }
}

for (const d of SCAN_DIRS) {
  walk(d, (file, src) => {
    // Forbid non-canonical providers.
    if (/modelProvider:\s*"([^"]+)"/.test(src)) {
      const matches = [...src.matchAll(/modelProvider:\s*"([^"]+)"/g)];
      for (const m of matches) {
        const provider = `"${m[1]}"`;
        if (!ALLOWED_PROVIDERS.includes(provider)) {
          failures.push(`${file} uses non-canonical modelProvider ${provider}`);
        }
      }
    }
    // Forbid high confidence without an adjacent justification comment.
    if (/confidenceLabel:\s*"high"/.test(src)) {
      const ok = /justified by deterministic|deterministically true|justified rule|deterministic rule/i.test(src);
      if (!ok) failures.push(`${file} declares confidenceLabel = "high" without a deterministic-rule justification comment`);
    }
  });
}

if (failures.length > 0) {
  console.error("Phase-3 no-fake-AI-confidence QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 no-fake-AI-confidence QA passed.");
