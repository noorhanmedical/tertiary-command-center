# Patient Directory design (Batch 5)

**Branch:** `architecture/batch-5-patient-directory-prep`
**Date:** 2026-06-09
**Scope:** Read-only server module + design doc. No new database table. No migration. No route wiring. No identity-write-path change.

> Cross-reference: `docs/architecture/canonical-spine.md` §1–§3 (current identity duplication), `docs/architecture/protected-flows.md`, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 5 entry, `docs/architecture/backend-route-parity-inventory.md` §10.1 (`/api/patients/database` roster).

---

## 1. Why this batch exists

Patient identity is currently duplicated across ~15 tables (per the original architecture review). The anchor is `patient_screenings`, but that table is a **Plexus IQ episode**, not a person — the same person can appear N times when they're imported into N batches or screened on N visits.

The current `/api/patients/database` roster route at `server/routes/patientDatabase.ts:107–183` already "fakes" a directory by doing SQL `GROUP BY (lower(name), dob)` over `patient_screenings`. **This batch promotes that grouping concept into a typed read helper** so every future caller asking "who is this patient, canonically?" can use the same answer. Switching the helper's backing store from `patient_screenings` (today) to a real `patient_directory` table (later) is then a one-line change.

This batch:

- Adds `server/modules/patient-directory/` with `contracts.ts`, `repo.ts`, `service.ts`, `index.ts`.
- Adds two read helpers: `getCanonicalPatientByScreeningId(id)` and `listCanonicalPatients({ facility, limit, offset })`.
- Adds a stable canonical-id derivation: `computeCanonicalPatientId(name, dob)` returns a SHA-256 hex digest.
- Adds this design doc.

This batch does **NOT**:

- Create any new database table.
- Add or run any migration.
- Rename `patient_screenings` or any column.
- Modify any identity-write path (`POST /api/batches/:id/patients`, `POST /api/batches/:id/import-file`, `POST /api/batches/:id/import-text`, `POST /api/plexus-iq/clinical-import`, `script/seed*.ts`).
- Modify the existing roster route (`/api/patients/database`).
- Touch any client code, PDF code, billing code, scheduler code, or Admin Review code.

---

## 2. Canonical id derivation

```ts
function computeCanonicalPatientId(
  name: string | null | undefined,
  dob: string | null | undefined,
): string {
  const n = String(name ?? "").trim().toLowerCase();
  const d = String(dob ?? "").trim();
  return sha256(`${n}|${d}`).hex();
}
```

- **Deterministic.** Same `(name, dob)` pair → same id, across runs.
- **No database round-trip required.** Useful in code paths where the canonical view is only needed to compute the id.
- **Forward-compatible.** When the real `patient_directory` table ships, the column can store this digest as a `text` column (or, more likely, this digest becomes the `text` lookup key and the real `id` is an integer PK). Either way, the digest is the bridge.

Known limitations of the digest:

- It cannot tell two **distinct** people with the same name and DOB apart. The future `patient_directory` table will need additional disambiguators (phone, MRN, address) — Batch 7 (patient matching/deduping design) is the venue for those rules.
- A typo in `name` or `dob` at intake produces a different digest. Batch 7 also addresses fuzzy-match → manual-review escalation.

---

## 3. `CanonicalPatient` shape

See `server/modules/patient-directory/contracts.ts`. Highlights:

- `id` — the SHA-256 digest.
- `primaryScreeningId` — the `patient_screenings.id` of the **freshest** screening that contributes to the canonical identity. The demographics fields (`name`, `dob`, `phoneNumber`, `email`, `facility`) come from this primary row.
- `screeningIds` — every live `patient_screenings.id` sharing the canonical key, sorted newest-first.
- `totalScreenings` — count of live screenings.
- `hasDeletedScreening` — true iff at least one screening with the same canonical key has been soft-deleted. Useful for the future merge-review UI.

The current helper EXCLUDES soft-deleted screenings from `screeningIds` and from the listing/count. The roster route at `/api/patients/database` does the same. Future writers (Batch 5b+) may need to expose deleted rows for the merge review — that's a separate API.

