// Journey-timeline identity-scoping regression test.
//
// Runnable via:
//   npx tsx server/routes/__tests__/journey-lookup-scoping.test.ts
//
// PURPOSE
//   Locks the data-isolation rule for the per-patient call-history
//   timeline endpoint (GET /api/engagement/assignment-board/cases/
//   :executionCaseId/journey). The endpoint scopes its journey-event
//   lookup via journeyLookupFilter():
//     - name + DOB present  → identity-scoped { patientName, patientDob }
//                             (spans every execution case for that person)
//     - DOB missing/blank   → case-scoped   { executionCaseId }
//                             (never mixes patients)
//
//   The critical invariant: two DIFFERENT patients who share the same
//   name must NEVER fall back to a name-only lookup when DOB is absent,
//   because that would merge their histories (a correctness bug AND a
//   PHI cross-patient leak).
//
// SCOPE / SAFETY
//   - No DB, no app boot, no network. Pure function under test.
//   - No PHI in fixtures (synthetic names only).
//
// Exit 0 = pass; exit 1 = fail.

import { journeyLookupFilter } from "../engagementAssignmentBoard";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

// ─── §1: name + DOB present → identity-scoped ─────────────────────
{
  const f = journeyLookupFilter({
    executionCaseId: 42,
    patientName: "Jane Doe",
    patientDob: "1980-01-01",
  });
  check(
    "patientName" in f && f.patientName === "Jane Doe",
    "§1: name+DOB must scope by patientName",
  );
  check(
    "patientDob" in f && f.patientDob === "1980-01-01",
    "§1: name+DOB must scope by patientDob",
  );
  check(
    !("executionCaseId" in f),
    "§1: name+DOB must NOT fall back to executionCaseId",
  );
}

// ─── §2: DOB missing → case-scoped (no name-only leak) ────────────
{
  for (const dob of [null, undefined, "", "   "]) {
    const f = journeyLookupFilter({
      executionCaseId: 7,
      patientName: "John Smith",
      patientDob: dob,
    });
    check(
      "executionCaseId" in f && f.executionCaseId === 7,
      `§2: missing DOB (${JSON.stringify(dob)}) must scope by executionCaseId`,
    );
    check(
      !("patientName" in f),
      `§2: missing DOB (${JSON.stringify(dob)}) must NOT scope by name-only`,
    );
  }
}

// ─── §3: same-name, different patients, both missing DOB ──────────
// The core leak scenario: two distinct patients share a name. Each must
// resolve to its OWN execution case, never to a shared name-only filter.
{
  const a = journeyLookupFilter({
    executionCaseId: 100,
    patientName: "Mary Johnson",
    patientDob: null,
  });
  const b = journeyLookupFilter({
    executionCaseId: 200,
    patientName: "Mary Johnson",
    patientDob: null,
  });
  check(
    "executionCaseId" in a && a.executionCaseId === 100,
    "§3: patient A must scope to its own execution case",
  );
  check(
    "executionCaseId" in b && b.executionCaseId === 200,
    "§3: patient B must scope to its own execution case",
  );
  const aKey = JSON.stringify(a);
  const bKey = JSON.stringify(b);
  check(
    aKey !== bKey,
    "§3: two same-name patients must NOT share the same lookup filter",
  );
}

// ─── §4: missing name → case-scoped ───────────────────────────────
{
  for (const name of [null, undefined, "", "   "]) {
    const f = journeyLookupFilter({
      executionCaseId: 9,
      patientName: name,
      patientDob: "1990-05-05",
    });
    check(
      "executionCaseId" in f && f.executionCaseId === 9,
      `§4: missing name (${JSON.stringify(name)}) must scope by executionCaseId`,
    );
  }
}

// ─── §5: surrounding whitespace is trimmed before identity match ──
{
  const f = journeyLookupFilter({
    executionCaseId: 5,
    patientName: "  Alex Lee  ",
    patientDob: "  2000-12-31  ",
  });
  check(
    "patientName" in f && f.patientName === "Alex Lee",
    "§5: patientName must be trimmed",
  );
  check(
    "patientDob" in f && f.patientDob === "2000-12-31",
    "§5: patientDob must be trimmed",
  );
}

if (failures.length > 0) {
  console.error("Journey-timeline identity-scoping test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Journey-timeline identity-scoping test passed.");
}
