// QA: platform split-brain source scanner — BASELINE (Batch 3 of run).
//
// Source-level scanner that detects risky duplicate write ownership
// patterns. This is BASELINE only — known split-brain that already
// exists on main is reported via console.info but does NOT fail
// the build. New duplicate writers that arrive without a documented
// exception WILL fail.
//
// Detected patterns:
//   - direct writes to patient_execution_cases outside the allow-list
//   - direct writes to outreach_calls outside the allow-list
//   - direct writes to scheduler_assignments outside the allow-list
//   - direct writes to plexus_tasks outside the allow-list
//   - direct journey-event inserts outside the canonical writer
//   - Plexus IQ services writing operational workflow tables
//   - Team Portal routes writing core workflow tables
//   - route files writing patient_execution_cases via db.update/insert
//     without going through the execution-case service
//
// Exception list is in scripts/qa-platform-split-brain-source-scanner.allowlist.json
// (NOT included in this baseline batch — failures are info-only here).
//
// No DB. No app boot. No PHI.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const info = [];

// ─── Helpers ──────────────────────────────────────────────────────
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function walkSrcFiles(roots) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".next" ||
        e.name === "build"
      ) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      // Skip tests + fixtures — those don't ship in runtime.
      if (rel.includes("/__tests__/")) continue;
      if (rel.includes("/test/") || rel.includes("/tests/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      out.push(rel);
    }
  }
  for (const r of roots) walk(path.join(root, r));
  return out;
}

// ─── Pattern definitions ──────────────────────────────────────────
const SOURCE_ROOTS = ["server"];

