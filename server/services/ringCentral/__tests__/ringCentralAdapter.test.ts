import { it } from "vitest";
// Unit test: RingCentral adapter facade behaves correctly with an
// in-memory client. Default (dormant) client throws — confirms Phase 1
// stays inert without explicit wiring.

import assert from "node:assert/strict";
import {
  createRingCentralAdapter,
  isRingCentralAdapterEnabled,
  type InitiateCallInput,
  type InitiateCallResult,
} from "../ringCentralAdapter";
import type { RingCentralCallStatus } from "../ringCentralClient";

async function expectThrows(fn: () => Promise<unknown>, contains: string) {
  let threw = false;
  try { await fn(); } catch (e) { threw = true; assert.ok(String((e as Error).message).includes(contains), `expected error to include "${contains}", got ${(e as Error).message}`); }
  assert.equal(threw, true, "expected promise to reject");
}

async function main() {
  // Default client is dormant.
  const dormant = createRingCentralAdapter();
  await expectThrows(() => dormant.initiateCall({ fromUserExtension: "100", toE164: "+12025550101", patientScreeningId: 42 }), "dormant");
  await expectThrows(() => dormant.getCallStatus("rc-call-1"), "dormant");

  // Injected fake client routes through.
  const fake: { initiateCalls: InitiateCallInput[] } = { initiateCalls: [] };
  const status: RingCentralCallStatus = "ringing";
  const result: InitiateCallResult = { ringCentralCallId: "rc-call-1", status };
  const wired = createRingCentralAdapter({
    async initiateCall(input) { fake.initiateCalls.push(input); return result; },
    async getCallStatus(_id) { return status; },
  });
  const r = await wired.initiateCall({ fromUserExtension: "100", toE164: "+12025550101", patientScreeningId: 42 });
  assert.equal(r.ringCentralCallId, "rc-call-1");
  assert.equal(r.status, "ringing");
  assert.equal(fake.initiateCalls.length, 1);
  assert.equal(await wired.getCallStatus("rc-call-1"), "ringing");

  // Flag default-OFF.
  assert.equal(isRingCentralAdapterEnabled({}), false);
  assert.equal(isRingCentralAdapterEnabled({ USE_RINGCENTRAL_ADAPTER: "0" }), false);
  assert.equal(isRingCentralAdapterEnabled({ USE_RINGCENTRAL_ADAPTER: "1" }), true);
  assert.equal(isRingCentralAdapterEnabled({ USE_RINGCENTRAL_ADAPTER: "true" }), true);
  assert.equal(isRingCentralAdapterEnabled({ USE_RINGCENTRAL_ADAPTER: "yes" }), true);

  console.log("RingCentral adapter test passed.");
}

it("RingCentral adapter", async () => {
  await main();
});
