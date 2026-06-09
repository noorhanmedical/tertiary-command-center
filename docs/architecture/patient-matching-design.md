# Patient matching / deduping design (Batch 7)

**Branch:** `architecture/batch-7-patient-matching-design`
**Date:** 2026-06-09
**Scope:** Design-only. No code. No schema. No migration. No matcher implementation. No silent merges anywhere.

> Cross-reference: `docs/architecture/canonical-spine.md` §3.1 (`patient_directory` MISSING), §3.2 (`patient_identifiers` MISSING), `docs/architecture/patient-directory-design.md` (Batch 5), `docs/architecture/full-21-batch-orchestrator-review.md` Batch 7.

---

## 1. Why this needs to happen

There are **five identity-creation paths** in the codebase. **None of them check for an existing patient** before inserting a new `patient_screenings` row. The five paths are:

1. **Manual entry** — `POST /api/batches/:id/patients` (`server/routes/batches.ts:133`). Operator types name + dob + phone in the UI.
2. **File import** — `POST /api/batches/:id/import-file` (`batches.ts:184`). Multer-buffered Excel/CSV/PDF/image, AI-parsed.
3. **Text paste import** — `POST /api/batches/:id/import-text` (`batches.ts:257`). Operator pastes a clinical block.
4. **Plexus IQ clinical import** — `POST /api/plexus-iq/clinical-import` (`server/routes/plexusIqClinicalImport.ts:177`). Bulk paste from a structured clinical export. MRN is stamped into `patient_screenings.notes` by `buildClinicalImportNotes(...)` (line 35).
5. **Test fixtures / seed scripts** — `script/seed*.ts`.

The consequences of having no dedupe today:

- The same patient can appear N times across batches (one row per import). The roster aggregation at `/api/patients/database` workarounds this by `GROUP BY (lower(name), dob)`.
- A typo at intake (`"Smith, John"` vs `"Smith,John"`) produces two canonical groups.
- Two distinct people with the same `(name, dob)` are silently treated as ONE canonical patient.
- MRN lives in free-text `notes`, with no unique index.
- Phone has no unique index.
- No PCC ID, eCW ID, or TriZetto subscriber id is stored anywhere.

Batch 5 introduced the read-side `getCanonicalPatientByScreeningId` helper backed by `(lower(name), dob)`. Batch 7 designs the **upstream guard**: a matcher that runs at every identity-creation path and either confirms "this is patient X" or routes the row into a manual-review queue.

**This batch ships zero code.** It designs the matcher, defines the table shapes, captures the audit rules, and stops there.

---

## 2. v1 recommendation: NO auto-merge

Auto-merging two patient records is **catastrophic and irreversible** by the time it propagates:

- Scheduler assignments, journey events, billing records, invoices, and documents all reference `patient_screenings.id`. Merging two ids requires re-pointing every FK across ≥10 tables; the merge is functionally an FK rewrite, not a row update.
- A false-positive match combines two real people. Subsequent care, billing, and PHI access are now confused. **HIPAA implication.**
- A false-negative match leaves duplicates; cheaper to fix than a false positive.

**v1 recommendation:** zero auto-merging. Every match decision is **manual review** by a queueworker. The matcher's job is to surface candidates with a confidence score; a human approves the merge. The merge itself is implemented in a much later batch with full audit, reversibility, and explicit PHI sign-off.

**Out-of-scope for v1:**
- Background merge daemons.
- Automatic merging of even high-confidence matches.
- Cross-tenant matching (single-tenant only).

---

## 3. Match-key hierarchy

Two key families: **deterministic** (exact-match identifiers; high confidence) and **probabilistic** (fuzzy demographics; surfaced for review).

### 3.1 Deterministic keys

When ANY of these matches an existing row, the new record is flagged as a **certain match** and routed to manual review (still — see §2):

| Key | Notes |
| --- | --- |
| `(MRN, facility)` | MRN is currently in `patient_screenings.notes` free-text. The new `patient_identifiers` table (§4.3) is the canonical store. |
| `phone` (normalized to E.164) | Single phone per patient assumed; if multiple phones exist for one canonical patient, the table supports many-per-patient. |
| `(insurance_member_id, dob)` | Less reliable; insurance member ids change across years. |
| `(email_lower, dob)` | Optional; email is sparse. |
| `(pcc_id, facility)` | PointClickCare id, when imported. Not stored today. |
| `(ecw_id, facility)` | eClinicalWorks id, when imported. Not stored today. |
| `(trizetto_subscriber, dob)` | TriZetto clearinghouse id; not stored today. |