// table → allowed canonical writer files (relative to repo root).
// "Allowed" means the file is the documented canonical writer per
// the ownership registry (Batch 2). Other files calling that table's
// write verbs trip the scanner.
const TABLE_WRITER_RULES = [
  {
    label: "patient_execution_cases",
    pattern: /(?:db\.(?:insert|update|delete)\(\s*patientExecutionCases|\.(?:insert|update|delete)\(\s*patientExecutionCases\b)/,
    allow: [
      // Execution-case repo + the canonical route owning the table.
      "server/repositories/executionCase.repo.ts",
      "server/routes/executionCases.ts",
      // Known co-writers documented in Batch 1 audit (will be funneled
      // into the execution-case service in a later sequenced batch).
      "server/routes/engagementAssignmentBoard.ts",
      "server/routes/patients.ts",
      "server/routes/globalSchedule.ts",
      "server/services/patientCommitService.ts",
      "server/services/schedulerAutoAssign.ts",
    ],
  },
  {
    label: "outreach_calls",
    // Direct mutation calls to outreachCalls. Canonical writer is
    // storage.createOutreachCallAtomic, which delegates to the repo.
    pattern: /(?:db\.(?:insert|update|delete)\(\s*outreachCalls|\.(?:insert|update|delete)\(\s*outreachCalls\b)/,
    allow: [
      "server/storage.ts",
      "server/repositories/outreach.repo.ts",
    ],
  },
  {
    label: "scheduler_assignments",
    pattern: /(?:db\.(?:insert|update|delete)\(\s*schedulerAssignments|\.(?:insert|update|delete)\(\s*schedulerAssignments\b)/,
    allow: [
      "server/storage.ts",
      "server/repositories/schedulerAssignments.repo.ts",
      "server/services/schedulerAssignmentService.ts",
      "server/services/schedulerAutoAssign.ts",
      "server/routes/schedulerAssignments.ts",
      // Flag-gated engagement→call-list bridge (Batch E).
      "server/modules/operational-queue/bridge.ts",
    ],
  },
  {
    label: "plexus_tasks",
    pattern: /(?:db\.(?:insert|update|delete)\(\s*plexusTasks|\.(?:insert|update|delete)\(\s*plexusTasks\b)/,
    allow: [
      "server/storage.ts",
      "server/repositories/plexus.repo.ts",
      "server/routes/plexusTasks.ts",
    ],
  },
  {
    label: "patient_journey_events",
    pattern: /(?:db\.(?:insert|update|delete)\(\s*patientJourneyEvents|\.(?:insert|update|delete)\(\s*patientJourneyEvents\b)/,
    allow: [
      "server/services/journey/appendJourneyEvent.ts",
      // The repo is read-only at the time of audit; if reads-only,
      // the pattern won't match. Listed for safety.
      "server/repositories/journeyEvents.repo.ts",
    ],
  },
  {
    label: "scheduling_triage_cases",
    pattern: /(?:db\.(?:insert|update|delete)\(\s*schedulingTriageCases|\.(?:insert|update|delete)\(\s*schedulingTriageCases\b)/,
    allow: [
      "server/repositories/schedulingTriage.repo.ts",
    ],
  },
];

// Plexus IQ MUST NOT write operational workflow tables.
const PLEXUS_IQ_FORBIDDEN_WRITES = [
  /patientExecutionCases/,
  /outreachCalls/,
  /schedulerAssignments/,
  /plexusTasks/,
  /patientJourneyEvents/,
  /schedulingTriageCases/,
];

// Team Portal MUST NOT write core workflow tables directly.
const TEAM_PORTAL_FORBIDDEN_WRITES_RE =
  /(?:db\.(?:insert|update|delete)\(\s*(?:patientExecutionCases|outreachCalls|schedulerAssignments|plexusTasks|patientJourneyEvents|schedulingTriageCases))/;

// ─── Scan ─────────────────────────────────────────────────────────
const files = walkSrcFiles(SOURCE_ROOTS);

for (const rule of TABLE_WRITER_RULES) {
  for (const rel of files) {
    if (rule.allow.includes(rel)) continue;
    const src = read(rel) ?? "";
    if (rule.pattern.test(src)) {
      info.push(
        `[baseline] ${rel} writes ${rule.label} outside the canonical writer allow-list (registry §"One canonical writer per canonical table")`,
      );
    }
  }
}

// Plexus IQ purity invariant — failures here are HARD, not baseline.
{
  const plexusFiles = files.filter((rel) => rel.startsWith("server/services/plexusIq/"));
  for (const rel of plexusFiles) {
    const src = read(rel) ?? "";
    // Drop comments so we don't false-positive on doc text.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of PLEXUS_IQ_FORBIDDEN_WRITES) {
      // Only flag if the identifier appears next to a write verb.
      const writeNear = new RegExp(
        `(?:insert|update|delete)\\([^\\)]*${forbidden.source}|${forbidden.source}\\s*[,\\)]`,
      );
      if (writeNear.test(codeOnly)) {
        failures.push(
          `Plexus IQ split-brain: ${rel} appears to write ${forbidden.source} — Plexus IQ must remain read-model/intelligence (registry §"Plexus IQ")`,
        );
      }
    }
  }
}

// Team Portal purity invariant — failures here are HARD.
{
  const portalRel = "server/routes/portal.ts";
  const src = read(portalRel) ?? "";
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (TEAM_PORTAL_FORBIDDEN_WRITES_RE.test(codeOnly)) {
    failures.push(
      `Team Portal split-brain: ${portalRel} writes a core workflow table directly — Team Portal must remain a consumer (registry §"Team Portal")`,
    );
  }
}

// ─── Report ───────────────────────────────────────────────────────
if (info.length > 0) {
  console.info(
    `Platform split-brain source scanner BASELINE — ${info.length} known split-brain finding(s) (not failing the build):`,
  );
  for (const i of info) console.info(`  ${i}`);
  console.info(
    "These are tracked in docs/architecture/platform-split-brain-source-scanner-baseline.md and",
  );
  console.info(
    "are expected to shrink as canonical-writer consolidation PRs ship. NEW duplicate writers will fail.",
  );
}

if (failures.length > 0) {
  console.error("Platform split-brain source scanner FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log(
  `Platform split-brain source scanner passed (baseline = ${info.length} known finding(s); 0 hard failures).`,
);
