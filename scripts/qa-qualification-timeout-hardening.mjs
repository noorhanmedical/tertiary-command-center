// QA: qualification timeout hardening (hotfix).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — aiClient.ts has AbortController + env-controlled timeout/retries.
const AI = read("server/services/aiClient.ts") ?? "";
for (const n of [
  "AbortController",
  "AI_TIMEOUT_MS",
  "AI_MAX_RETRIES",
  "withAbortableTimeout",
  "controller.abort",
  "getAiClientConfig",
  'err?.code === "AI_TIMEOUT"',
]) if (!AI.includes(n)) failures.push(`aiClient.ts missing "${n}"`);
// Hard guard: no model swap.
if (!/openai\.chat\.completions\.create/.test(read("server/services/screening.ts") ?? "")) {
  failures.push("screening.ts must still call openai.chat.completions.create");
}
{
  const sc = read("server/services/screening.ts") ?? "";
  if (!sc.includes('model: "gpt-4o"')) failures.push('screening.ts model "gpt-4o" must not be downgraded');
  if (!sc.includes("response_format: { type: \"json_object\" }")) failures.push("screening.ts JSON response_format must stay");
  if (!sc.includes("max_completion_tokens: 16000")) failures.push("screening.ts max_completion_tokens 16000 must stay");
  // AbortSignal is forwarded.
  if (!sc.includes("{ signal }")) failures.push("screening.ts must forward AbortSignal to openai.chat.completions.create");
}

// §2 — batchAnalysisRunner exposes startBatchAnalysis(restrictToPatientIds)
//      + recoverStuckAnalysisJobs + lowered default concurrency.
const RN = read("server/services/batchAnalysisRunner.ts") ?? "";
for (const n of [
  "restrictToPatientIds",
  "recoverStuckAnalysisJobs",
  "getBatchAnalysisConfig",
  "JOB_STUCK_THRESHOLD_MS",
  "RecoveredStuckJob",
  "StartBatchAnalysisOptions",
  // The lowered default lives in the pure config module.
  "DEFAULT_BATCH_ANALYSIS_CONCURRENCY",
]) if (!RN.includes(n)) failures.push(`batchAnalysisRunner.ts missing "${n}"`);

// Pure default lives in the config module.
const CFG = read("server/services/batchAnalysisConfig.ts") ?? "";
if (!CFG.includes("BATCH_ANALYSIS_CONCURRENCY_DEFAULT = 2")) {
  failures.push("batchAnalysisConfig.ts: BATCH_ANALYSIS_CONCURRENCY_DEFAULT must be 2");
}
const AICFG = read("server/services/aiClientConfig.ts") ?? "";
if (!AICFG.includes("AI_TIMEOUT_MS_DEFAULT = 60_000")) {
  failures.push("aiClientConfig.ts: AI_TIMEOUT_MS_DEFAULT must be 60_000");
}
if (!AICFG.includes("AI_MAX_RETRIES_DEFAULT = 3")) {
  failures.push("aiClientConfig.ts: AI_MAX_RETRIES_DEFAULT must be 3");
}

// §3 — Routes:
//   - /api/batches/:id/analyze delegates to startBatchAnalysis (no
//     duplicate inline logic)
//   - /api/patients/:id/analyze-async exists
//   - /api/plexus-iq/qualification-jobs/recover-stuck exists
//   - /api/plexus-iq/qualification-config exists
const BR = read("server/routes/batches.ts") ?? "";
if (!BR.includes("startBatchAnalysis(")) failures.push("batches.ts route must delegate to startBatchAnalysis(...)");
if (/await batchProcess\(/.test(BR)) failures.push("batches.ts must not call batchProcess directly — runner owns it");

const PR = read("server/routes/patients.ts") ?? "";
if (!PR.includes('"/api/patients/:id/analyze-async"')) failures.push("patients.ts /api/patients/:id/analyze-async missing");
if (!PR.includes("restrictToPatientIds: [id]")) failures.push("patients.ts async route must restrict to the single patient");

const PI = read("server/routes/plexusIqClinicalImport.ts") ?? "";
for (const n of [
  '"/api/plexus-iq/qualification-jobs/recover-stuck"',
  '"/api/plexus-iq/qualification-config"',
  "recoverStuckAnalysisJobs",
  "getAiClientConfig",
  "getBatchAnalysisConfig",
]) if (!PI.includes(n)) failures.push(`plexusIqClinicalImport.ts missing "${n}"`);

// §4 — Client hook is wired.
const HK = read("client/src/hooks/api/screening-batches.ts") ?? "";
for (const n of [
  "useAnalyzePatientAsync",
  "/analyze-async",
  "AnalyzePatientAsyncResult",
]) if (!HK.includes(n)) failures.push(`screening-batches.ts missing "${n}"`);

const POLL = read("client/src/hooks/api/useQualificationJobStatus.ts") ?? "";
for (const n of [
  "useQualificationJobStatus",
  "reconnecting",
  "consecutiveFailures",
  "/api/plexus-iq/qualification-jobs/",
  "/status",
  "maxBackoffMs",
]) if (!POLL.includes(n)) failures.push(`useQualificationJobStatus missing "${n}"`);

// §5 — Plexus IQ page uses the async path, not the legacy sync mutation.
const PG = read("client/src/pages/plexus-iq.tsx") ?? "";
if (!PG.includes("useAnalyzePatientAsync")) failures.push("plexus-iq page must import useAnalyzePatientAsync");
if (!PG.includes("analyzePatientAsyncMut.mutateAsync")) failures.push("plexus-iq handleAnalyzePatient must call the async mutation");

// §6 — Docs present.
const D = read("docs/architecture/qualification-timeout-hardening.md") ?? "";
for (const n of [
  "Qualification timeout hardening",
  "Old failure mode",
  "New durable flow",
  "Env vars",
  "Stuck-job behavior",
  "Model preservation",
]) if (!D.includes(n)) failures.push(`doc missing "${n}"`);

if (failures.length > 0) {
  console.error("Qualification timeout hardening QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Qualification timeout hardening QA passed.");