### 3.2 Probabilistic keys

When NO deterministic key matches, fall back to demographic comparison. Surface candidates for manual review when:

- DOB exact match (NEVER use fuzzy DOB).
- Facility exact match (using the future `facility_id` from Batch 6).
- Name similarity (Jaro–Winkler ≥ 0.92 on `(lower(first), lower(last))` after diacritic stripping).
- Optionally: phone last-4 match.

The matcher computes a confidence score:

- **≥ 0.90:** "very likely same person" — manual review, top of queue.
- **0.70–0.90:** "possibly same person" — manual review, lower priority.
- **< 0.70:** "no match" — proceed as a new row.

**Confidence thresholds are configurable** via admin settings; the defaults above are not load-bearing.

---

## 4. Future table shapes (commented; NOT shipped as SQL)

### 4.1 `patient_directory` (from Batch 5 design doc §6)

See `docs/architecture/patient-directory-design.md` §6 for the canonical-identity table DDL. This batch reuses that design and assumes it exists by the time the matcher ships.

### 4.2 `patient_match_decisions` — the audit table

```sql
-- Future table: every decision the matcher makes (auto-create, manual,
-- merge, reject) is recorded here. Append-only.
--
-- CREATE TABLE patient_match_decisions (
--   id                    SERIAL PRIMARY KEY,
--   decision_at           TIMESTAMP NOT NULL DEFAULT now(),
--   decided_by_user_id    VARCHAR REFERENCES users(id) ON DELETE SET NULL,
--   kind                  TEXT NOT NULL,             -- 'auto_new' | 'manual_review' | 'manual_merge' | 'manual_reject' | 'reversed'
--   source_path           TEXT NOT NULL,             -- 'manual_entry' | 'file_import' | 'text_import' | 'clinical_import' | 'seed'
--   incoming_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
--   matched_directory_id  TEXT REFERENCES patient_directory(id) ON DELETE SET NULL,
--   candidate_ids         JSONB NOT NULL DEFAULT '[]',  -- ranked candidate list at decision time
--   confidence            NUMERIC(4,3),              -- 0.000 to 1.000
--   inputs_hash           TEXT NOT NULL,             -- sha256 of normalized inputs that drove the decision
--   reason                TEXT,                      -- free-form note from reviewer
--   reversed_decision_id  INTEGER REFERENCES patient_match_decisions(id) ON DELETE SET NULL,
--   created_at            TIMESTAMP NOT NULL DEFAULT now()
-- );
--
-- CREATE INDEX patient_match_decisions_kind_idx     ON patient_match_decisions (kind);
-- CREATE INDEX patient_match_decisions_decided_at_idx ON patient_match_decisions (decision_at DESC);
-- CREATE INDEX patient_match_decisions_directory_idx ON patient_match_decisions (matched_directory_id);
```

Every decision MUST land in this table. Reversals create a NEW row with `kind = 'reversed'` and `reversed_decision_id` pointing at the original — never delete or update an existing row.

### 4.3 `patient_identifiers` — cross-system identity (mirrors review §3.2)

```sql
-- Future table: cross-system identity tied to a canonical directory row.
--
-- CREATE TABLE patient_identifiers (
--   id                  SERIAL PRIMARY KEY,
--   directory_id        TEXT NOT NULL REFERENCES patient_directory(id) ON DELETE CASCADE,
--   kind                TEXT NOT NULL,           -- 'mrn' | 'phone_e164' | 'email' | 'pcc' | 'ecw' | 'trizetto_subscriber'
--   value_normalized    TEXT NOT NULL,           -- lowercased / digits-only / E.164
--   value_raw           TEXT,                    -- as captured at intake (for audit)
--   facility_id         INTEGER REFERENCES facilities(id) ON DELETE SET NULL, -- for MRN/PCC/eCW (scoped per facility)
--   source              TEXT NOT NULL,           -- 'manual' | 'file_import' | 'clinical_import' | 'matcher_inferred'
--   created_at          TIMESTAMP NOT NULL DEFAULT now()
-- );
--
-- CREATE UNIQUE INDEX patient_identifiers_mrn_facility_idx
--   ON patient_identifiers (kind, value_normalized, facility_id) WHERE kind IN ('mrn', 'pcc', 'ecw');
-- CREATE UNIQUE INDEX patient_identifiers_phone_global_idx
--   ON patient_identifiers (kind, value_normalized) WHERE kind = 'phone_e164';
-- CREATE INDEX patient_identifiers_directory_idx ON patient_identifiers (directory_id);
```

