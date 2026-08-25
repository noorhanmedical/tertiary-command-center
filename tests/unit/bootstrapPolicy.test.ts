import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADMIN_BOOTSTRAP_REQUIRED_CODE,
  AdminBootstrapRequiredError,
  assertAdminBootstrapReady,
} from "../../server/auth/bootstrapPolicy";
import { runStartupBoundary } from "../../server/startupBoundary";

const DATABASE_ERROR_SENTINEL = "SENTINEL_DATABASE_DIAGNOSTIC_WITH_SECRET";

async function captureBootstrapRequired(
  action: () => Promise<void>,
): Promise<AdminBootstrapRequiredError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AdminBootstrapRequiredError);
  assert.equal(caught.name, "AdminBootstrapRequiredError");
  assert.equal(caught.code, ADMIN_BOOTSTRAP_REQUIRED_CODE);
  assert.equal(caught.message, ADMIN_BOOTSTRAP_REQUIRED_CODE);
  assert.equal(caught.cause, undefined);
  return caught;
}

async function testBootstrapPolicy(): Promise<void> {
  let successfulReads = 0;
  await assertAdminBootstrapReady(async () => {
    successfulReads += 1;
    return 1;
  });
  assert.equal(successfulReads, 1, "existing-user startup should read the count once");

  for (const invalidCount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    await captureBootstrapRequired(() => assertAdminBootstrapReady(async () => invalidCount));
  }

  const readFailure = await captureBootstrapRequired(() =>
    assertAdminBootstrapReady(async () => {
      throw new Error(DATABASE_ERROR_SENTINEL);
    }),
  );
  assert.doesNotMatch(readFailure.message, new RegExp(DATABASE_ERROR_SENTINEL));
  assert.doesNotMatch(String(readFailure), new RegExp(DATABASE_ERROR_SENTINEL));

  let concurrentReads = 0;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      assertAdminBootstrapReady(async () => {
        concurrentReads += 1;
        return 2;
      }),
    ),
  );
  assert.equal(concurrentReads, 4, "concurrent policy checks should remain read-only");
}

async function testStartupBoundary(): Promise<void> {
  const successEvents: string[] = [];
  const successResult = await runStartupBoundary({
    initialize: async () => {
      successEvents.push("initialize");
    },
    listen: () => {
      successEvents.push("listen");
      successEvents.push("background");
    },
    writeFatalSignal: (signal) => {
      successEvents.push(`signal:${signal}`);
    },
    exit: (statusCode) => {
      successEvents.push(`exit:${statusCode}`);
    },
  });
  assert.equal(successResult, "started");
  assert.deepEqual(successEvents, ["initialize", "listen", "background"]);

  const failureEvents: string[] = [];
  const failureResult = await runStartupBoundary({
    initialize: async () => {
      throw new AdminBootstrapRequiredError();
    },
    listen: () => {
      failureEvents.push("listen");
      failureEvents.push("background");
    },
    writeFatalSignal: (signal) => {
      failureEvents.push(`signal:${signal}`);
    },
    exit: (statusCode) => {
      failureEvents.push(`exit:${statusCode}`);
    },
  });
  assert.equal(failureResult, "bootstrap_required");
  assert.deepEqual(failureEvents, [
    `signal:${ADMIN_BOOTSTRAP_REQUIRED_CODE}`,
    "exit:1",
  ]);

  const unknownFailure = new Error("SENTINEL_UNKNOWN_STARTUP_FAILURE");
  const unknownEvents: string[] = [];
  await assert.rejects(
    () =>
      runStartupBoundary({
        initialize: async () => {
          throw unknownFailure;
        },
        listen: () => {
          unknownEvents.push("listen");
        },
        writeFatalSignal: () => {
          unknownEvents.push("signal");
        },
        exit: () => {
          unknownEvents.push("exit");
        },
      }),
    (error: unknown) => error === unknownFailure,
  );
  assert.deepEqual(unknownEvents, []);
}

