// Central PHI-safe structured logging.
//
// Log entries are projected at runtime onto an explicit allowlist. This is
// intentional defense in depth: TypeScript excess-property checks disappear at
// runtime and can be bypassed through `any`, JavaScript callers, or object
// spreading. Never add free-form request, response, provider, or exception data
// to this contract.

import { createHmac, randomBytes } from "node:crypto";

const SAFE_TAGS = [
  // Existing application event tags retained for compatibility.
  "engagement_assignment_board",
  "scheduler_portal",
  "plexus_tasks",
  "scheduler_auto_assign",
  "document_library",
  "document_complete_action",
  "auto_commit",
  "manual_commit",
  "screening_commit_hook",
  "ensure_canonical_spine",
  "ENGAGEMENT_TO_CALL_LIST_BRIDGE",
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  "operational-queue",
  "engagement-board",
  "patient-packet",
  // Central observability event tags.
  "http_request",
  "api_error",
  "readiness_check",
  "process_exception",
  "application_lifecycle",
  "process_watchdog",
  "ai_retry",
  "ai_operation",
  "batch_analysis",
  "clinical_import",
  // Outcomes.
  "disabled",
  "skipped",
  "created",
  "already_active",
  "ok",
  "failed",
  "validation_failed",
  "db_failed",
  "missing_row",
  "ready",
  "not_ready",
  "retrying",
  "suppressed",
  "started",
  "stopping",
  "closed",
  "timed_out",
  "exiting",
  "recovered",
  "partial",
] as const;

const SAFE_OPERATIONS = [
  "api_request",
  "database_readiness",
  "process",
  "http_server",
  "background_services",
  "websocket_upgrade",
  "database_pool",
  "openai_request",
  "screen_patient",
  "screen_selected_conditions",
  "parse_patient",
  "generate_note",
  "scheduler_assistant",
  "batch_analysis",
  "clinical_import",
  "excel_condition_match",
  "plain_text_parse",
  "cooldown_match",
  "reference_enrichment",
  "reference_import",
  "document_extraction",
  "test_analysis",
  "admin_review",
] as const;

const SAFE_ERROR_CATEGORIES = [
  "client_error",
  "internal_error",
  "database_unavailable",
  "websocket_race",
  "uncaught_exception",
  "shutdown_failure",
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "network_failure",
  "provider_error",
  "parse_failure",
  "validation_failure",
  "empty_response",
  "not_found",
  "transient_failure",
  "permanent_failure",
  "unknown_failure",
] as const;

const SAFE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "OTHER"] as const;
const SAFE_SIGNALS = ["SIGTERM", "SIGINT", "OTHER"] as const;

const routeTemplateBrand = Symbol("log-safe-route-template");
const routeTokenKey = randomBytes(32);
const routeTokenPattern = /^route_[0-9a-f]{24}$/;

export type LogSafeTag = (typeof SAFE_TAGS)[number];
export type LogSafeOperation = (typeof SAFE_OPERATIONS)[number];
export type LogSafeErrorCategory = (typeof SAFE_ERROR_CATEGORIES)[number];
export type LogSafeHttpMethod = (typeof SAFE_METHODS)[number];
export type LogSafeSignal = (typeof SAFE_SIGNALS)[number];
export type LogSafeRequestId = string & { readonly __logSafeRequestId: unique symbol };
export type LogSafeRouteTemplate = Readonly<{
  value: string;
  [routeTemplateBrand]: true;
}>;

/**
 * Allowed payload shape. Numeric values are metrics only; database or patient
 * record identifiers are deliberately excluded.
 */
export type LogSafePayload = {
  source: LogSafeTag;
  outcome?: LogSafeTag;
  operation?: LogSafeOperation;
  category?: LogSafeErrorCategory;
  requestId?: LogSafeRequestId;
  method?: LogSafeHttpMethod;
  route?: LogSafeRouteTemplate;
  signal?: LogSafeSignal;
  statusCode?: number;
  providerStatus?: number;
  durationMs?: number;
  attempt?: number;
  delayMs?: number;
  count?: number;
  legacyCount?: number;
  queueCount?: number;
  inLegacyOnly?: number;
  inQueueOnly?: number;
  total?: number;
  failed?: number;
  recoveredCount?: number;
  port?: number;
  parityMatch?: boolean;
  enabled?: boolean;
  cached?: boolean;
  retryable?: boolean;
};

type UnknownRecord = Record<string, unknown>;

const safeTags = new Set<string>(SAFE_TAGS);
const safeOperations = new Set<string>(SAFE_OPERATIONS);
const safeErrorCategories = new Set<string>(SAFE_ERROR_CATEGORIES);
const safeMethods = new Set<string>(SAFE_METHODS);
const safeSignals = new Set<string>(SAFE_SIGNALS);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toLogSafeRequestId(value: unknown): LogSafeRequestId | undefined {
  return typeof value === "string" && uuidPattern.test(value)
    ? (value as LogSafeRequestId)
    : undefined;
}

export function toLogSafeOperation(value: unknown): LogSafeOperation | undefined {
  return typeof value === "string" && safeOperations.has(value)
    ? (value as LogSafeOperation)
    : undefined;
}

