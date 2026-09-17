// AI PHI egress gate + login brute-force throttle regression tests.
// Pure/unit — no DB. Run: npx tsx tests/unit/aiPhiGateAndLoginThrottle.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (name: string, fn: () => void | Promise<void>) => {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => console.log(`ok  ${name}`),
        (e) => { failures++; console.error(`FAIL  ${name}: ${(e as Error).message}`); },
      );
    }
    console.log(`ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${(e as Error).message}`);
  }
};

async function main() {
  // ── AI PHI gate ────────────────────────────────────────────────────────────
  const { isAiPhiAllowed, assertAiPhiAllowed, AiPhiBlockedError } = await import(
    "../../server/lib/aiPhiPolicy"
  );

  await check("default (unset) → AI PHI allowed (preserves current behavior)", () => {
    delete process.env.AI_PHI_ALLOWED;
    assert.equal(isAiPhiAllowed(), true);
    assert.doesNotThrow(() => assertAiPhiAllowed("test"));
  });

  await check("AI_PHI_ALLOWED=false → blocked, throws AiPhiBlockedError", () => {
    process.env.AI_PHI_ALLOWED = "false";
    assert.equal(isAiPhiAllowed(), false);
    assert.throws(() => assertAiPhiAllowed("qualification"), (e: unknown) => {
      assert.ok(e instanceof AiPhiBlockedError);
      assert.equal((e as any).code, "AI_PHI_NOT_APPROVED");
      return true;
    });
    delete process.env.AI_PHI_ALLOWED;
  });

  await check("off/0/no also block", () => {
    for (const v of ["off", "0", "no", "OFF"]) {
      process.env.AI_PHI_ALLOWED = v;
      assert.equal(isAiPhiAllowed(), false, `value ${v}`);
    }
    delete process.env.AI_PHI_ALLOWED;
  });

  await check("gate is wired into the AI call chokepoint (withRetry)", () => {
    const src = readFileSync(join(ROOT, "server/services/aiClient.ts"), "utf8");
    assert.ok(src.includes("assertAiPhiAllowed"), "withRetry calls the gate");
  });

  await check("AI gate never logs prompt content (code, ignoring comments)", () => {
    const raw = readFileSync(join(ROOT, "server/lib/aiPhiPolicy.ts"), "utf8");
    // Strip line + block comments so we only inspect executable code.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/prompt|messages|\.content/i.test(code), "policy code never references prompt content");
  });

  await check("aiClient retry log is structural (no err.message)", () => {
    const src = readFileSync(join(ROOT, "server/services/aiClient.ts"), "utf8");
    assert.ok(!/console\.warn\(`\[\$\{label\}\][^`]*\$\{err\.message\}/.test(src), "no err.message in retry log");
    assert.ok(src.includes('source: "ai_client"'), "structural retry log");
  });

  // ── Login throttle ──────────────────────────────────────────────────────────
  const { loginRateLimit, noteLoginResult, _loginThrottleState } = await import(
    "../../server/middleware/loginRateLimit"
  );

  function fakeReqRes(ip: string) {
    let statusCode = 0;
    let body: any = null;
    const headers: Record<string, string> = {};
    const req: any = { ip, socket: { remoteAddress: ip } };
    const res: any = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      status: (c: number) => { statusCode = c; return res; },
      json: (b: any) => { body = b; return res; },
    };
    return { req, res, get: () => ({ statusCode, body, headers }) };
  }

  await check("throttle engages after repeated failures, then blocks with 429 + Retry-After", () => {
    const ip = "10.0.0.99";
    // 8 failures trip the throttle.
    for (let i = 0; i < 8; i++) noteLoginResult({ ip, socket: { remoteAddress: ip } } as any, false);
    const st = _loginThrottleState(ip);
    assert.ok(st && st.blockedUntil > Date.now(), "throttle engaged (time-bound block set)");
    // Next attempt is blocked.
    const { req, res, get } = fakeReqRes(ip);
    let nextCalled = false;
    loginRateLimit(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, "blocked request does not reach handler");
    assert.equal(get().statusCode, 429);
    assert.ok(get().headers["Retry-After"], "Retry-After present");
    assert.ok(!/exist|account|user/i.test(String(get().body?.error)), "generic message, no enumeration");
  });

  await check("successful login clears the counter (no permanent lockout)", () => {
    const ip = "10.0.0.100";
    for (let i = 0; i < 5; i++) noteLoginResult({ ip, socket: { remoteAddress: ip } } as any, false);
    noteLoginResult({ ip, socket: { remoteAddress: ip } } as any, true); // success clears
    assert.equal(_loginThrottleState(ip), undefined, "counter cleared on success");
    // A fresh request passes through.
    const { req, res, get } = fakeReqRes(ip);
    let nextCalled = false;
    loginRateLimit(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "not blocked after success");
    assert.equal(get().statusCode, 0);
  });

  await check("throttle keyed by client (IP), not by account identifier", () => {
    const src = readFileSync(join(ROOT, "server/middleware/loginRateLimit.ts"), "utf8");
    assert.ok(src.includes("req.ip"), "keys on client IP");
    assert.ok(!/username|identifier|email/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), "does not key on account identity (no enumeration)");
  });

  if (failures > 0) {
    console.error(`\naiPhiGateAndLoginThrottle.test.ts: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log(`\naiPhiGateAndLoginThrottle.test.ts: all tests passed`);
}

main();
