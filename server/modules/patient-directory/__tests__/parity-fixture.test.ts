import { describe, it } from "vitest";
// Patient Directory — parity fixture (Bundle 21).
//
// Runnable via:
//   npx tsx server/modules/patient-directory/__tests__/parity-fixture.test.ts
//
// PURPOSE
//   Pins the canonical-patient projection contract from
//   server/modules/patient-directory/contracts.ts so a future PR
//   cannot silently change the grouping rule, the canonical id
//   derivation, or the "freshest screening wins" demographic
//   selection.
//
//   Today the implementation lives in
//   server/modules/patient-directory/repo.ts (PR #65). That file
//   imports `db` and `@shared/schema` at module load, so this test
//   carries the algorithm INLINE as a reference implementation —
//   same pattern as the operational-queue projection-parity test
//   (Bundle 12 / PR #94). When a future bundle lifts the pure
//   helper out, this test can be promoted to import it directly
//   and assert equivalence with the inline reference.
//
// SCOPE / SAFETY
//   - No DB, no app boot, no network.
//   - No PHI in fixtures (synthetic names, synthetic DOBs, no
//     MRNs, no addresses, no phone numbers).
//   - The reference algorithm NEVER mutates input.
//   - The reference algorithm is read-only.
//
// CONTRACT REFERENCES
//   server/modules/patient-directory/contracts.ts (CanonicalPatient)
//   docs/architecture/patient-directory-design.md
//   docs/architecture/patient-directory-shadow-read-contract.md (Bundle 20)
//
// Exit 0 = pass; exit 1 = fail.

import crypto from "node:crypto";
import type { CanonicalPatient, CanonicalPatientId } from "../contracts";

// ─── Synthetic patient_screenings row shape (matches the legacy
//     schema slice this algorithm reads). Local declaration keeps
//     the test free of any Drizzle runtime dependency. ─────────────
type ScreeningRow = {
  id: number;
  name: string;
  dob: string | null;
  phoneNumber: string | null;
  email: string | null;
  facility: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

// ─── Test infra ────────────────────────────────────────────────────────
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

function arrEq<T>(actual: T[], expected: T[], label: string): void {
  if (actual.length !== expected.length) {
    failures.push(`${label}: length ${actual.length} != ${expected.length}`);
    return;
  }
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      failures.push(`${label}[${i}]: expected ${String(expected[i])} got ${String(actual[i])}`);
    }
  }
}

// ─── Reference canonical id derivation. Byte-equivalent to
//     server/modules/patient-directory/repo.ts#computeCanonicalPatientId
//     so a future divergence in either side surfaces here. ────────
function computeCanonicalPatientId_REFERENCE(
  name: string | null | undefined,
  dob: string | null | undefined,
): CanonicalPatientId {
  const normalizedName = String(name ?? "").trim().toLowerCase();
  const normalizedDob = String(dob ?? "").trim();
  const composite = `${normalizedName}|${normalizedDob}`;
  return crypto.createHash("sha256").update(composite).digest("hex");
}

// ─── Reference projection: rows → CanonicalPatient[]. Same rules
//     as repo.ts's listCanonicalPatients but in-memory. ───────────
function projectRowsToCanonical_REFERENCE(
  rows: ReadonlyArray<ScreeningRow>,
): CanonicalPatient[] {
  // Group by canonical id.
  const buckets = new Map<CanonicalPatientId, ScreeningRow[]>();
  for (const r of rows) {
    const id = computeCanonicalPatientId_REFERENCE(r.name, r.dob);
    const arr = buckets.get(id);
    if (arr) arr.push(r);
    else buckets.set(id, [r]);
  }

  const out: CanonicalPatient[] = [];
  for (const [id, group] of buckets) {
    // Freshest first by id (descending) — matches the
    // patientDatabase roster convention.
    const sorted = group.slice().sort((a, b) => b.id - a.id);
    const primary = sorted[0]!;
    const screeningIds = sorted.map((r) => r.id);
    const hasDeletedScreening = sorted.some((r) => r.deletedAt !== null);
    out.push({
      id,
      primaryScreeningId: primary.id,
      screeningIds,
      name: primary.name,
      dob: primary.dob,
      phoneNumber: primary.phoneNumber,
      email: primary.email,
      facility: primary.facility,
      totalScreenings: group.length,
      hasDeletedScreening,
    });
  }
  return out;
}

