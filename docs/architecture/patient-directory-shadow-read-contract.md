# Patient Directory shadow-read contract

**Status:** Docs-only (Bundle 20). No code added. No runtime change.
**Date:** 2026-06-09.
**Scope:** Define the shadow-read contract a future PR will adopt when surfacing `getCanonicalPatientByScreeningId` (from `server/modules/patient-directory/`, PR #65) alongside the existing roster path under a feature flag, so portals can resolve patient identity through the canonical module without changing today's response shape.
**Related:**
- `patient-directory-design.md` (Bundle 5 / PR #65 — the read-only module).
- `team-portal-playground-wiring-contract.md` §12 (Patient Directory wiring).
- `operational-queue-call-list-projection-design.md` §6 + §7 (the precedent pattern for canonical shadow-read schemas).
- `shadow-read-parity-log-analyzer-design.md` (analyzer pattern).
- `scripts/qa-shadow-read-parity-log-schema.mjs` (Bundle 14 — pattern for log-schema invariants).

This contract does NOT add the shadow read to any route. It pins the schema and gates a future shadow-read PR must satisfy.

---

## 1. Why a shadow-read contract

The Patient Directory module exposes two read helpers:

- `getCanonicalPatientByScreeningId(id)` — returns a deduplicated identity view computed from `(lower(name), dob, facility)` grouping of `patient_screenings`.
- `listCanonicalPatients({ facility, limit, offset })` — paginated equivalent.

Today every route that needs "patient identity" hits `patient_screenings` directly (`storage.getPatientScreening`, `db.select().from(patientScreenings)`, etc.). Eventually the canonical helpers will replace those reads. The cutover follows the same pattern as the SchedulerAssignment projection: shadow read → parity gate → flag flip → legacy retirement.

Without a pinned shadow-read schema, there is no contract for the future analyzer to enforce. This document fixes that.

---

## 2. Scope and out-of-scope

In scope:

- The shadow-read log schema for a future `getCanonicalPatientByScreeningId` adoption.
- The feature flag name + default.
- The PHI envelope.
- The gates a future shadow-read PR satisfies before it ships.

Out of scope:

- The route(s) that will adopt the shadow read. Each route is its own PR.
- Any DB write. The Patient Directory module is read-only.
- Any UI change.
- Any identity-normalisation rule change (name lowering, DOB format). Those live in `canonical-spine.md`.

---

## 3. Feature flag

- **Name:** `USE_PATIENT_DIRECTORY_SHADOW_READ`.
- **Default:** OFF. The flag default cannot be flipped in production by any PR that does not satisfy §6.
- **Truthy values:** `"1"`, `"true"`, `"yes"` (matches the precedent set by `USE_OPERATIONAL_QUEUE_CALL_LIST` from PR #80).
- **Flag accessor:** `server/modules/patient-directory/shadow-read-flag.ts` (path reserved; created by the future shadow-read PR, not this contract).
- **Constraint:** The flag accessor MUST NOT import the DB, the service, or the schema — same purity bar `scripts/qa-operational-queue-call-list-flag.mjs` enforces for the projection's flag.

---

## 4. Shadow-read log schema

When the flag is ON and a route resolves a `patientScreeningId`, the route emits **one** log line per resolution with **exactly** these fields:

```
[USE_PATIENT_DIRECTORY_SHADOW_READ] shadow-read {
  parityMatch:       boolean,
  legacyHasRow:      boolean,
  canonicalHasRow:   boolean,
  fieldsCompared:    number,
  fieldsDivergent:   number,
}
```

Semantics:

- **`parityMatch`** — `true` if and only if `legacyHasRow === canonicalHasRow` AND `fieldsDivergent === 0`. Derived, not independent.
- **`legacyHasRow`** — whether the direct `patient_screenings` lookup returned a row.
- **`canonicalHasRow`** — whether `getCanonicalPatientByScreeningId(id)` returned a row.
- **`fieldsCompared`** — count of fields the parity comparator inspected (e.g. name, dob, facility — the comparator's exact field list is pinned by the future shadow-read PR's source code and asserted by its QA wrapper).
- **`fieldsDivergent`** — count of compared fields whose value differs between the legacy row and the canonical row.

No counter for "fields equal" — `fieldsCompared - fieldsDivergent` is sufficient. The schema MUST NOT carry the field values themselves — neither raw nor hashed.

Skip variant (no resolution possible):

```
[USE_PATIENT_DIRECTORY_SHADOW_READ] shadow-read skipped: no patientScreeningId
```

Error variant (lookup or comparator threw):

```
[USE_PATIENT_DIRECTORY_SHADOW_READ] shadow-read failed: <err.message>
```

The error line carries `err.message` only — never the screening id, never the user id.

---

## 5. PHI prohibition list

The shadow-read block — success, skip, and error variants — MUST NOT contain:

- `patientName`
- `patientDob`
- `mrn`
- `insurance`
- `diagnosis`
- `summary:`
- `address`, `phone`, `email`
- The raw legacy row, the raw canonical row, or any `JSON.stringify` thereof
- The `patientScreeningId` itself (counts only — id leaks let log readers correlate identity)
- Any `userId`

The future shadow-read PR ships `scripts/qa-patient-directory-shadow-read-log-schema.mjs` mirroring the structure of `scripts/qa-shadow-read-parity-log-schema.mjs` (Bundle 14). That script asserts the prohibition list against the route's shadow-read block.

---

## 6. Gates the future shadow-read PR satisfies

1. The Patient Directory module's read helpers (PR #65) remain pure (no writes; bulk DB calls capped per identity-normalisation rule in `patient-directory-design.md`).
2. A parity test under `server/modules/patient-directory/__tests__/shadow-read-parity.test.ts` (path reserved) runs without a live DB by injecting a fixture fetcher.
3. The shadow read is wired ONLY behind `USE_PATIENT_DIRECTORY_SHADOW_READ` and is wrapped in a try/catch so it cannot affect the response.
4. The log schema matches §4 byte-for-byte. The QA wrapper enforces it.
5. Pre-staging: §1 of `operational-queue-staging-runbook.md` style canned-fixture pass for the Patient Directory shadow-read.
6. Staging-only flag flip. Production default OFF.
7. 7 consecutive UTC days of staging logs with `parityMatch=true` on every line, OR `fieldsDivergent / fieldsCompared < 0.001` per day. Zero `shadow-read failed:` lines.
8. Rollback drill confirms flag-OFF response is byte-identical to today's.

---

## 7. Stop conditions for the future shadow-read PR

The PR MUST stop and ask if:

1. The shadow-read block is added before the parity test exists.
2. The log line carries a field outside the §4 schema.
3. Any PHI identifier from §5 appears in the route source.
4. The flag default is changed in any environment in the same PR that adds the shadow read.
5. The future PR also touches any of: Admin Review, qualification, PDFs, billing money, scheduler-assignment writes, migrations, AWS, or any UI source file.
6. The PR removes the legacy direct read in the same change. That is a separate cutover PR after the staging window passes — same pattern as `portal-cutover-readiness-checklist.md`.
7. The PR exposes the shadow read on a route in `do-not-touch.md`.

---

## 8. Non-promises

- The shadow read does NOT replace the response. The route still returns the legacy row body.
- The shadow read does NOT make the Patient Directory module the canonical write target. Identity writes remain on existing routes.
- The shadow read does NOT close the rename gap. Renaming `patient_screenings` is a separate, schema-level concern owned by Batches 5 → 7 of the orchestrator.

End of contract.
