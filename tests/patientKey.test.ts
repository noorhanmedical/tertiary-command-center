import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalNameKey,
  normalizePatientName,
  normalizeDob,
  patientKey,
} from "../server/lib/patientKey";

describe("canonicalNameKey", () => {
  it("normalizes 'Last, First Middle' to 'first last'", () => {
    assert.equal(canonicalNameKey("Smith, John A"), "john smith");
  });

  it("returns 'first last' for 'First Middle Last' with middle initial", () => {
    assert.equal(canonicalNameKey("John A Smith"), "john smith");
    assert.equal(canonicalNameKey("John A. Smith"), "john smith");
  });

  it("treats nicknames as canonical first names", () => {
    assert.equal(canonicalNameKey("Bill Smith"), "william smith");
    assert.equal(canonicalNameKey("Billy Smith"), "william smith");
    assert.equal(canonicalNameKey("Bob Jones"), "robert jones");
    assert.equal(canonicalNameKey("Liz Brown"), "elizabeth brown");
  });

  it("matches both nickname and canonical to the same key", () => {
    assert.equal(canonicalNameKey("Bill Smith"), canonicalNameKey("William Smith"));
    assert.equal(canonicalNameKey("Bob Jones"), canonicalNameKey("Robert Jones"));
  });

  it("strips suffixes (Jr, Sr, II, III, IV, V)", () => {
    assert.equal(canonicalNameKey("John Smith Jr"), "john smith");
    assert.equal(canonicalNameKey("John Smith Jr."), "john smith");
    assert.equal(canonicalNameKey("John Smith Sr"), "john smith");
    assert.equal(canonicalNameKey("John Smith II"), "john smith");
    assert.equal(canonicalNameKey("John Smith III"), "john smith");
    assert.equal(canonicalNameKey("John Smith IV"), "john smith");
    assert.equal(canonicalNameKey("Smith, John A Jr"), "john smith");
  });

  it("handles hyphenated names by treating hyphen as a space", () => {
    // Hyphen splits into separate tokens; we keep first token as 'first' and
    // last token as 'last'.
    assert.equal(canonicalNameKey("Mary-Jane Doe"), "mary doe");
    assert.equal(canonicalNameKey("Anne Smith-Jones"), "anne jones");
    // Hyphen on first only collapses to first token.
    assert.equal(normalizePatientName("Mary-Jane Doe"), "mary jane doe");
  });

  it("returns empty string on null/empty input", () => {
    assert.equal(canonicalNameKey(null), "");
    assert.equal(canonicalNameKey(undefined), "");
    assert.equal(canonicalNameKey(""), "");
    assert.equal(canonicalNameKey("   "), "");
  });

  it("passes single-token names through, mapping nicknames", () => {
    assert.equal(canonicalNameKey("Smith"), "smith");
    assert.equal(canonicalNameKey("Bill"), "william");
  });

  it("returns empty string when only suffixes remain", () => {
    assert.equal(canonicalNameKey("Jr"), "");
    assert.equal(canonicalNameKey("II III"), "");
  });
});

describe("normalizeDob", () => {
  it("keeps ISO YYYY-MM-DD as-is", () => {
    assert.equal(normalizeDob("1980-01-15"), "1980-01-15");
    assert.equal(normalizeDob("1980-01-15T00:00:00Z"), "1980-01-15");
  });

  it("converts US M/D/YYYY to ISO", () => {
    assert.equal(normalizeDob("1/15/1980"), "1980-01-15");
    assert.equal(normalizeDob("01/15/1980"), "1980-01-15");
  });

  it("expands 2-digit years using a 1930 cutoff", () => {
    assert.equal(normalizeDob("1/15/80"), "1980-01-15");
    assert.equal(normalizeDob("1/15/20"), "2020-01-15");
  });

  it("returns empty string for null/empty", () => {
    assert.equal(normalizeDob(null), "");
    assert.equal(normalizeDob(""), "");
  });
});

describe("patientKey", () => {
  it("combines canonical name and normalized dob with __ separator", () => {
    assert.equal(patientKey("Bill Smith", "1/15/1980"), "william smith__1980-01-15");
    assert.equal(
      patientKey("Smith, John A Jr", "1980-01-15"),
      "john smith__1980-01-15",
    );
  });

  it("produces equal keys for equivalent inputs", () => {
    assert.equal(
      patientKey("Bill Smith", "1/15/1980"),
      patientKey("William Smith", "1980-01-15"),
    );
  });
});
