#!/usr/bin/env node
// AWS staging readiness helper (Bundle 35).
//
// NON-PRODUCTION helper. Does NOT deploy. Does NOT mutate AWS. Does
// NOT call any AWS API. Does NOT read AWS credentials. Does NOT log
// PHI.
//
// What this script does:
//   1. Extracts the configuration gates listed in
//      docs/architecture/aws-readiness-checklist.md §1 + §2 and
//      renders them as a copy-pasteable operator checklist.
//   2. Reports which gate env vars are PRESENT in the current shell
//      (counts only — never their values).
//   3. Emits a non-zero exit code if any required env var is unset
//      AND --strict is passed.
//
// What this script does NOT do:
//   - Boot the app.
//   - Connect to a DB.
//   - Call AWS.
//   - Mutate any file.
//   - Print any env var value.
//
// Usage:
//   node scripts/aws-staging-readiness-helper.mjs               # print checklist + env presence
//   node scripts/aws-staging-readiness-helper.mjs --strict      # exit 1 on missing env
//   node scripts/aws-staging-readiness-helper.mjs --json        # machine-readable
//   node scripts/aws-staging-readiness-helper.mjs --list-only   # just the checklist

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECKLIST_REL = "docs/architecture/aws-readiness-checklist.md";

// The env vars the checklist references. Pulled out by name so the
// helper can report presence without touching values.
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "STORAGE_PROVIDER",
  "AWS_REGION",
  "NODE_ENV",
];
// Env vars the staging-only path needs but production also accepts.
const STAGING_OPTIONAL_ENV_VARS = [
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  "ENGAGEMENT_TO_CALL_LIST_BRIDGE",
];

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    strict: args.includes("--strict"),
    json: args.includes("--json"),
    listOnly: args.includes("--list-only"),
  };
}

function readChecklist() {
  const abs = path.join(root, CHECKLIST_REL);
  if (!fs.existsSync(abs)) {
    return { found: false, gates: [] };
  }
  const content = fs.readFileSync(abs, "utf8");
  // Extract the §1 + §2 tables. Each row starts with `|` and ends
  // before the next `## ` heading. Pull the gate-name (first cell)
  // out of each row.
  const gates = [];
  const lines = content.split(/\r?\n/);
  let inTable = false;
  let inSection = false;
  let sectionLabel = "";
  for (const line of lines) {
    if (line.startsWith("## 1.")) {
      inSection = true;
      sectionLabel = "configuration";
      inTable = false;
      continue;
    }
    if (line.startsWith("## 2.")) {
      inSection = true;
      sectionLabel = "infrastructure";
      inTable = false;
      continue;
    }
    if (line.startsWith("## 3.")) {
      inSection = false;
      inTable = false;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("| Gate ")) {
      inTable = true;
      continue;
    }
    if (line.startsWith("|---") || line.startsWith("| ---")) continue;
    if (inTable && line.startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim());
      const gate = cells[1] ?? "";
      if (gate && gate !== "---") {
        gates.push({ section: sectionLabel, gate });
      }
    }
    if (inTable && line.length === 0) {
      inTable = false;
    }
  }
  return { found: true, gates };
}

function envPresence(names) {
  return names.map((name) => ({
    name,
    present: typeof process.env[name] === "string" && process.env[name] !== "",
  }));
}

function renderHuman(checklist, requiredEnv, optionalEnv) {
  const lines = [];
  lines.push("AWS staging readiness — operator checklist");
  lines.push("==========================================");
  if (!checklist.found) {
    lines.push("[warn] checklist doc not found; printing env presence only");
  } else {
    lines.push("");
    lines.push("§1 + §2 gates from docs/architecture/aws-readiness-checklist.md:");
    for (const { section, gate } of checklist.gates) {
      lines.push(`  [ ] (${section}) ${gate}`);
    }
  }
  lines.push("");
  lines.push("Required env vars (presence only — values never logged):");
  for (const e of requiredEnv) {
    lines.push(`  ${e.present ? "[set]" : "[unset]"} ${e.name}`);
  }
  lines.push("");
  lines.push("Optional / staging flags:");
  for (const e of optionalEnv) {
    lines.push(`  ${e.present ? "[set]" : "[unset]"} ${e.name}`);
  }
  lines.push("");
  lines.push("Reminders:");
  lines.push("  - Production cutover is OUT OF SCOPE for this helper.");
  lines.push("  - Helper does not deploy, mutate AWS, or read env values.");
  return lines.join("\n");
}

function renderJson(checklist, requiredEnv, optionalEnv) {
  return JSON.stringify(
    {
      checklistFound: checklist.found,
      gates: checklist.gates,
      requiredEnvPresence: requiredEnv,
      optionalEnvPresence: optionalEnv,
    },
    null,
    2,
  );
}

function main() {
  const args = parseArgs(process.argv);
  const checklist = readChecklist();
  const requiredEnv = envPresence(REQUIRED_ENV_VARS);
  const optionalEnv = envPresence(STAGING_OPTIONAL_ENV_VARS);
  if (args.json) {
    console.log(renderJson(checklist, requiredEnv, optionalEnv));
  } else if (args.listOnly) {
    if (checklist.found) {
      for (const { section, gate } of checklist.gates) {
        console.log(`(${section}) ${gate}`);
      }
    }
  } else {
    console.log(renderHuman(checklist, requiredEnv, optionalEnv));
  }
  if (args.strict) {
    const missing = requiredEnv.filter((e) => !e.present);
    if (missing.length > 0) {
      console.error(
        `\nstrict mode: ${missing.length} required env var${missing.length === 1 ? "" : "s"} unset`,
      );
      process.exit(1);
    }
  }
}

main();
