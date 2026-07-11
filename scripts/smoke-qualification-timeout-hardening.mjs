#!/usr/bin/env node
// Qualification timeout hardening smoke (hotfix).
//
// DB-agnostic source + child-process smoke. Verifies the hotfix
// invariants without requiring DATABASE_URL.

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

console.log("\nQualification timeout hardening smoke\n=========================================");

// 1) AbortController hardening in aiClient.
step(1, "aiClient.ts uses AbortController + env-controlled timeout/retries", () =>
  requireText("server/services/aiClient.ts", [
    "AbortController",
    "AI_TIMEOUT_MS",
    "AI_MAX_RETRIES",
    "controller.abort",
    "getAiClientConfig",
  ]),
);

// 2) Model is preserved.
step(2, "screening.ts still uses gpt-4o + JSON object + 16000 tokens + forwards signal", () => {
  requireText("server/services/screening.ts", [
    'model: "gpt-4o"',
    "response_format: { type: \"json_object\" }",
    "max_completion_tokens: 16000",
    "{ signal }",
  ]);
});

// 3) Runner has restrictToPatientIds + recover; lowered concurrency
//    lives in the pure config module.
step(3, "batchAnalysisRunner exposes restrictToPatientIds + recoverStuckAnalysisJobs + 2-concurrency default", () => {
  requireText("server/services/batchAnalysisRunner.ts", [
    "StartBatchAnalysisOptions",
    "restrictToPatientIds",
    "recoverStuckAnalysisJobs",
    "DEFAULT_BATCH_ANALYSIS_CONCURRENCY",
    "RecoveredStuckJob",
    "JOB_STUCK_THRESHOLD_MS",
  ]);
  requireText("server/services/batchAnalysisConfig.ts", [
    "BATCH_ANALYSIS_CONCURRENCY_DEFAULT = 2",
    "JOB_STUCK_THRESHOLD_MS_DEFAULT",
  ]);
});

// 4) Routes route through the durable path.
step(4, "/api/batches/:id/analyze delegates to startBatchAnalysis", () => {
  const r = read("server/routes/batches.ts") ?? "";
  requireText("server/routes/batches.ts", ["startBatchAnalysis(", "NoSuchBatchError", "EmptyBatchError"]);
  if (/await batchProcess\(/.test(r)) throw new Error("batches.ts must not run batchProcess directly anymore");
});

step(5, "/api/patients/:id/analyze-async exists + restricts to one patient", () =>
  requireText("server/routes/patients.ts", [
    '"/api/patients/:id/analyze-async"',
    "restrictToPatientIds: [id]",
  ]),
);

step(6, "Stuck-job recovery + config endpoints exposed", () =>
  requireText("server/routes/plexusIqClinicalImport.ts", [
    '"/api/plexus-iq/qualification-jobs/recover-stuck"',
    '"/api/plexus-iq/qualification-config"',
    "recoverStuckAnalysisJobs",
    "getAiClientConfig",
  ]),
);

// 7) Client hook + page wiring.
step(7, "useAnalyzePatientAsync client mutation present", () =>
  requireText("client/src/hooks/api/screening-batches.ts", [
    "useAnalyzePatientAsync",
    "/analyze-async",
    "AnalyzePatientAsyncResult",
  ]),
);

step(8, "useQualificationJobStatus polling hook present + treats network failures as reconnecting", () =>
  requireText("client/src/hooks/api/useQualificationJobStatus.ts", [
    "useQualificationJobStatus",
    "reconnecting",
    "consecutiveFailures",
    "maxBackoffMs",
  ]),
);

step(9, "plexus-iq.tsx uses useAnalyzePatientAsync (no synchronous legacy hand-off)", () => {
  const wk = read("client/src/pages/plexus-iq.tsx") ?? "";
  if (!wk.includes("useAnalyzePatientAsync")) throw new Error("must import useAnalyzePatientAsync");
  if (!wk.includes("analyzePatientAsyncMut.mutateAsync")) throw new Error("handleAnalyzePatient must call the async mutation");
});

step(10, "Docs present", () =>
  requireText("docs/architecture/qualification-timeout-hardening.md", [
    "Qualification timeout hardening",
    "Old failure mode",
    "Env vars",
    "Stuck-job behavior",
    "Model preservation",
  ]),
);

// 11) Default-OFF + config probe with a scrubbed env returns the
//     expected fallbacks.
step(11, "getAiClientConfig + getBatchAnalysisConfig default values via scrubbed env", () => {
  const probe = `
    process.env = {};
    (async () => {
      // Pure config modules — don't load the OpenAI SDK or the db layer.
      const ai = await import("../server/services/aiClientConfig.ts");
      const r = await import("../server/services/batchAnalysisConfig.ts");
      const cfg1 = ai.getAiClientConfig();
      const cfg2 = r.getBatchAnalysisConfig();
      if (cfg1.AI_TIMEOUT_MS !== 60000) throw new Error("AI_TIMEOUT_MS default must be 60000, got " + cfg1.AI_TIMEOUT_MS);
      if (cfg1.AI_MAX_RETRIES !== 3) throw new Error("AI_MAX_RETRIES default must be 3, got " + cfg1.AI_MAX_RETRIES);
      if (cfg2.BATCH_ANALYSIS_CONCURRENCY !== 2) throw new Error("BATCH_ANALYSIS_CONCURRENCY default must be 2, got " + cfg2.BATCH_ANALYSIS_CONCURRENCY);
      if (cfg2.JOB_STUCK_THRESHOLD_MS !== 900000) throw new Error("JOB_STUCK_THRESHOLD_MS default must be 900000, got " + cfg2.JOB_STUCK_THRESHOLD_MS);
      console.log("OK");
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const tmp = path.join(root, "tmp_recovery", "qualification-config-probe.mjs");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, probe);
  try { execSync(`npx tsx ${tmp}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
});

console.log("\nSummary\n---------------------------------");
const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
for (const r of results) counts[r.status] += 1;
console.log(`  PASS=${counts.PASS}  SKIP=${counts.SKIP}  FAIL=${counts.FAIL}  total=${results.length}`);

if (hadFailure) {
  console.error("\nQualification timeout hardening smoke FAILED");
  process.exit(1);
}
console.log("\nQualification timeout hardening smoke passed.");
