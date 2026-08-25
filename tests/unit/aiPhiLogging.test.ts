import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyLogSafeError,
  classifyLogSafeProviderError,
} from "../../server/lib/phiSafeLogger";
import {
  classifyMicroBatchFailureReason,
  normalizeAiOperation,
} from "../../server/lib/aiObservability";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function sourceSection(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source section start: ${start}`);
  assert.ok(endIndex > startIndex, `missing source section end: ${end}`);
  return value.slice(startIndex, endIndex);
}

for (const operation of [
  "openai_request",
  "screen_patient",
  "test_analysis",
  "generate_note",
  "screen_selected_conditions",
  "parse_patient",
  "scheduler_assistant",
  "excel_condition_match",
  "plain_text_parse",
] as const) {
  assert.equal(normalizeAiOperation(operation), operation);
}
assert.equal(normalizeAiOperation("AI call"), "openai_request");
assert.equal(normalizeAiOperation("scheduler-ai"), "scheduler_assistant");
assert.equal(normalizeAiOperation("ocr-name"), "document_extraction");
assert.equal(normalizeAiOperation("SENTINEL_PATIENT_DYNAMIC_LABEL"), "openai_request");

assert.equal(classifyMicroBatchFailureReason("request_timeout"), "timeout");
assert.equal(classifyMicroBatchFailureReason("provider_failure"), "provider_error");
for (const reason of [
  "response_truncated",
  "invalid_response",
  "response_count_mismatch",
  "response_index_mismatch",
]) {
  assert.equal(classifyMicroBatchFailureReason(reason), "parse_failure");
}
assert.equal(classifyMicroBatchFailureReason("SENTINEL_UNKNOWN_REASON"), "unknown_failure");

assert.equal(classifyLogSafeError(new Error("database constraint")), "unknown_failure");
assert.equal(classifyLogSafeError({ status: 500, message: "local failure" }), "internal_error");
assert.equal(classifyLogSafeProviderError(new Error("provider rejected request")), "provider_error");
assert.equal(classifyLogSafeProviderError({ status: 503 }), "provider_unavailable");

const aiClient = source("server/services/aiClient.ts");
assert.doesNotMatch(aiClient, /console\.(log|warn|error)/);
assert.doesNotMatch(aiClient, /\[\$\{label\}\]/);
assert.doesNotMatch(aiClient, /err(or)?\.message[^\n]*retrying/i);
assert.match(aiClient, /warnPhiSafe/);
assert.match(aiClient, /normalizeAiOperation/);

const screening = source("server/services/screening.ts");
assert.doesNotMatch(screening, /console\.(log|warn|error)/);
assert.doesNotMatch(screening, /screenPatient:\$\{patient\.name\}/);
assert.doesNotMatch(screening, /content\.substring\(0,\s*300\)/);
assert.match(screening, /"screen_patient"/);

const schedulerAi = source("server/routes/schedulerAi.ts");
assert.doesNotMatch(schedulerAi, /console\.(log|warn|error)/);
assert.doesNotMatch(schedulerAi, /err\?\.message|err\.message/);
assert.doesNotMatch(schedulerAi, /JSON\.stringify\(\{\s*error:\s*err/);
assert.match(schedulerAi, /AI_REQUEST_FAILED/);
assert.match(schedulerAi, /requestId/);

const noteGeneration = source("server/services/noteGenerationServer.ts");
assert.doesNotMatch(noteGeneration, /console\.(log|warn|error)/);
assert.doesNotMatch(noteGeneration, /\.message\s*\)/);
assert.match(noteGeneration, /warnPhiSafe/);

const microBatch = source("server/services/plexusIqAiBatch.ts");
assert.doesNotMatch(microBatch, /err instanceof Error|String\(err\)|err\.message/);
assert.match(microBatch, /MicroBatchFailureReason/);
assert.match(microBatch, /provider_failure/);

const batchRunner = source("server/services/batchAnalysisRunner.ts");
assert.doesNotMatch(batchRunner, /console\.(log|warn|error)/);
assert.doesNotMatch(batchRunner, /NODE_ENV|\bisDev\b/);
assert.doesNotMatch(batchRunner, /patient\.id[^\n]*patient\.name|patient\.name[^\n]*patient\.id/);
assert.doesNotMatch(batchRunner, /errorMessage:\s*(err|error)|reason:\s*(err|error)/);
assert.match(batchRunner, /SAFE_ANALYSIS_FAILURE_REASONS/);
assert.match(batchRunner, /errorMessage: "Analysis job failed"/);

const legacyBatchRoutes = source("server/routes/batches.ts");
assert.doesNotMatch(legacyBatchRoutes, /Failed to analyze patient/);
assert.doesNotMatch(legacyBatchRoutes, /job\.errorMessage\s*\?\?/);
assert.match(legacyBatchRoutes, /job\.status === "failed" \? "Analysis job failed" : null/);

const clinicalImportRoutes = source("server/routes/plexusIqClinicalImport.ts");
assert.doesNotMatch(clinicalImportRoutes, /console\.(log|warn|error)/);
assert.doesNotMatch(clinicalImportRoutes, /job\.errorMessage\s*\?\?/);
assert.doesNotMatch(clinicalImportRoutes, /failure\?\.reason|analysisErr\?\.message/);
assert.match(clinicalImportRoutes, /publicAnalysisFailureReason/);

const adminRoutes = source("server/routes/admin.ts");
assert.doesNotMatch(adminRoutes, /res\.json\(jobs\)/);
assert.doesNotMatch(adminRoutes, /job\.errorMessage/);
assert.match(adminRoutes, /errorMessage: job\.status === "failed"/);

const patientRoutes = source("server/routes/patients.ts");
for (const forbidden of [
  "AI screening failed for patient",
  "AI analyze-test failed for",
  "[ai-select-conditions] Failed to parse AI response:",
  "[parse-patient-paste] Failed to parse AI response:",
]) {
  assert.ok(!patientRoutes.includes(forbidden), `patient routes must not contain ${forbidden}`);
}
const adminReviewRoutes = sourceSection(
  patientRoutes,
  "admin-review/evidence",
  "// Sets the admin approval state",
);
assert.doesNotMatch(adminReviewRoutes, /console\.(log|warn|error)/);
assert.doesNotMatch(adminReviewRoutes, /error\?\.message|error\.message|String\(error/);
assert.doesNotMatch(adminReviewRoutes, /hasAIIntegrationsKey|hasOpenAIKey|hasBaseUrl|patientId:\s*id/);
assert.match(adminReviewRoutes, /sendAdminReviewFailure/);

const googleRoutes = source("server/routes/google.ts");
const ocrRoute = sourceSection(
  googleRoutes,
  'app.post("/api/documents/ocr-name"',
  'app.post("/api/documents/upload"',
);
assert.doesNotMatch(ocrRoute, /console\.(log|warn|error)|error\.message|String\(error/);
assert.match(ocrRoute, /operation: "document_extraction"/);
assert.match(ocrRoute, /classifyLogSafeProviderError/);

const adminReviewAdd = source("server/services/plexusIq/adminReviewAddService.ts");
assert.doesNotMatch(adminReviewAdd, /console\.(log|warn|error)|err\?\.message|String\(err/);
assert.match(adminReviewAdd, /operation: "admin_review"/);

const adminReviewIcdService = source("server/services/plexusIq/adminReviewIcdSearchService.ts");
assert.doesNotMatch(adminReviewIcdService, /console\.(log|warn|error)/);

for (const relativePath of [
  "server/parsers/plainText.ts",
  "server/parsers/excel.ts",
  "server/parsers/csv.ts",
  "server/services/absenceWatcher.ts",
]) {
  assert.doesNotMatch(source(relativePath), /console\.(log|warn|error)/, `${relativePath} must use PHI-safe logging`);
}

console.log("AI PHI-safe logging source-contract tests passed.");
