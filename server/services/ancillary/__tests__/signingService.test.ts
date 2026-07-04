import { it } from "vitest";
import assert from "node:assert/strict";
import {
  SIGNING_TRANSITIONS,
  TERMINAL_SIGNING_STATUSES,
  canTransition,
  isSigningServiceEnabled,
  nextSigningStatus,
  requiresPhysicianSignature,
  type SigningStatus,
} from "../signingService";

async function main() {
  // Flag default-OFF.
  assert.equal(isSigningServiceEnabled({}), false);
  assert.equal(isSigningServiceEnabled({ USE_ANCILLARY_SIGNING_SERVICE: "0" }), false);
  assert.equal(isSigningServiceEnabled({ USE_ANCILLARY_SIGNING_SERVICE: "1" }), true);
  assert.equal(isSigningServiceEnabled({ USE_ANCILLARY_SIGNING_SERVICE: "true" }), true);
  assert.equal(isSigningServiceEnabled({ USE_ANCILLARY_SIGNING_SERVICE: "yes" }), true);

  // Allowed transitions match the F5 contract.
  assert.ok(canTransition("unsigned", "pending"));
  assert.ok(canTransition("pending", "signed"));
  assert.ok(canTransition("pending", "declined"));
  assert.ok(canTransition("pending", "unsigned"));
  assert.ok(canTransition("signed", "revoked"));

  // Disallowed transitions.
  assert.equal(canTransition("unsigned", "signed"), false);
  assert.equal(canTransition("signed", "pending"), false);
  assert.equal(canTransition("declined", "signed"), false);
  assert.equal(canTransition("revoked", "signed"), false);

  // Trigger routing.
  assert.equal(nextSigningStatus("unsigned", "open_signing_ui"), "pending");
  assert.equal(nextSigningStatus("pending", "attest_signed"), "signed");
  assert.equal(nextSigningStatus("pending", "reject_signing"), "declined");
  assert.equal(nextSigningStatus("pending", "cancel_signing"), "unsigned");
  assert.equal(nextSigningStatus("signed", "admin_revoke"), "revoked");
  assert.equal(nextSigningStatus("unsigned", "attest_signed"), null);

  // Terminal set.
  assert.ok(TERMINAL_SIGNING_STATUSES.has("signed"));
  assert.ok(TERMINAL_SIGNING_STATUSES.has("revoked"));
  assert.equal(TERMINAL_SIGNING_STATUSES.has("pending" as SigningStatus), false);

  // Documents that require signature.
  assert.ok(requiresPhysicianSignature("post_procedure_note"));
  assert.ok(requiresPhysicianSignature("report"));
  assert.equal(requiresPhysicianSignature("order_note"), false);
  assert.equal(requiresPhysicianSignature("informed_consent"), false);
  assert.equal(requiresPhysicianSignature("screening_form"), false);

  // Transition table has the expected size.
  assert.equal(SIGNING_TRANSITIONS.length, 5);

  console.log("Signing service test passed.");
}

it("Signing service", async () => {
  await main();
});