Partial unique indexes enforce the deterministic-match keys (§3.1). Conflicts are surfaced by the matcher (or, after rollout, by an insert-time integrity error).

### 4.4 `patient_match_queue` — operator-facing review

```sql
-- Future table: queue of pending manual-review decisions.
--
-- CREATE TABLE patient_match_queue (
--   id                    SERIAL PRIMARY KEY,
--   created_at            TIMESTAMP NOT NULL DEFAULT now(),
--   status                TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'in_review' | 'decided' | 'expired'
--   priority              INTEGER NOT NULL DEFAULT 50,       -- 0 (lowest) to 100 (highest); confidence drives this
--   incoming_screening_id INTEGER NOT NULL REFERENCES patient_screenings(id) ON DELETE CASCADE,
--   candidate_directory_ids JSONB NOT NULL DEFAULT '[]',     -- ranked candidates
--   max_confidence        NUMERIC(4,3),
--   reserved_by_user_id   VARCHAR REFERENCES users(id) ON DELETE SET NULL,
--   reserved_at           TIMESTAMP,
--   resolved_decision_id  INTEGER REFERENCES patient_match_decisions(id) ON DELETE SET NULL,
--   sla_due_at            TIMESTAMP                          -- when this row goes stale (queue-worker SLA)
-- );
--
-- CREATE INDEX patient_match_queue_status_priority_idx ON patient_match_queue (status, priority DESC);
-- CREATE INDEX patient_match_queue_sla_idx             ON patient_match_queue (sla_due_at) WHERE status IN ('pending', 'in_review');
```

The reviewer claims a queue item (`status = 'in_review'`, `reserved_by_user_id` set), inspects candidates, and writes a `patient_match_decisions` row resolving it. The queue row's `resolved_decision_id` then points back.

---

## 5. Matcher input contract

```ts
// Future: server/modules/patient-matcher/contracts.ts
//
// type MatcherInput = {
//   sourcePath: "manual_entry" | "file_import" | "text_import" | "clinical_import" | "seed";
//   incomingScreeningId: number; // the just-inserted patient_screenings.id
//   facilityId: number;
//   identifiers: {
//     name: string;
//     dob: string | null;
//     phone?: string;       // normalized to E.164 BEFORE this call
//     email?: string;       // lowercase
//     mrn?: string;
//     pccId?: string;
//     ecwId?: string;
//     trizettoSubscriber?: string;
//   };
//   inputsHash: string;    // sha256 of normalized identifiers (audit anchor)
// };
//
// type MatcherOutput =
//   | { kind: "no_match"; confidence: 0 }
//   | { kind: "manual"; candidates: CandidateMatch[]; maxConfidence: number; queueId: number };
// // NOTE: "auto" is INTENTIONALLY ABSENT in v1.
//
// type CandidateMatch = {
//   directoryId: string;
//   confidence: number;     // 0 to 1
//   reasons: string[];      // e.g. ["mrn_facility_exact", "name_jw_0.96"]
// };
```

**The output kind union has only two variants in v1.** Adding `"auto"` is a separate, gated change (Batch 7c+).

---

## 6. Per-source-path runtime sequence

```
1. Identity-creation route runs as today (inserts patient_screenings row).
2. After insert, matcher is invoked synchronously with the normalized inputs.
3. Matcher writes a patient_match_decisions row with kind "auto_new" or
   "manual_review", depending on output.
4. For "manual_review", matcher writes a patient_match_queue row.
5. The newly-inserted patient_screenings row is RETURNED TO THE CLIENT
   unchanged. The matcher decision is async-resolved later.
6. A reviewer dashboard (future UI) consumes patient_match_queue and
   resolves each row.
```