---

## 4. Read helpers

### `listCanonicalPatients({ facility, limit, offset })`

- Pulls all live `patient_screenings` rows (one SELECT, ordered by id DESC).
- Groups in code by `computeCanonicalPatientId(name, dob)`.
- For each group, the primary screening = the row with the highest id.
- Filters by primary-row `facility` when supplied.
- Sorts canonical patients by `primaryScreeningId` DESC (freshest first), then alphabetical name as a stable tie-breaker.
- Slices by `offset` (default 0) and `limit` (default 100, max 500).

**Memory budget:** ~one row per live `patient_screenings` row in memory. For the patient counts this codebase serves today, well within a single response. The future db-backed table replaces this in-memory grouping; the public signature stays the same.

### `getCanonicalPatientByScreeningId(screeningId)`

- Reads the seed screening (including soft-deleted, so a caller can resolve from a deleted id).
- Re-queries `patient_screenings` for all live peers matching `(lower(trim(name)), dob)` of the seed.
- Returns the same `CanonicalPatient` shape built from the peer set.

Returns `undefined` only when `screeningId` is unknown. A soft-deleted seed still returns the canonical view (which may be empty in `screeningIds` if no live peer exists; the seed itself is used as a defensive fallback).

---

## 5. Count parity check (recommended verification before any caller is wired)

Before any future batch (5a+) wires a route or UI to these helpers, run:

```sql
-- Existing roster aggregation (illustrative — full query at
-- server/storage.ts / repositories/screening.repo.ts);
SELECT COUNT(*) FROM (
  SELECT lower(trim(name)) AS canonical_name, dob
  FROM patient_screenings
  WHERE deleted_at IS NULL
  GROUP BY canonical_name, dob
) g;
```

vs.

```ts
(await listCanonicalPatients({ limit: 500 })).length
```

These two counts must match for a single facility's subset. If they diverge, the helper grouping rule is off; STOP and reconcile before wiring any consumer. The orchestrator's Batch 5 stop condition reads:

> If the GROUP BY produces a different count than the existing `routes/patientDatabase.ts` roster for a sample facility/date, STOP and reconcile. Two diverging "canonical" counts is worse than zero canonical counts.

This batch does not ship the count-parity test as automated coverage — it's a manual gate for the future wiring batch.

---

## 6. Future table DDL (commented; NOT shipped as a SQL file)

When the real table is introduced (Batch 5e or similar, NOT in this batch), the recommended DDL is:

```sql
-- Future: patient_directory
-- DDL is intentionally commented-out here; this batch ships zero schema
-- changes. The DDL below is the reviewer's target for the cutover batch.
--
-- CREATE TABLE patient_directory (
--   id              TEXT PRIMARY KEY,        -- sha256 hex (computeCanonicalPatientId)
--   primary_screening_id INTEGER NOT NULL REFERENCES patient_screenings(id) ON DELETE RESTRICT,
--   name            TEXT NOT NULL,
--   dob             TEXT,
--   phone_number    TEXT,
--   email           TEXT,
--   facility        TEXT,
--   total_screenings INTEGER NOT NULL,
--   has_deleted_screening BOOLEAN NOT NULL DEFAULT FALSE,
--   created_at      TIMESTAMP NOT NULL DEFAULT now(),
--   updated_at      TIMESTAMP NOT NULL DEFAULT now()
-- );
-- CREATE INDEX patient_directory_facility_idx ON patient_directory (facility);
-- CREATE UNIQUE INDEX patient_directory_lower_name_dob_idx
--   ON patient_directory ((lower(trim(name))), dob);
```

Migration order (future batches):

1. **5b — add the table, dual-write from every identity-write path.** The helpers continue to read from `patient_screenings`. Catch-up writer backfills existing canonical patients.
2. **5c — flip the read helpers to the table.** Existing roster route still works because the helpers' signature is unchanged.
3. **5d — drop the in-memory grouping fallback** from `repo.ts`.
4. **5e — point `routes/patientDatabase.ts` at the helpers** (it currently re-implements the grouping in SQL).
5. **5f+ — other consumers** (engagement-board conflict guard, scheduler portal, team portal lookups).