function testProcessBoundary(): void {
  const childScript = [
    'import { writeSync } from "node:fs";',
    'import { assertAdminBootstrapReady } from "./server/auth/bootstrapPolicy.ts";',
    'import { runStartupBoundary } from "./server/startupBoundary.ts";',
    "await runStartupBoundary({",
    "  initialize: async () => {",
    "    await assertAdminBootstrapReady(async () => {",
    `      throw new Error("${DATABASE_ERROR_SENTINEL}");`,
    "    });",
    "  },",
    '  listen: () => writeSync(2, "LISTENER_OR_BACKGROUND_STARTED\\n"),',
    '  writeFatalSignal: (signal) => writeSync(2, signal + "\\n"),',
    "  exit: (statusCode) => process.exit(statusCode),",
    "});",
  ].join("\n");

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", childScript],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    },
  );

  if (child.error) throw child.error;
  assert.equal(child.signal, null);
  assert.equal(child.status, 1, "bootstrap-required startup should exit non-zero");
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, `${ADMIN_BOOTSTRAP_REQUIRED_CODE}\n`);
  assert.doesNotMatch(child.stderr, new RegExp(DATABASE_ERROR_SENTINEL));
  assert.doesNotMatch(child.stderr, /LISTENER_OR_BACKGROUND_STARTED|AdminBootstrapRequiredError|\.ts:\d+/);
}

function testSourceContracts(): void {
  const routesSource = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
  const indexSource = readFileSync(resolve(process.cwd(), "server/index.ts"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

  assert.doesNotMatch(routesSource, /password:\s*["']admin["']/i);
  assert.doesNotMatch(routesSource, /Created default admin\/admin account/i);
  assert.doesNotMatch(routesSource, /First-boot seed:\s*create admin\/admin/i);
  assert.doesNotMatch(appSource, /admin\/admin/i);

  const registerRoutesIndex = routesSource.indexOf("export async function registerRoutes");
  const bootstrapGuardIndex = routesSource.indexOf(
    "await assertAdminBootstrapReady(() => storage.getUserCount());",
    registerRoutesIndex,
  );
  const firstStartupMutationIndex = routesSource.indexOf(
    "await storage.getAllScreeningBatches();",
    registerRoutesIndex,
  );
  const userManagementIndex = routesSource.indexOf(
    "// ─── User management (admin-only)",
    registerRoutesIndex,
  );

  assert.ok(registerRoutesIndex >= 0, "registerRoutes declaration should exist");
  assert.ok(bootstrapGuardIndex > registerRoutesIndex, "bootstrap guard should run inside registerRoutes");
  assert.ok(
    firstStartupMutationIndex > bootstrapGuardIndex,
    "bootstrap guard should run before startup recovery mutations",
  );
  assert.ok(userManagementIndex > bootstrapGuardIndex, "user-management routes should follow the guard");
  assert.doesNotMatch(
    routesSource.slice(registerRoutesIndex, userManagementIndex),
    /storage\.createUser\s*\(/,
    "startup and route registration must not create credentials",
  );

  const startupBoundaryIndex = indexSource.indexOf("await runStartupBoundary({");
  const registerCallIndex = indexSource.indexOf("await registerRoutes(httpServer, app);");
  const listenIndex = indexSource.indexOf("httpServer.listen(");
  const bootstrapReturnIndex = indexSource.indexOf(
    'if (startupResult !== "started") return;',
  );
  assert.ok(startupBoundaryIndex >= 0, "server startup should use the explicit boundary");
  assert.ok(registerCallIndex > startupBoundaryIndex, "route registration should run inside initialization");
  assert.ok(listenIndex > registerCallIndex, "HTTP listen should follow successful initialization");
  assert.ok(bootstrapReturnIndex > listenIndex, "failed startup should return before lifecycle wiring");
  assert.match(indexSource, /writeSync\(process\.stderr\.fd, `\$\{signal\}\\n`\)/);
}

async function main(): Promise<void> {
  await testBootstrapPolicy();
  await testStartupBoundary();
  testProcessBoundary();
  testSourceContracts();
  console.log("bootstrapPolicy.test.ts: all tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