The matcher MUST NOT delay the response. Even a "manual" decision lets the operator proceed; the merge (or rejection) happens later.

---

## 7. Reverse-merge / un-merge procedure

Merges are recorded in `patient_match_decisions` (kind `manual_merge`). Reversal:

1. Reviewer opens a "Reverse merge" UI keyed on a `patient_match_decisions.id`.
2. The system creates a NEW `patient_match_decisions` row with `kind = 'reversed'` and `reversed_decision_id` set.
3. The merged patient's `patient_screenings.directoryId` (future column) is re-pointed to a freshly-allocated `patient_directory` row carrying the orphaned screening's identifiers.
4. **Side effects of the original merge are NOT automatically un-done.** Scheduler assignments, journey events, billing records that were re-pointed during the merge MUST be reviewed manually. The reverse-merge UI surfaces them as a checklist.
5. An audit log entry (separate from `patient_match_decisions`) records the un-merge actor, reason, and the new directory_id.

**The reverse-merge SLA is intentionally manual.** Auto-reverse would multiply the false-positive blast radius.

---

## 8. Audit requirements

Every matcher decision MUST log (in `patient_match_decisions`):

- The actor (user id or `null` for system-initiated).
- The decision kind.
- The source path (so we can attribute false positives to a specific intake flow).
- The candidate list at decision time (so future audits see what was on screen).
- The confidence score (numeric, not enum-bucketed; the bucketing happens at render time).
- An inputs_hash (sha256 of the normalized identifiers) — lets us detect when the same input was re-decided differently (drift detector).
- The reviewer's free-form note (`reason`).
- For reversals, `reversed_decision_id`.

`patient_match_decisions` is **append-only** by policy AND by lack of an `UPDATE` route. Never expose an update endpoint.

---

## 9. Feature flag

`PATIENT_MATCHER_ENABLED` (env var; default OFF).

- When OFF: identity-creation routes behave exactly as today. No matcher call. No new rows in `patient_match_decisions` or `patient_match_queue`. Used by tests and rollback.
- When ON in shadow-mode (`PATIENT_MATCHER_SHADOW=1`): matcher runs but ONLY writes `patient_match_decisions`. No queue rows surface in the operator UI. Lets us calibrate confidence thresholds in production before enabling reviewer workflow.
- When ON full: queue rows surface; reviewer dashboard is reachable; merge actions are enabled.

Three flag states, two distinct phases. Implementation batches MUST ship the flag as OFF; turning it on is a separate ops decision.

---

## 10. Compatibility rules

- **No identity-write path is replaced.** All five routes in §1 keep inserting `patient_screenings` rows. The matcher fires AFTER the insert.
- **No existing route's response shape changes.** Even if a manual-review queue row is written, the route response continues to be the inserted patient row (unchanged shape).
- **No silent merges.** The matcher never modifies an existing `patient_screenings` row's identity or removes a row. Merges are explicit operator actions, in a separate batch with their own UI.
- **`VALID_FACILITIES` and the parser canonicalization stay intact.** Batch 6's facility canonicalization is a prerequisite for the matcher's facility-scoped MRN/PCC/eCW keys, but the matcher does not edit those.

---

## 11. Hard protected areas — none touched

| Area | Touched? | Why |
| --- | --- | --- |
| Patient qualification logic | no | Matcher reads identifiers only. |
| Plexus IQ qualification flow | no | Unaffected. |
| Plexus IQ import | yes-later | Phase 1 implementation will invoke matcher AFTER the insert. The insert itself is unchanged. |
| Admin Review reasoning behavior | no | Reasoning is separate from identity. |
| Supporting button assignment logic | no | Unaffected. |
| Canonical reasoning shape | no | Unaffected. |
| Plexus packets / Clinician packets / PDFs | no | PDFs read the screening row; matcher doesn't alter it. |
| Selected patient PDF actions | no | Unaffected. |
| Scheduler-to-patient assignment correctness | no in design; touched only by reverse-merge (manual) | Merge actions re-point scheduler-assignment FKs and require manual review checklist. |
| Patient-to-scheduler assignment persistence | no | Unaffected by detection; only affected by manual merge. |
| Report/document source data used by PDFs | no | Unaffected. |
| Billing / invoice correctness | no in design; touched only by reverse-merge (manual) | Same — merge actions re-point billing_records FKs. Manual review. |