Each step is a separate PR with its own approval. This batch ships only the foundation; the order above is documented as the future plan.

---

## 7. Compatibility rules

- **No identity writes from this module.** All write paths stay on their existing handlers.
- **No schema change.** No DDL ships in this batch. The DDL in §6 is documentation, not a migration file.
- **No client change.** No route imports the module; no UI consumes it.
- **The roster route at `/api/patients/database` is not switched.** The reasoning: the existing roster query also aggregates cooldown / last-visit / generated-notes joins, which are out of scope for the canonical-identity helpers. Switching the roster is Batch 5e in the cutover plan.
- **The helpers DO NOT modify `patient_screenings.notes`** (where MRN lives today). That's Batch 7's job.

---

## 8. Hard protected areas — none touched

| Area | Touched? | Why |
| --- | --- | --- |
| Patient qualification logic | no | No `reasoning` reads, no `qualifyingTests` reads. |
| Plexus IQ qualification flow | no | No route registered; no caller. |
| Plexus IQ import (clinical-import) | no | Identity write path explicitly untouched. |
| Admin Review reasoning behavior | no | No Admin Review code touched. |
| Supporting button assignment logic | no | No reasoning touched. |
| Canonical reasoning shape | no | No writes to `patient_screenings.reasoning`. |
| Plexus packets / Clinician packets | no | No PDF code touched. |
| Plexus PDF / Clinician PDF / Collection PDF | no | No PDF code touched. |
| Selected patient PDF actions | no | No client code touched. |
| Scheduler-to-patient assignment correctness | no | Module only reads patient_screenings. |
| Patient-to-scheduler assignment persistence | no | No writes anywhere. |
| Report/document source data used by PDFs | no | No document code touched. |
| Billing / invoice correctness | no | No billing tables read or written. |

---

## 9. Risks acknowledged

- **In-memory grouping cost.** The list helper pulls all live screening rows and groups in code. For the patient counts this codebase serves today this is fine; for production scale, the real table (Batch 5b+) replaces the grouping.
- **Digest collisions.** SHA-256 collisions are not a practical risk; the digest is used for identity grouping, not security.
- **Two distinct people with same (name, dob).** Cannot be told apart by the digest alone. Batch 7 (patient matching/deduping) introduces the additional disambiguators.
- **Stale-row drift.** A `patient_screenings` row that's edited after a canonical view is computed shows stale data until the next call. Acceptable for a read helper; the future table needs an updated-at index and a refresh strategy.
- **Facility filter semantics.** The roster route applies facility filter to the primary screening; this helper does the same. A patient who's been seen at clinic A (recent) and clinic B (historical) will only match a `facility: "A"` filter. Documented in `contracts.ts`.

---

## 10. Rollback plan

`git rm -r server/modules/patient-directory/` + `git rm docs/architecture/patient-directory-design.md`. Zero runtime state to unwind. No table, no migration, no consumer.

---

## 11. Stop conditions for follow-up batches (5a–5z)

A future batch in this cutover MUST stop and ask before continuing if:

1. The count-parity check in §5 fails for any sample facility.
2. Any consumer-switch batch (5e+) reveals that the existing roster query joins data (cooldown, generated notes, etc.) that the canonical helper doesn't expose. The helper either grows to cover those joins, or the consumer keeps its existing query for those joins; do not silently drop data.
3. Adding the real table requires a multi-row backfill that locks `patient_screenings` for more than a few seconds. Stage the migration with `CREATE INDEX CONCURRENTLY` and batched writes.
4. Any rename of `patient_screenings` or its columns is proposed in the same batch as the table introduction — these must be separate batches.
5. The future merge-review UI is proposed in the same batch as the table introduction — that's Batch 7 territory.

End of design doc.
