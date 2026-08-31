import {
  toLogSafeOperation,
  type LogSafeErrorCategory,
  type LogSafeOperation,
} from "./phiSafeLogger";

const LEGACY_OPERATION_MAP: Readonly<Record<string, LogSafeOperation>> = {
  "AI call": "openai_request",
  checkCooldowns: "cooldown_match",
  enrichFromReferenceDb: "reference_enrichment",
  parseReferenceImport: "reference_import",
  extractPdfPatients: "document_extraction",
  extractImagePatients: "document_extraction",
  generateJustification: "generate_note",
  noteGen_justification: "generate_note",
  aiSelectConditions: "screen_selected_conditions",
  parsePatientPaste: "parse_patient",
  "scheduler-ai": "scheduler_assistant",
  "ocr-name": "document_extraction",
};

/** Preserve canonical operation labels while safely mapping legacy call sites. */
export function normalizeAiOperation(label: unknown): LogSafeOperation {
  return toLogSafeOperation(label) ??
    (typeof label === "string" ? LEGACY_OPERATION_MAP[label] : undefined) ??
    "openai_request";
}

/** Convert bounded micro-batch failure reasons into accurate safe telemetry. */
export function classifyMicroBatchFailureReason(reason: unknown): LogSafeErrorCategory {
  if (reason === "request_timeout") return "timeout";
  if (reason === "provider_failure") return "provider_error";
  if (
    reason === "response_truncated" ||
    reason === "invalid_response" ||
    reason === "response_count_mismatch" ||
    reason === "response_index_mismatch"
  ) {
    return "parse_failure";
  }
  return "unknown_failure";
}
