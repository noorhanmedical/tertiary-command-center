import assert from "node:assert/strict";
import { createServer, request as createHttpRequest, type Server } from "node:http";
import express from "express";
import { errorHandler } from "../../server/middleware/errorHandler";
import {
  requestObservability,
  sendPublicOperationalResponse,
} from "../../server/middleware/requestObservability";
import {
  getLogSafeRouteTemplate,
  logPhiSafe,
} from "../../server/lib/phiSafeLogger";

const PATIENT_SENTINEL = "SENTINEL_PATIENT_JANE_DOE";
const CLINICAL_SENTINEL = "SENTINEL_DIAGNOSIS_CARDIOMYOPATHY";
const ERROR_SENTINEL = "SENTINEL_PROVIDER_SECRET_FAILURE";
const ROUTE_SENTINEL = "SentinelAlphabeticPatientSlug";
const CONCRETE_RECORD_ID = "867530912345";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CapturedLog = { level: "log" | "warn" | "error"; args: unknown[] };

async function main(): Promise<void> {
  const captured: CapturedLog[] = [];
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: unknown[]) => captured.push({ level: "log", args });
  console.warn = (...args: unknown[]) => captured.push({ level: "warn", args });
  console.error = (...args: unknown[]) => captured.push({ level: "error", args });

  let server: Server | undefined;
  try {
    // Runtime callers can bypass TypeScript with `any`; projection must still
    // remove undeclared fields, exception objects, and plain route strings.
    logPhiSafe({
      source: "http_request",
      operation: "api_request",
      method: "GET",
      route: `/api/patients/${ROUTE_SENTINEL}`,
      statusCode: 200,
      patientName: PATIENT_SENTINEL,
      diagnosis: CLINICAL_SENTINEL,
      message: ERROR_SENTINEL,
      error: new Error(ERROR_SENTINEL),
      metadata: { clinical: CLINICAL_SENTINEL },
      ownerId: Number(CONCRETE_RECORD_ID),
    } as any);

    // The branding symbol is module-private; a caller cannot forge a route
    // token even when bypassing TypeScript with an object and a lookalike symbol.
    logPhiSafe({
      source: "http_request",
      operation: "api_request",
      route: {
        value: `/api/patients/${ROUTE_SENTINEL}`,
        [Symbol("log-safe-route-template")]: true,
      },
    } as any);

    // Even the exported extractor cannot reveal a fabricated alphabetic path:
    // it emits only a process-local keyed token.
    logPhiSafe({
      source: "http_request",
      operation: "api_request",
      route: getLogSafeRouteTemplate({
        route: { path: `/api/patients/${ROUTE_SENTINEL}` },
      }),
    });

    const projectedLog = serializeLogs(captured);
    assert.doesNotMatch(projectedLog, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(projectedLog, new RegExp(CLINICAL_SENTINEL));
    assert.doesNotMatch(projectedLog, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(projectedLog, new RegExp(ROUTE_SENTINEL));
    assert.doesNotMatch(projectedLog, /patientName|diagnosis|message|metadata|ownerId/);
    assert.match(projectedLog, /api_request/);
    assertOpaqueRoute(projectedLog);

    captured.length = 0;
    const app = express();
    // Correlation and egress protection intentionally precede parsers.
    app.use(requestObservability);
    app.use(express.json());

    app.get("/api/patients/:id", (_req, res) => {
      res.json({
        name: PATIENT_SENTINEL,
        diagnosis: CLINICAL_SENTINEL,
      });
    });

    app.post("/api/json/:id", (_req, res) => {
      res.json({ ok: true });
    });

    app.get("/api/throw/:id", () => {
      throw new Error(`${ERROR_SENTINEL}:${PATIENT_SENTINEL}`);
    });

    app.get("/api/client-error/:id", () => {
      const error = new Error(`${ERROR_SENTINEL}:${PATIENT_SENTINEL}`) as Error & {
        status: number;
        code: string;
      };
      error.status = 418;
      error.code = ERROR_SENTINEL;
      throw error;
    });

    app.get("/api/legacy/:id", (_req, res) => {
      res.status(500).json({
        error: ERROR_SENTINEL,
        patient: PATIENT_SENTINEL,
        clinical: CLINICAL_SENTINEL,
      });
    });

    app.get("/api/unapproved-503/:id", (_req, res) => {
      res.status(503).json({ error: ERROR_SENTINEL, patient: PATIENT_SENTINEL });
    });

    app.get("/api/approved-501/:id", (_req, res) => {
      sendPublicOperationalResponse(res, "PORTAL_ASSISTANT_DISABLED");
    });

    app.get("/api/approved-503/:id", (_req, res) => {
      sendPublicOperationalResponse(res, "DATABASE_HEALTH_UNAVAILABLE");
    });

    app.get("/api/throw-server/:status", (req) => {
      const error = new Error(`${ERROR_SENTINEL}:${PATIENT_SENTINEL}`) as Error & { status: number };
      error.status = Number(req.params.status);
      throw error;
    });

    app.get("/api/validation/:id", (_req, res) => {
      res.status(400).json({
        error: "Known validation failure",
        code: "VALIDATION_FAILED",
        field: "name",
      });
    });

    app.get("/api/stream/:id", async (_req, res) => {
      res.setHeader("Content-Type", "text/plain");
      res.flushHeaders();
      await Promise.resolve();
      throw new Error(`${ERROR_SENTINEL}:${PATIENT_SENTINEL}`);
    });

    app.get("/api/disconnect/:id", (_req, res) => {
      res.setHeader("Content-Type", "text/plain");
      res.write("partial");
      const timer = setTimeout(() => {
        if (!res.destroyed) res.end("complete");
      }, 250);
      res.once("close", () => clearTimeout(timer));
    });

    app.use(errorHandler);

    server = createServer(app);
    await listen(server);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const success = await fetch(`${baseUrl}/api/patients/${CONCRETE_RECORD_ID}?search=${PATIENT_SENTINEL}`);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {
      name: PATIENT_SENTINEL,
      diagnosis: CLINICAL_SENTINEL,
    });
    assertRequestId(success);

    await flushCompletionListeners();
    const successLogs = serializeLogs(captured);
    assert.doesNotMatch(successLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(successLogs, new RegExp(CLINICAL_SENTINEL));
    assert.doesNotMatch(successLogs, new RegExp(CONCRETE_RECORD_ID));
    assertOpaqueRoute(successLogs);

    captured.length = 0;
    const mixedCase = await fetch(`${baseUrl}/API/legacy/${ROUTE_SENTINEL}`);
    const mixedCaseRequestId = assertRequestId(mixedCase);
    assert.equal(mixedCase.status, 500);
    assert.deepEqual(await mixedCase.json(), {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      requestId: mixedCaseRequestId,
    });
    await flushCompletionListeners();
    const mixedCaseLogs = serializeLogs(captured);
    assert.doesNotMatch(mixedCaseLogs, new RegExp(ROUTE_SENTINEL));
    assert.doesNotMatch(mixedCaseLogs, new RegExp(ERROR_SENTINEL));
    assertOpaqueRoute(mixedCaseLogs);

    captured.length = 0;
    const thrown = await fetch(`${baseUrl}/api/throw/${CONCRETE_RECORD_ID}`);
    const thrownRequestId = assertRequestId(thrown);
    assert.equal(thrown.status, 500);
    assert.deepEqual(await thrown.json(), {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      requestId: thrownRequestId,
    });

    await flushCompletionListeners();
    const thrownLogs = serializeLogs(captured);
    assert.doesNotMatch(thrownLogs, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(thrownLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(thrownLogs, new RegExp(CONCRETE_RECORD_ID));
    assert.match(thrownLogs, /internal_error/);
    assertOpaqueRoute(thrownLogs);

    captured.length = 0;
    const legacy = await fetch(`${baseUrl}/api/legacy/${CONCRETE_RECORD_ID}`);
    const legacyRequestId = assertRequestId(legacy);
    assert.equal(legacy.status, 500);
    assert.deepEqual(await legacy.json(), {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      requestId: legacyRequestId,
    });

    await flushCompletionListeners();
    const legacyLogs = serializeLogs(captured);
    assert.doesNotMatch(legacyLogs, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(legacyLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(legacyLogs, new RegExp(CLINICAL_SENTINEL));
    assert.doesNotMatch(legacyLogs, new RegExp(CONCRETE_RECORD_ID));

    captured.length = 0;
    const unapproved503 = await fetch(`${baseUrl}/api/unapproved-503/${CONCRETE_RECORD_ID}`);
    const unapproved503RequestId = assertRequestId(unapproved503);
    assert.equal(unapproved503.status, 503);
    assert.deepEqual(await unapproved503.json(), {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      requestId: unapproved503RequestId,
    });
    await flushCompletionListeners();
    const unapproved503Logs = serializeLogs(captured);
    assert.doesNotMatch(unapproved503Logs, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(unapproved503Logs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(unapproved503Logs, new RegExp(CONCRETE_RECORD_ID));

    captured.length = 0;
    const approved501 = await fetch(`${baseUrl}/api/approved-501/${CONCRETE_RECORD_ID}`);
    assert.equal(approved501.status, 501);
    assert.deepEqual(await approved501.json(), {
      error: "portal assistant feature disabled",
    });
    assertRequestId(approved501);
    await flushCompletionListeners();
    const approved501Logs = serializeLogs(captured);
    assert.doesNotMatch(approved501Logs, /portal assistant feature disabled/);
    assert.doesNotMatch(approved501Logs, new RegExp(CONCRETE_RECORD_ID));

    captured.length = 0;
    const approved503 = await fetch(`${baseUrl}/api/approved-503/${CONCRETE_RECORD_ID}`);
    assert.equal(approved503.status, 503);
    assert.deepEqual(await approved503.json(), { status: "error", db: false });
    assertRequestId(approved503);
    await flushCompletionListeners();
    const approved503Logs = serializeLogs(captured);
    assert.doesNotMatch(approved503Logs, /\"db\":false/);
    assert.doesNotMatch(approved503Logs, new RegExp(CONCRETE_RECORD_ID));

    for (const serverStatus of [501, 502, 503, 504]) {
      captured.length = 0;
      const serverError = await fetch(`${baseUrl}/api/throw-server/${serverStatus}`);
      const serverErrorRequestId = assertRequestId(serverError);
      assert.equal(serverError.status, serverStatus);
      assert.deepEqual(await serverError.json(), {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        requestId: serverErrorRequestId,
      });
      await flushCompletionListeners();
      const serverErrorLogs = serializeLogs(captured);
      assert.doesNotMatch(serverErrorLogs, new RegExp(ERROR_SENTINEL));
      assert.doesNotMatch(serverErrorLogs, new RegExp(PATIENT_SENTINEL));
      assertOpaqueRoute(serverErrorLogs);
    }

    captured.length = 0;
    const validation = await fetch(`${baseUrl}/api/validation/${CONCRETE_RECORD_ID}`);
    assert.equal(validation.status, 400);
    assert.deepEqual(await validation.json(), {
      error: "Known validation failure",
      code: "VALIDATION_FAILED",
      field: "name",
    });
    assertRequestId(validation);

    await flushCompletionListeners();
    const validationLogs = serializeLogs(captured);
    assert.doesNotMatch(validationLogs, /Known validation failure|VALIDATION_FAILED/);
    assert.doesNotMatch(validationLogs, new RegExp(CONCRETE_RECORD_ID));
    assertOpaqueRoute(validationLogs);

    captured.length = 0;
    const malformed = await fetch(`${baseUrl}/API/json/${ROUTE_SENTINEL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"name":"${PATIENT_SENTINEL}"`,
    });
    const malformedRequestId = assertRequestId(malformed);
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: "Bad Request",
      code: "BAD_REQUEST",
      requestId: malformedRequestId,
    });
    await flushCompletionListeners();
    const malformedLogs = serializeLogs(captured);
    assert.doesNotMatch(malformedLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(malformedLogs, new RegExp(ROUTE_SENTINEL));
    assert.match(malformedLogs, /"route":"unmatched"/);
    assert.ok(countOccurrences(malformedLogs, malformedRequestId) >= 2);

    captured.length = 0;
    const clientError = await fetch(`${baseUrl}/api/client-error/${CONCRETE_RECORD_ID}`);
    const clientErrorRequestId = assertRequestId(clientError);
    assert.equal(clientError.status, 418);
    assert.deepEqual(await clientError.json(), {
      error: "Request Failed",
      code: "CLIENT_ERROR",
      requestId: clientErrorRequestId,
    });
    await flushCompletionListeners();
    const clientErrorLogs = serializeLogs(captured);
    assert.doesNotMatch(clientErrorLogs, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(clientErrorLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(clientErrorLogs, new RegExp(CONCRETE_RECORD_ID));

    captured.length = 0;
    const streamResult = await fetch(`${baseUrl}/api/stream/${CONCRETE_RECORD_ID}`)
      .then(async (response) => {
        try {
          await response.text();
          return "clean_eof" as const;
        } catch {
          return "body_aborted" as const;
        }
      })
      .catch(() => "fetch_aborted" as const);
    assert.notEqual(streamResult, "clean_eof");
    await flushCompletionListeners();
    const streamLogs = serializeLogs(captured);
    assert.doesNotMatch(streamLogs, new RegExp(ERROR_SENTINEL));
    assert.doesNotMatch(streamLogs, new RegExp(PATIENT_SENTINEL));
    assert.doesNotMatch(streamLogs, new RegExp(CONCRETE_RECORD_ID));
    assert.match(streamLogs, /"outcome":"failed"/);
    assertOpaqueRoute(streamLogs);

    captured.length = 0;
    await abortAfterFirstChunk(`${baseUrl}/api/disconnect/${CONCRETE_RECORD_ID}`);
    await flushCompletionListeners();
    const disconnectLogs = serializeLogs(captured);
    assert.doesNotMatch(disconnectLogs, new RegExp(CONCRETE_RECORD_ID));
    assert.match(disconnectLogs, /"outcome":"failed"/);
    assert.match(disconnectLogs, /"category":"network_failure"/);
    assertOpaqueRoute(disconnectLogs);
  } finally {
    if (server) await close(server);
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  console.log("PHI-safe observability runtime tests passed.");
}

function assertRequestId(response: Response): string {
  const requestId = response.headers.get("x-request-id");
  assert.ok(requestId, "X-Request-Id should be present");
  assert.match(requestId, UUID_PATTERN);
  return requestId;
}

function serializeLogs(logs: CapturedLog[]): string {
  return logs
    .flatMap((entry) => entry.args)
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return "[unserializable]";
      }
    })
    .join("\n");
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function assertOpaqueRoute(logs: string): void {
  assert.match(logs, /"route":"route_[0-9a-f]{24}"/);
  assert.doesNotMatch(logs, /"route":"\/api/);
}

function abortAfterFirstChunk(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest(url, (response) => {
      response.once("data", () => {
        response.destroy();
        request.destroy();
        resolve();
      });
    });
    request.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") {
        resolve();
        return;
      }
      reject(error);
    });
    request.end();
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function flushCompletionListeners(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