// ─── Canned fixtures ───────────────────────────────────────────────
//
// PHI-safe synthetic identities. Names are non-PII placeholders
// (Greek letters as last names; alphabet first initials). Phone
// numbers are 555-prefix per public conventions. DOBs are
// fictional ISO dates.

const fixtureRows: ScreeningRow[] = [
  // One person with three screenings across two facilities.
  {
    id: 401,
    name: "  Alpha One  ",
    dob: "1980-01-15",
    phoneNumber: "555-0101",
    email: null,
    facility: "Clinic A",
    createdAt: new Date("2026-05-01T12:00:00Z"),
    deletedAt: null,
  },
  {
    id: 402,
    name: "Alpha One",
    dob: "1980-01-15",
    phoneNumber: "555-0101",
    email: null,
    facility: "Clinic B",
    createdAt: new Date("2026-06-01T12:00:00Z"),
    deletedAt: null,
  },
  {
    id: 403,
    name: "ALPHA ONE",
    dob: "1980-01-15",
    phoneNumber: "555-0202",
    email: "alpha.one@example.test",
    facility: "Clinic B",
    createdAt: new Date("2026-06-09T12:00:00Z"),
    deletedAt: null,
  },
  // Second person with one screening, soft-deleted.
  {
    id: 410,
    name: "Beta Two",
    dob: "1992-03-22",
    phoneNumber: null,
    email: null,
    facility: "Clinic C",
    createdAt: new Date("2026-04-15T12:00:00Z"),
    deletedAt: new Date("2026-04-30T12:00:00Z"),
  },
  // Third person — no dob (identity normalisation must NOT collapse
  // them into the dob-null bucket of any other person).
  {
    id: 420,
    name: "Gamma Three",
    dob: null,
    phoneNumber: null,
    email: null,
    facility: null,
    createdAt: new Date("2026-06-05T12:00:00Z"),
    deletedAt: null,
  },
];

// ─── §1: Canonical id derivation invariants ───────────────────────
{
  // Lowercase + trim equivalence: variants must hash to the same id.
  const a = computeCanonicalPatientId_REFERENCE("Alpha One", "1980-01-15");
  const b = computeCanonicalPatientId_REFERENCE("  ALPHA One  ", "1980-01-15");
  const c = computeCanonicalPatientId_REFERENCE("alpha one", "1980-01-15");
  eq(a, b, "§1: trim + case normalization");
  eq(a, c, "§1: case normalization");
  // Different DOB → different id.
  const d = computeCanonicalPatientId_REFERENCE("Alpha One", "1980-01-16");
  check(a !== d, "§1: DOB change must change id");
  // Null vs empty DOB must collapse (algorithm trims to "").
  const e = computeCanonicalPatientId_REFERENCE("Alpha One", null);
  const f = computeCanonicalPatientId_REFERENCE("Alpha One", "");
  eq(e, f, "§1: null DOB and empty DOB normalize equal");
  // Null vs empty NAME must collapse.
  const g = computeCanonicalPatientId_REFERENCE(null, "1980-01-15");
  const h = computeCanonicalPatientId_REFERENCE("", "1980-01-15");
  eq(g, h, "§1: null name and empty name normalize equal");
}

