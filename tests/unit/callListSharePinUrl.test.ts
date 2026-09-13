// Regression tests for the FINAL security fix: a share PIN must NEVER travel in
// a URL/query string — only the x-share-pin request header. Also proves the
// audit payload can never carry the token or PIN. Pure + source-guard checks;
// no DB, no HTTP.
//
// Run: npx tsx tests/unit/callListSharePinUrl.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import {
  extractHeaderPin,
  buildShareAccessAudit,
  SHARE_PIN_HEADER,
} from "../../server/services/engagement/callListShareToken";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("callListSharePinUrl:");

  // ── PIN transport: header only, query never accepted ────────────────────────
  check("header PIN is read from x-share-pin", () => {
    assert.equal(SHARE_PIN_HEADER, "x-share-pin");
    assert.equal(extractHeaderPin({ "x-share-pin": "4821" }), "4821");
  });

  check("query-string PIN is NOT a source (extractor ignores everything but the header)", () => {
    // No header present → empty, regardless of any query the caller may have had.
    assert.equal(extractHeaderPin({}), "");
    assert.equal(extractHeaderPin(undefined), "");
    // A header-shaped object that only carries a (spoofed) query-like key yields "".
    assert.equal(extractHeaderPin({ pin: "4821" } as Record<string, unknown>), "");
    // Non-string header value → "".
    assert.equal(extractHeaderPin({ "x-share-pin": ["4821"] } as unknown as Record<string, unknown>), "");
  });

  await checkAsync("header PIN works; wrong header PIN fails (bcrypt)", async () => {
    const hash = await bcrypt.hash("4821", 12);
    const good = extractHeaderPin({ "x-share-pin": "4821" });
    const bad = extractHeaderPin({ "x-share-pin": "0000" });
    assert.equal(good.length > 0 && (await bcrypt.compare(good, hash)), true);
    assert.equal(bad.length > 0 && (await bcrypt.compare(bad, hash)), false);
  });

  // ── Audit payload never carries token or PIN ────────────────────────────────
  check("audit payload contains ONLY {result, ip, userAgent}", () => {
    const payload = buildShareAccessAudit("granted", "1.2.3.4", "UA/1.0");
    assert.deepEqual(Object.keys(payload).sort(), ["ip", "result", "userAgent"]);
  });

  check("audit payload has no pin/token FIELD and cannot smuggle a secret value", () => {
    // NB: the `result` label may legitimately be "pin_failed"/"pin_required" —
    // that is a status, not the secret. What matters: no dedicated pin/token
    // field, and the builder (which only accepts result/ip/userAgent) cannot
    // carry a secret PIN or bearer token value.
    const payload = buildShareAccessAudit("pin_failed", "1.2.3.4", "UA/1.0") as Record<string, unknown>;
    for (const k of ["pin", "sharePin", "sharePinHash", "token", "shareToken", "shareTokenHash"]) {
      assert.equal(k in payload, false, `no '${k}' field in audit payload`);
    }
    // A secret value passed as any legitimate field is never represented,
    // because those inputs don't exist on the builder's signature.
    const serialized = JSON.stringify(buildShareAccessAudit("granted", "9.9.9.9", "UA/1.0"));
    assert.equal(serialized.includes("4821"), false, "no PIN value in audit payload");
  });

  // ── Source guards: no PIN can appear in a URL anywhere ───────────────────────
  check("server PDF route does NOT read a PIN from the query string", () => {
    const src = readFileSync("server/routes/engagementCallListPackages.ts", "utf8");
    assert.equal(/req\.query\.pin/.test(src), false, "route must not read req.query.pin");
    assert.equal(/[?&]pin=/.test(src), false, "route must not construct a ?pin= URL");
    assert.ok(src.includes("extractHeaderPin"), "route must use header-only extractHeaderPin");
  });

  check("public share page never builds a PIN-bearing URL; uses the header", () => {
    const src = readFileSync("client/src/pages/shared-call-list.tsx", "utf8");
    assert.equal(/[?&]pin=/.test(src), false, "client must not build a ?pin= URL");
    assert.equal(/pin=\$\{/.test(src), false, "client must not interpolate pin into a URL");
    assert.ok(src.includes('"x-share-pin"'), "client must send the PIN via the x-share-pin header");
  });

  check("PIN is never persisted to web storage on the share page", () => {
    const src = readFileSync("client/src/pages/shared-call-list.tsx", "utf8");
    // Require method-access (a trailing dot) so a prose mention in a comment
    // ("...localStorage, sessionStorage...") is not a false positive — only an
    // actual API call is flagged.
    assert.equal(/localStorage\s*\./.test(src), false, "no localStorage usage");
    assert.equal(/sessionStorage\s*\./.test(src), false, "no sessionStorage usage");
    assert.equal(/indexedDB\s*\./i.test(src), false, "no indexedDB usage");
  });

  console.log(`\ncallListSharePinUrl: ${passed} checks passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