/**
 * Convert an Express route definition into a process-local opaque token. Even
 * if a fabricated request object supplies a concrete alphabetic path, no path
 * segment can enter telemetry. Tokens remain stable for the process lifetime.
 */
export function getLogSafeRouteTemplate(req: { readonly route?: unknown }): LogSafeRouteTemplate {
  const routePath = isRecord(req.route) ? req.route.path : undefined;
  return createLogSafeRouteTemplate(routePath);
}

function createLogSafeRouteTemplate(value: unknown): LogSafeRouteTemplate {
  return Object.freeze({
    value: routeDefinitionToken(value),
    [routeTemplateBrand]: true as const,
  });
}

function routeDefinitionToken(value: unknown): string {
  if (value === "unmatched") return "unmatched";
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !value.startsWith("/")) {
    return "unmatched";
  }
  if (/[\s?#%]/.test(value) || !/^\/[A-Za-z0-9_./:{}*()\-]+$/.test(value)) {
    return "unmatched";
  }

  return `route_${createHmac("sha256", routeTokenKey).update(value).digest("hex").slice(0, 24)}`;
}

function readLogSafeRouteTemplate(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as {
    value?: unknown;
    [routeTemplateBrand]?: unknown;
  };
  if (candidate[routeTemplateBrand] !== true) return undefined;
  if (candidate.value === "unmatched") return "unmatched";
  return typeof candidate.value === "string" && routeTokenPattern.test(candidate.value)
    ? candidate.value
    : undefined;
}

export function toLogSafeHttpMethod(value: unknown): LogSafeHttpMethod {
  return typeof value === "string" && safeMethods.has(value.toUpperCase())
    ? (value.toUpperCase() as LogSafeHttpMethod)
    : "OTHER";
}

export function toLogSafeSignal(value: unknown): LogSafeSignal {
  return typeof value === "string" && safeSignals.has(value) ? (value as LogSafeSignal) : "OTHER";
}

/** Classify a domain-neutral exception without returning or logging its message. */
export function classifyLogSafeError(error: unknown): LogSafeErrorCategory {
  if (!isRecord(error)) return "unknown_failure";

  const status = typeof error.status === "number" ? error.status : undefined;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";

  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500 && status <= 599) return "internal_error";
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "EAI_AGAIN") {
    return "network_failure";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "unknown_failure";
}

/** Classify failures known to originate at an external provider boundary. */
export function classifyLogSafeProviderError(error: unknown): LogSafeErrorCategory {
  if (!isRecord(error)) return "provider_error";

  const status = typeof error.status === "number" ? error.status : undefined;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";

  if (status === 429) return "rate_limited";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "provider_unavailable";
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "EAI_AGAIN") {
    return "network_failure";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "provider_error";
}

export function logPhiSafe(payload: LogSafePayload): void {
  emit("info", payload);
}

export function warnPhiSafe(payload: LogSafePayload): void {
  emit("warn", payload);
}

export function errorPhiSafe(payload: LogSafePayload): void {
  emit("error", payload);
}

function emit(level: "info" | "warn" | "error", payload: LogSafePayload): void {
  const projected = projectPayload(payload as unknown);
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer("[phi-safe]", projected);
}

function projectPayload(value: unknown): UnknownRecord {
  const input = isRecord(value) ? value : {};
  const output: UnknownRecord = {
    source: typeof input.source === "string" && safeTags.has(input.source)
      ? input.source
      : "process_exception",
  };

  copyEnum(input, output, "outcome", safeTags);
  copyEnum(input, output, "operation", safeOperations);
  copyEnum(input, output, "category", safeErrorCategories);
  copyEnum(input, output, "method", safeMethods);
  copyEnum(input, output, "signal", safeSignals);

  const requestId = toLogSafeRequestId(input.requestId);
  if (requestId) output.requestId = requestId;

  const route = readLogSafeRouteTemplate(input.route);
  if (route) output.route = route;

  copyNumber(input, output, "statusCode", 100, 599);
  copyNumber(input, output, "providerStatus", 100, 599);
  copyNumber(input, output, "durationMs", 0);
  copyNumber(input, output, "attempt", 0);
  copyNumber(input, output, "delayMs", 0);
  copyNumber(input, output, "count", 0);
  copyNumber(input, output, "legacyCount", 0);
  copyNumber(input, output, "queueCount", 0);
  copyNumber(input, output, "inLegacyOnly", 0);
  copyNumber(input, output, "inQueueOnly", 0);
  copyNumber(input, output, "total", 0);
  copyNumber(input, output, "failed", 0);
  copyNumber(input, output, "recoveredCount", 0);
  copyNumber(input, output, "port", 1, 65_535);

  copyBoolean(input, output, "parityMatch");
  copyBoolean(input, output, "enabled");
  copyBoolean(input, output, "cached");
  copyBoolean(input, output, "retryable");

  return output;
}

function copyEnum(input: UnknownRecord, output: UnknownRecord, key: string, allowed: ReadonlySet<string>): void {
  const value = input[key];
  if (typeof value === "string" && allowed.has(value)) output[key] = value;
}

function copyNumber(
  input: UnknownRecord,
  output: UnknownRecord,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum) {
    output[key] = value;
  }
}

function copyBoolean(input: UnknownRecord, output: UnknownRecord, key: string): void {
  if (typeof input[key] === "boolean") output[key] = input[key];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