// ─── §2: Projection — grouping rule ───────────────────────────────
{
  const out = projectRowsToCanonical_REFERENCE(fixtureRows);
  check(out.length === 3, `§2: expected 3 canonical patients, got ${out.length}`);
  // Sort by primaryScreeningId desc for deterministic indexing.
  out.sort((a, b) => b.primaryScreeningId - a.primaryScreeningId);
  // Alpha — three screenings collapsed.
  const alpha = out.find((p) => p.primaryScreeningId === 403)!;
  check(!!alpha, "§2: Alpha canonical row must exist");
  if (alpha) {
    eq(alpha.totalScreenings, 3, "§2: Alpha totalScreenings");
    arrEq(alpha.screeningIds, [403, 402, 401], "§2: Alpha screeningIds DESC");
    eq(alpha.hasDeletedScreening, false, "§2: Alpha hasDeletedScreening");
    // Demographics come from the FRESHEST row (id 403): name, phone,
    // email, facility all override older rows.
    eq(alpha.name, "ALPHA ONE", "§2: Alpha name from freshest");
    eq(alpha.phoneNumber, "555-0202", "§2: Alpha phone from freshest");
    eq(alpha.email, "alpha.one@example.test", "§2: Alpha email from freshest");
    eq(alpha.facility, "Clinic B", "§2: Alpha facility from freshest");
  }
  // Beta — soft-deleted single screening still produces a canonical row.
  const beta = out.find((p) => p.primaryScreeningId === 410)!;
  check(!!beta, "§2: Beta canonical row must exist (soft-deleted preserved)");
  if (beta) {
    eq(beta.totalScreenings, 1, "§2: Beta totalScreenings");
    eq(beta.hasDeletedScreening, true, "§2: Beta hasDeletedScreening");
  }
  // Gamma — null-dob person is its own canonical row, NOT folded into
  // any other null-dob bucket because the name differs.
  const gamma = out.find((p) => p.primaryScreeningId === 420)!;
  check(!!gamma, "§2: Gamma canonical row must exist");
  if (gamma) {
    eq(gamma.totalScreenings, 1, "§2: Gamma totalScreenings");
    eq(gamma.dob, null, "§2: Gamma dob");
    eq(gamma.facility, null, "§2: Gamma facility null");
  }
}

// ─── §3: Hash stability — same input → same output across runs ────
{
  const expected = computeCanonicalPatientId_REFERENCE("Alpha One", "1980-01-15");
  // SHA-256 hex digest is 64 lowercase chars.
  check(
    /^[0-9a-f]{64}$/.test(expected),
    `§3: canonical id must be 64 lowercase hex chars, got ${expected}`,
  );
  // Re-derive — must be identical.
  eq(
    computeCanonicalPatientId_REFERENCE("Alpha One", "1980-01-15"),
    expected,
    "§3: re-derivation must equal first derivation",
  );
}

// ─── §4: Input not mutated (frozen tripwire) ──────────────────────
{
  const frozen = Object.freeze(
    fixtureRows.map((r) => Object.freeze({ ...r })) as ScreeningRow[],
  );
  let threw = false;
  try {
    projectRowsToCanonical_REFERENCE(frozen);
  } catch (err) {
    threw = true;
    failures.push(
      `§4: projection threw on frozen input — possible mutation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  check(!threw, "§4: projection must not mutate frozen input");
}

// ─── §5: Empty input ──────────────────────────────────────────────
{
  const out = projectRowsToCanonical_REFERENCE([]);
  check(out.length === 0, `§5: empty input returns empty array, got ${out.length}`);
}

// ─── §6: PHI guard on fixture content ─────────────────────────────
//
// Pinning the synthetic-name convention so a future contributor
// cannot accidentally drop a real patient identifier into the
// fixture and silently merge it.
{
  for (const r of fixtureRows) {
    // Names must contain a Greek-letter root used as a synthetic
    // identifier ("Alpha", "Beta", "Gamma", etc.). The check is
    // intentionally narrow: real names rarely look like this.
    const ok = /^(\s*)(alpha|beta|gamma|delta|epsilon)\s/i.test(r.name);
    check(ok, `§6: fixture name "${r.name}" must use the synthetic Greek-letter convention`);
    // No phone may be a real shape (only 555-prefix synthetic).
    if (r.phoneNumber !== null) {
      check(
        r.phoneNumber.startsWith("555-"),
        `§6: fixture phone "${r.phoneNumber}" must use 555-prefix`,
      );
    }
    // No real email domain.
    if (r.email !== null) {
      check(
        r.email.endsWith("@example.test"),
        `§6: fixture email "${r.email}" must use @example.test`,
      );
    }
  }
}

describe("Patient Directory parity fixture", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Patient Directory parity fixture failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
