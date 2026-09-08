// Phase 6 — provider CAPABILITY model (pure).
//
// The Team Portal calling UX branches on CAPABILITIES, never on a provider
// name. These checks lock the capability ceiling per provider, the
// capability→mode derivation, and the telephony-state ordering invariants the
// idempotent session service relies on.
//
//   §1  manual has NO telephony capabilities (mode = manual).
//   §2  doximity is external-assisted (launch ONLY; nothing fabricated).
//   §3  ringcentral is the integrated ceiling (initiate + observe + verify + …).
//   §4  providerModeFromCapabilities maps correctly.
//   §5  terminal states are terminal; non-terminal are not.
//   §6  state RANK is monotonic: initiated < proceeding < connected <= terminal.
//   §7  every selectable provider has a capability entry.
//
// Run: npx tsx tests/unit/telephonyCapabilities.test.ts

import assert from "node:assert";
import {
  SELECTABLE_PHONE_PROVIDER_IDS,
  PHONE_PROVIDER_CAPABILITIES,
  capabilitiesFor,
  providerModeFromCapabilities,
  isTerminalTelephonyState,
  TELEPHONY_STATE_RANK,
  TELEPHONY_SESSION_STATES,
  NO_PHONE_PROVIDER_CAPABILITIES,
} from "../../shared/phoneProvider";

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

check("§1 manual has no telephony capabilities (mode manual)", () => {
  const c = capabilitiesFor("manual");
  assert.deepStrictEqual(c, NO_PHONE_PROVIDER_CAPABILITIES);
  assert.strictEqual(providerModeFromCapabilities(c), "manual");
});

check("§2 doximity is external-assisted — launch ONLY, nothing else", () => {
  const c = capabilitiesFor("doximity");
  assert.strictEqual(c.canLaunchExternalProvider, true, "can launch");
  assert.strictEqual(c.canInitiateFromPlexus, false, "cannot initiate from Plexus");
  assert.strictEqual(c.canVerifyInitiation, false);
  assert.strictEqual(c.canObserveLiveState, false);
  assert.strictEqual(c.canVerifyConnection, false);
  assert.strictEqual(c.canProvideDuration, false);
  assert.strictEqual(c.canReceiveProviderEvents, false);
  assert.strictEqual(c.canProvideProviderSessionId, false);
  assert.strictEqual(providerModeFromCapabilities(c), "external_assisted");
});

check("§3 ringcentral is the integrated ceiling", () => {
  const c = capabilitiesFor("ringcentral");
  assert.strictEqual(c.canInitiateFromPlexus, true);
  assert.strictEqual(c.canObserveLiveState, true);
  assert.strictEqual(c.canVerifyConnection, true);
  assert.strictEqual(c.canProvideDuration, true);
  assert.strictEqual(c.canReceiveProviderEvents, true);
  assert.strictEqual(c.canProvideProviderSessionId, true);
  assert.strictEqual(providerModeFromCapabilities(c), "integrated");
});

check("§4 unknown provider falls back to no-capabilities/manual mode", () => {
  const c = capabilitiesFor("nope" as never);
  assert.strictEqual(providerModeFromCapabilities(c), "manual");
});

check("§5 terminal vs non-terminal states", () => {
  for (const s of ["ended", "failed", "no_answer", "busy", "canceled"] as const) {
    assert.strictEqual(isTerminalTelephonyState(s), true, `${s} terminal`);
  }
  for (const s of ["initiated", "proceeding", "connected"] as const) {
    assert.strictEqual(isTerminalTelephonyState(s), false, `${s} non-terminal`);
  }
});

check("§6 state rank is monotonic through the live lifecycle", () => {
  assert.ok(TELEPHONY_STATE_RANK.initiated < TELEPHONY_STATE_RANK.proceeding);
  assert.ok(TELEPHONY_STATE_RANK.proceeding < TELEPHONY_STATE_RANK.connected);
  assert.ok(TELEPHONY_STATE_RANK.connected <= TELEPHONY_STATE_RANK.ended);
  // Terminal states share the top rank.
  assert.strictEqual(TELEPHONY_STATE_RANK.ended, TELEPHONY_STATE_RANK.failed);
  assert.strictEqual(TELEPHONY_STATE_RANK.ended, TELEPHONY_STATE_RANK.no_answer);
});

check("§7 every selectable provider + state has coverage", () => {
  for (const id of SELECTABLE_PHONE_PROVIDER_IDS) {
    assert.ok(PHONE_PROVIDER_CAPABILITIES[id], `capabilities for ${id}`);
  }
  for (const s of TELEPHONY_SESSION_STATES) {
    assert.ok(typeof TELEPHONY_STATE_RANK[s] === "number", `rank for ${s}`);
  }
});

if (failures > 0) {
  console.error(`telephonyCapabilities.test.ts: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("telephonyCapabilities.test.ts: all tests passed");
