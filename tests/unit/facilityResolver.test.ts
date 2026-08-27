import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchFacility, type CanonicalFacility } from "../../server/services/facilityResolver";

// Pure resolution tests for the facility resolver ambiguity safeguard.
// `matchFacility` is the DB-free core used by createFacilityResolver.
//
// Candidate set mirrors a realistic mix: active clinics-table facilities,
// plus legacy VALID_FACILITIES entries that share a common word ("NWPG").
// Inactive facilities are NOT part of the candidate set (loadCanonicalFacilities
// filters to active clinics before matching), so "inactive" here means the
// facility simply is not present among candidates.
const FACILITIES: CanonicalFacility[] = [
  { name: "Life Medical Center", clinicId: 3, source: "clinics" },
  { name: "Taylor Family Practice", clinicId: 1, source: "clinics" },
  { name: "NWPG - Spring", clinicId: null, source: "legacy" },
  { name: "NWPG - Veterans", clinicId: null, source: "legacy" },
];

describe("matchFacility — exact (case-insensitive)", () => {
  it("resolves an exact canonical name", () => {
    const r = matchFacility("Life Medical Center", FACILITIES);
    assert.equal(r?.name, "Life Medical Center");
    assert.equal(r?.clinicId, 3);
    assert.equal(r?.source, "clinics");
  });

  it("resolves case-insensitively", () => {
    assert.equal(matchFacility("life medical center", FACILITIES)?.name, "Life Medical Center");
    assert.equal(matchFacility("TAYLOR FAMILY PRACTICE", FACILITIES)?.name, "Taylor Family Practice");
  });

  it("exact match wins even when a substring would be ambiguous", () => {
    // "NWPG - Spring" is an exact hit; must not be blocked by the fact that
    // "NWPG" alone is ambiguous across two legacy facilities.
    const r = matchFacility("NWPG - Spring", FACILITIES);
    assert.equal(r?.name, "NWPG - Spring");
  });
});

describe("matchFacility — unique substring", () => {
  it("resolves when exactly one active facility matches the substring", () => {
    const r = matchFacility("Life Medical", FACILITIES);
    assert.equal(r?.name, "Life Medical Center");
  });

  it("resolves a distinctive legacy substring uniquely", () => {
    assert.equal(matchFacility("Veterans", FACILITIES)?.name, "NWPG - Veterans");
    assert.equal(matchFacility("Spring", FACILITIES)?.name, "NWPG - Spring");
  });
});

describe("matchFacility — ambiguous substring safeguard", () => {
  it("returns null when the substring matches more than one facility", () => {
    // "NWPG" is contained in both "NWPG - Spring" and "NWPG - Veterans".
    assert.equal(matchFacility("NWPG", FACILITIES), null);
  });

  it("returns null for a broad word matching multiple facilities", () => {
    // Add a second active facility containing "Medical" so the substring is
    // genuinely ambiguous among ACTIVE candidates.
    const withTwoMedical: CanonicalFacility[] = [
      ...FACILITIES,
      { name: "Desert Medical Center", clinicId: 2, source: "clinics" },
    ];
    assert.equal(matchFacility("Medical", withTwoMedical), null);
  });
});

describe("matchFacility — legacy back-compat", () => {
  it("resolves legacy VALID_FACILITIES names present in the candidate set", () => {
    const r = matchFacility("NWPG - Veterans", FACILITIES);
    assert.equal(r?.name, "NWPG - Veterans");
    assert.equal(r?.clinicId, null);
    assert.equal(r?.source, "legacy");
  });
});

describe("matchFacility — inactive / not-a-candidate", () => {
  it("returns null for a facility that is not in the (active) candidate set", () => {
    // Desert Medical Center is inactive → excluded from candidates upstream.
    assert.equal(matchFacility("Desert Medical Center", FACILITIES), null);
  });
});

describe("matchFacility — unknown / empty", () => {
  it("returns null for an unknown facility", () => {
    assert.equal(matchFacility("Nonexistent Clinic XYZ", FACILITIES), null);
  });

  it("returns null for empty / whitespace / nullish input", () => {
    assert.equal(matchFacility("", FACILITIES), null);
    assert.equal(matchFacility("   ", FACILITIES), null);
    assert.equal(matchFacility(null, FACILITIES), null);
    assert.equal(matchFacility(undefined, FACILITIES), null);
  });
});
