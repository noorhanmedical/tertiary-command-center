import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import {
  sessionRole,
  canEditDefaultCapacity,
  canOverrideCapacity,
} from "../../server/services/scheduling/capacityAuthorization";

function reqWith(role?: string, userId?: string): Request {
  return { session: { role, userId } } as unknown as Request;
}

describe("override policy — default capacity edits (admin only)", () => {
  it("permits admin", () => {
    assert.equal(canEditDefaultCapacity(reqWith("admin", "u1")), true);
  });
  it("denies non-admins", () => {
    assert.equal(canEditDefaultCapacity(reqWith("clinician", "u2")), false);
    assert.equal(canEditDefaultCapacity(reqWith("scheduler", "u3")), false);
    assert.equal(canEditDefaultCapacity(reqWith(undefined, "u4")), false);
  });
});

describe("override policy — temporary/scheduling override", () => {
  it("admin may always override (no DB read needed)", async () => {
    assert.equal(await canOverrideCapacity(reqWith("admin", "admin-1")), true);
  });
  it("a session with no user id cannot override", async () => {
    assert.equal(await canOverrideCapacity(reqWith("clinician")), false);
  });
});

describe("sessionRole default", () => {
  it("defaults to clinician when no role on the session", () => {
    assert.equal(sessionRole(reqWith(undefined, "u")), "clinician");
    assert.equal(sessionRole(reqWith("acs", "u")), "acs");
  });
});