---

## 12. Risks acknowledged

- **False-positive merges.** v1 hard-stops this by mandating manual review of every match decision. Even high-confidence matches require human approval.
- **PHI exposure in the queue UI.** Queue rows surface candidate patient demographics to the reviewer. The reviewer dashboard must enforce role-gating (`requireAdmin` or a new `requireMergeReviewer` middleware) and never expose the queue to non-clinical roles.
- **inputs_hash drift.** When the matcher's normalization rules change (e.g., a new diacritic stripper), the inputs_hash for the same logical input changes. The audit table's drift detector must tolerate this — possibly versioning the matcher with `matcher_version` text on each decision row.
- **Queue backlog.** If matcher confidence calibration is off, the queue can grow faster than reviewers process it. Shadow mode (§9) exists to calibrate before any reviewer sees anything.
- **Audit log volume.** Every identity-creation path will produce a `patient_match_decisions` row. For the test-fixture path (`script/seed*.ts`), a `system_seed` actor + sampling rate should be used to avoid swamping the table.

---

## 13. Phased rollout

| Phase | Ships |
| --- | --- |
| **7 (this batch)** | Design + table DDL (commented). No code. |
| **7a** | Add `patient_match_decisions`, `patient_match_queue`, `patient_identifiers` schema. Migration. Flag stays OFF. |
| **7b** | Implement matcher in shadow mode (`PATIENT_MATCHER_SHADOW=1`). Decision rows accumulate; no queue surface. Calibrate confidence thresholds. |
| **7c** | Reviewer dashboard UI. Read-only. Flag still OFF in production. |
| **7d** | Enable manual-review queue in staging. Reviewer trains on real candidates. Flag selectively ON. |
| **7e** | Enable manual-merge action. Side-effect checklist UI for FK re-point. |
| **7f** | Enable reverse-merge action. |

Each phase is a separate PR with its own approval. The cutover does NOT skip phases.

---

## 14. Rollback plan (per phase)

| Phase | Rollback |
| --- | --- |
| 7a (schema) | Drop the three tables. Migration is reversible; the tables have no FK from elsewhere in this phase. |
| 7b (shadow matcher) | Set `PATIENT_MATCHER_SHADOW=0` and `PATIENT_MATCHER_ENABLED=0`. Decision-writing stops. Historical rows retained for forensics. |
| 7c (reviewer UI) | Disable the UI route registration; rebuild. |
| 7d (queue surface) | Set `PATIENT_MATCHER_ENABLED=0`. Existing queue rows persist; the surface goes away. |
| 7e (manual merge) | Hide the merge action; the queue continues to surface candidates. Existing merges stay until reversed. |
| 7f (reverse merge) | Hide the action. |

---

## 15. Stop conditions for follow-up batches

A future batch MUST stop and ask if:

1. ANY proposal includes auto-merging without manual approval — even for "very high confidence" matches.
2. ANY proposal makes the matcher synchronous-blocking on the identity-creation response (the route must return the new screening row regardless of matcher outcome).
3. The reviewer UI surfaces queue rows to a non-clinical role.
4. `patient_match_decisions` gains an `UPDATE` route. The table must remain append-only.
5. A merge action skips the side-effect checklist (FK re-point of scheduler_assignments, journey_events, billing_records, documents).
6. A reverse-merge action attempts to auto-restore side effects.
7. Shadow mode is bypassed in production (skipping calibration is the fastest path to false positives).
8. Schema changes precede the matcher implementation in the same PR. Schema first, code later — each its own approval.

---

## 16. Cross-references

- `docs/architecture/patient-directory-design.md` — the canonical-identity table this batch's matcher targets.
- `docs/architecture/facilities-design.md` — facility canonicalization that scopes the MRN/PCC/eCW keys.
- `docs/architecture/canonical-spine.md` §3.1, §3.2.
- `docs/architecture/full-21-batch-orchestrator-review.md` Batch 7.
- `server/routes/plexusIqClinicalImport.ts:35` — `buildClinicalImportNotes`, where MRN currently lives.
- `server/routes/batches.ts:133, 184, 257` — the other three live identity-creation paths.

End of design.
