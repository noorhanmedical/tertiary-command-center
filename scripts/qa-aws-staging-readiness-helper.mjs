// QA: AWS staging readiness helper (Bundle 35).
//
// Source-code invariant + smoke-run the helper. No DB. No app boot.
// No network. NO AWS API CALLS — the helper is forbidden from
// touching AWS, and this QA enforces that at the source-text
// level.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const HELPER_REL = "scripts/aws-staging-readiness-helper.mjs";
const CHECKLIST_REL = "docs/architecture/aws-readiness-checklist.md";

requireFile(HELPER_REL);
requireFile(CHECKLIST_REL);

// 1. The helper must NOT import any AWS SDK or make any network call.
//    It must NOT log env values. It must NOT execute child processes
//    that could touch AWS.
requireNotText(
  HELPER_REL,
  [
    "@aws-sdk/",
    "aws-sdk",
    "https.request",
    "https.get(",
    "http.request",
    "fetch(",
    'spawnSync("aws"',
    'execSync("aws',
    "process.env[name]?.toString()",
    "process.env[name] +",
    // Log the env value would be e.g. `console.log(value)` after
    // reading it — we explicitly forbid the obvious shapes.
    "console.log(value)",
  ],
  "AWS staging helper must not touch AWS, the network, or env values",
);

// 2. The helper must use `--strict`, `--json`, `--list-only` modes
//    so an operator can compose it into other scripts.
requireText(HELPER_REL, [
  "--strict",
  "--json",
  "--list-only",
  // Presence-only env reporting.
  "presence only",
  // Required env var inventory.
  "DATABASE_URL",
  "SESSION_SECRET",
  "STORAGE_PROVIDER",
  "AWS_REGION",
  "NODE_ENV",
]);

// 3. Run the helper in default mode against the current shell and
//    confirm it exits 0 (no --strict) regardless of which env vars
//    are unset.
{
  const helperAbs = path.join(root, HELPER_REL);
  const result = spawnSync("node", [helperAbs], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    failures.push(
      `helper default mode exited ${result.status} (expected 0). stderr: ${result.stderr ?? ""}`,
    );
  }
  // PHI envelope: stdout must never echo the value of a known env var
  // even when set. The check is opportunistic — it sets a synthetic
  // env var and asserts the value never appears in stdout.
  const probeKey = "AWS_STAGING_READINESS_PROBE";
  const probeValue = `do-not-echo-${Date.now()}`;
  const probeResult = spawnSync("node", [helperAbs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, [probeKey]: probeValue },
  });
  if (probeResult.stdout?.includes(probeValue)) {
    failures.push(
      `helper leaked an env-var value to stdout — PHI / secret envelope broken`,
    );
  }
}

// 4. --strict mode: when a required env var is unset, the helper
//    should exit non-zero. Run with NODE_ENV intentionally unset.
{
  const helperAbs = path.join(root, HELPER_REL);
  const stripped = { ...process.env };
  // Strip everything the helper considers required so strict mode
  // has at least one missing var.
  for (const k of [
    "DATABASE_URL",
    "SESSION_SECRET",
    "STORAGE_PROVIDER",
    "AWS_REGION",
    "NODE_ENV",
  ]) {
    delete stripped[k];
  }
  const result = spawnSync("node", [helperAbs, "--strict"], {
    cwd: root,
    encoding: "utf8",
    env: stripped,
  });
  if (result.status === 0) {
    failures.push(`--strict mode must exit non-zero when required env is unset`);
  }
}

if (failures.length > 0) {
  console.error("AWS staging readiness helper QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("AWS staging readiness helper QA passed.");
