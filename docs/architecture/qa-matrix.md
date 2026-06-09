# QA matrix — protected-flow coverage (Batch 21)

**Branch:** `architecture/batch-21-qa-matrix`
**Date:** 2026-06-09
**Scope:** Docs + two additive QA scripts. No app source touched. No existing QA script modified. No fictional fixtures (the new scripts are source-code invariant checks).

> Cross-reference: `docs/architecture/protected-flows.md`, `docs/architecture/do-not-touch.md`, `docs/architecture/pdf-protection-contract.md`, `docs/architecture/backend-route-parity-inventory.md`, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 21.

---

## 0. How this matrix is used

1. **Before opening any refactor PR**, find the protected flow(s) the PR touches. Confirm every checked column for that flow has either an automated script that runs in CI, OR a manual checklist item in the PR description.
2. **Automated > manual**, always. If a manual check appears here, treat it as a gap that future Batch 21 sub-batches (21a, 21b, ...) should close.
3. **No fictional patient PHI** in any QA script. The two new scripts in this batch are source-code invariant checks; they read repo files, not the database.

---

## 1. Coverage matrix

| Protected flow | Source ref | Existing automated QA script | New automated check (this batch) | Manual checklist owner | Gap status |
| --- | --- | --- | --- | --- | --- |
| Global navigation, dock, home tiles | `docs/architecture/protected-flows.md` §1 | `scripts/qa-navigation-dock-home-tiles.mjs` | — | — | covered |
| Command Center architecture | §2 | `scripts/qa-command-center-architecture.mjs` | — | — | covered |
| Visit / Outreach tile parity | §3 | `scripts/qa-visit-outreach-tile-parity.mjs` | — | — | covered |
| Plexus IQ workspace + calendar + sidebar | §4 | `scripts/qa-plexus-iq-interior.mjs` | — | — | covered |
| Plexus IQ qualification-jobs backend | §5 | `scripts/qa-plexus-iq-backend.mjs` | — | — | covered |
| Team Portals restore (PR-#46 reference flow) | §6 | `scripts/qa-team-portals-restore.mjs` | — | — | covered |
| Team Portal workspace engine | §7 | `scripts/qa-team-portal-workspace-engine.mjs` | — | — | covered |
| Engagement assignment runtime | §8 | `scripts/qa-engagement-assignment-runtime.mjs` | — | — | covered |
| Admin Review evidence panel | parity-inventory §1.1 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21b candidate** |
| Admin Review supplemental regenerate | parity-inventory §1.2 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21c candidate** |
| Admin Review regenerate-all | parity-inventory §1.3 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21c candidate** |
| Admin Review regenerate-ancillary | parity-inventory §1.4 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21c candidate** |
| Admin Review regenerate-test | parity-inventory §1.5 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21c candidate** |
| Admin Review remove-test / remove-ancillary | parity-inventory §1.6, §1.7 | (none) | — | PR `Admin Review manual checklist` | **gap — Batch 21c candidate** |
| Admin Review ICD search PHI-safe logging | parity-inventory §1.8 | (none — log-shape assertion is in `qa-plexus-iq-backend.mjs` block at lines 87–92) | — | PR `force AI error + verify log shape` | partial (assertion via existing script) |
| Admin Review approval pipeline (commit + scheduler routing) | parity-inventory §1.9 | (none) | — | PR `commit + engagement assignment routing checklist` | **gap — Batch 21d candidate (highest priority)** |
| Plexus IQ clinical import (bulk insert) | parity-inventory §3.1 | `scripts/qa-plexus-iq-backend.mjs` (route + helper assertions) | — | PR `bulk import 3 groups × 5 rows + 2 skips` | partial |
| Engagement Center board read | parity-inventory §4.1 | `scripts/qa-engagement-assignment-runtime.mjs` | — | PR `sort-order parity` | partial |
| Engagement bulk assignment + conflict guard | parity-inventory §4.2 | `scripts/qa-engagement-assignment-runtime.mjs` | — | PR `dupe-conflict assertion` | partial |
| Patient packet endpoint (`/api/patient-packet` + aliases) | parity-inventory §7 | (none) | — | PR `three-lookup parity` | **gap — Batch 21e candidate** |
| Document library (incl. legacy migration-on-read) | parity-inventory §8.1 | (none) | — | PR `Drive→S3 fallback redirect` | **gap — Batch 21e candidate** |
| Billing list (auto-create scan) | parity-inventory §9.1 | (none) | — | PR `dual-GET no-duplicate-create` | **gap — Batch 21f candidate** |
| Invoice create / payment / email | parity-inventory §9.7 | (none) | — | PR `invoice email send + markInvoiceSent + 409 race` | **gap — Batch 21f candidate** |
| Patient directory roster | parity-inventory §10.1 | (none) | — | PR `roster row count` | **gap — Batch 21e candidate** |
| **PDF protection invariants** (ICD not rendered in either PDF) | `pdf-protection-contract.md` §3.4 | — | **`scripts/qa-pdf-protection-invariants.mjs` (new)** | — | **covered by this batch** |
| **Architecture docs folder integrity** (file deletion tripwire) | this doc | — | **`scripts/qa-docs-architecture-integrity.mjs` (new)** | — | **covered by this batch** |

---

## 2. Existing QA scripts — what each one actually asserts

| Script | Asserts |
| --- | --- |
| `qa-navigation-dock-home-tiles.mjs` | Global nav + dock + home-dashboard tile structure. |
| `qa-command-center-architecture.mjs` | Command Center composition. |
| `qa-visit-outreach-tile-parity.mjs` | Visit/Outreach tile parity (a structural rule that fell out of an earlier refactor). |
| `qa-plexus-iq-interior.mjs` | Plexus IQ workspace + calendar + day modal + hub composition. Also enforces the Admin Review supplemental-regenerate chain through `adminReviewSupplementalRegenerateService.ts` (updated by Batch 3b.3). |
| `qa-plexus-iq-backend.mjs` | The clinical import + qualification jobs route surface; admin-review handler set; AI helper structural contract. Updated by Batches 3b.4, 3b.5, 3b.6, 3b.7 to follow the wrapper indirection. |
| `qa-team-portals-restore.mjs` | Team Portal data wiring. |
| `qa-team-portal-workspace-engine.mjs` | Patient packet + tabs composition. |
| `qa-engagement-assignment-runtime.mjs` | Engagement board structural surface; conflict-guard literals. |

**Common pattern.** All eight existing scripts are **source-code invariant checks** (they read repo files; no DB, no app boot, no PHI). They use `requireText(rel, needles)` and `requireNotText(rel, needles, label)` helpers. New scripts in this batch follow the same pattern intentionally.

---

## 3. New automated checks shipped in this batch

### 3.1 `scripts/qa-pdf-protection-invariants.mjs`

Asserts the contract from `pdf-protection-contract.md` §3.4: ICD-10 codes are intentionally NOT rendered in either PDF body.

Specifically, both comment pairs:

- `client/src/lib/pdfGeneration.ts:403–405` (Clinician PDF body)
- `client/src/lib/pdfGeneration.ts:607–609` (Plexus PDF body)

must contain the substring `"ICD-10 codes are intentionally not rendered in either PDF"`. If either is missing, a future PR has silently removed the contract-anchoring comment and the script fails.

Also asserts:
- Both `generateClinicianPDF` and `generatePlexusPDF` exports remain present.
- The four required reasoning blob keys (`clinician_understanding`, `patient_talking_points`, `qualifying_factors`, `icd10_codes`) are referenced in `pdfGeneration.ts`.

### 3.2 `scripts/qa-docs-architecture-integrity.mjs`

A tripwire that prevents silent deletion of the architecture-docs folder. Specifically, asserts the existence of:

- `docs/architecture/review-canonical-spine-2026-06-09.md` (Batch 0 frozen review)
- `docs/architecture/full-21-batch-orchestrator-review.md` (Batch orchestrator)
- `docs/architecture/README.md`
- `docs/architecture/canonical-spine.md`
- `docs/architecture/protected-flows.md`
- `docs/architecture/dependency-map.md`
- `docs/architecture/refactor-batches.md`
- `docs/architecture/do-not-touch.md`
- `docs/architecture/backend-route-parity-inventory.md`
- `docs/architecture/pdf-protection-contract.md`
- `docs/architecture/team-task-spine-design.md`
- `docs/architecture/patient-directory-design.md`
- `docs/architecture/facility-string-inventory.md`
- `docs/architecture/facilities-design.md`
- `docs/architecture/patient-matching-design.md`
- `docs/architecture/billing-cleanup-design.md`
- `docs/architecture/qa-matrix.md`

If any of these files goes missing, a future PR has lost architectural memory. The script fails loudly so the reviewer asks why.

The script does NOT lock the content of any doc — only its existence. Content edits are allowed; deletion is not.

---

## 4. Sub-batch roadmap (gap closure)

Items flagged "gap" in §1 should be closed by future sub-batches. Suggested order:

| Sub-batch | Coverage added | Approach |
| --- | --- | --- |
| **21a (this batch)** | PDF invariants + docs integrity tripwires | Done. |
| **21b** | Admin Review evidence panel structural rules | Source-code invariant check on `AdminReviewDialog.tsx` ↔ `adminReviewEvidenceService.ts` chain. |
| **21c** | Admin Review regenerate handlers structural rules | Already partially present in `qa-plexus-iq-backend.mjs`. Add explicit per-handler chain checks. |
| **21d** | Admin Review approval pipeline (highest priority) | Source-code invariant check + a separate runnable integration test once Batch 3b.8 ships. |
| **21e** | Patient packet, document library, patient roster | Structural assertions only. |
| **21f** | Billing list, invoice creation/payment/email | Source-code structural assertions. |
| **21g** | Integration-test substrate (deferred) | Once a headless-browser substrate exists (likely a Playwright variant), promote `qa-pdf-baseline-snapshot.mjs` (mentioned in `pdf-protection-contract.md` §8) to a determinism-validated baseline. Out of this batch's scope. |

Each sub-batch is its own PR with its own approval.

---

## 5. PR-author "manual checklist" — paste this into any protected-flow-touching PR

If your PR touches any flow in §1, paste the relevant block from the master checklist into your PR description:

### Admin Review
```
- [ ] Open Admin Review on a patient with mixed-ancillary qualifying tests.
- [ ] Click every supporting button; UI matches pre-batch screenshot.
- [ ] Per-ancillary regenerate runs and updates only the chosen ancillary.
- [ ] Regenerate-all preserves admin-review overrides on sibling reasoning keys.
- [ ] Regenerate-test updates only the named test's canonical reasoning.
- [ ] Remove-test preserves canonical `reasoning[testName]`.
- [ ] Remove-ancillary preserves canonical `reasoning[testName]` for the removed tests.
- [ ] ICD chips render unchanged.
- [ ] Under-16 guardrails fire on a fictional 14-year-old.
- [ ] OpenAI regeneration completes one full request.
- [ ] Clinician PDF + Plexus PDF visual identity vs. pre-batch.
- [ ] "Updates Made In Patient" change log entries appear in identical order.
```

### Admin Review ICD search (PHI-safe logging)
```
- [ ] Trigger ICD search with a real query; results appear.
- [ ] Empty-query short-circuit returns `{ ok: true, results: [] }` for ≤1 char.
- [ ] Force an AI error (invalid API key) and confirm:
      * 500 envelope: `{ ok: false, error: "OpenAI universal ICD search failed", detail: "..." }`
      * Log line contains ONLY: patientId, queryLength, hasAIIntegrationsKey,
        hasOpenAIKey, hasBaseUrl, message. NO query content. NO PHI fields.
        NO API keys.
```

### Engagement Center
```
- [ ] Board loads with expected row count.
- [ ] Conflict-guard fires on a known same-name+same-DOB+same-scheduleDate dupe;
      the exact error format `Already assigned to <n> for <date>. Two schedulers
      cannot share the same patient for the same date.` appears in the toast.
- [ ] Bulk assign one row; journey_event row appears.
- [ ] Sort order: unassigned first, then nearest nextActionAt ascending,
      then most-recent lastActivityAt descending.
```

### Plexus IQ import
```
- [ ] Paste 3 groups × 5 rows with 2 forced skip rows.
- [ ] Response: `importedCount === 15`, `skippedCount === 2`,
      `batchIds.length === 3`, `errors.length === 2`.
- [ ] MRN visible in patient_screenings.notes for at least one imported row.
```

### Patient packet
```
- [ ] Query the endpoint with executionCaseId, patientScreeningId, and
      patientName+patientDob — all three return the same patient.
- [ ] All three aliases (`/api/patient-packet`, `/api/scheduler-portal/patient-packet`,
      `/api/technician-liaison/patient-packet`) return byte-identical bodies.
```

### Document library
```
- [ ] Upload a new document; appears in list.
- [ ] Read a Drive-backed legacy document; falls back to Drive presigned URL
      when local bytes missing.
- [ ] Migration-on-read runs idempotently (two GETs → no duplicate inserts).
```

### Billing list + invoice
```
- [ ] GET /api/billing-records twice; row count unchanged (no duplicate
      auto-creates).
- [ ] Create one invoice for a chosen facility + date range; line items match
      the filtered billing_records.
- [ ] Record a payment; totalBalance recomputes correctly.
- [ ] Cannot record a payment on a Draft invoice (400 response).
- [ ] Send invoice email; 14 MB base64 cap holds; `markInvoiceSent` runs;
      the 409 race response surfaces when the invoice is deleted between
      send + update.
```

---

## 6. Hard protected areas — verification

| Area | Touched by this batch? |
| --- | --- |
| Patient qualification logic | no |
| Plexus IQ qualification flow | no |
| Admin Review runtime | no |
| Supporting button assignment logic | no |
| Canonical reasoning shape | no |
| Plexus packets / Clinician packets / PDFs | no (the new script READS pdfGeneration.ts but does not modify it) |
| Selected patient PDF actions | no |
| Scheduler-to-patient assignment correctness | no |
| Patient-to-scheduler assignment persistence | no |
| Report/document source data used by PDFs | no |
| Billing / invoice correctness | no |

---

## 7. Stop conditions for future sub-batches (21b–21g)

A future sub-batch MUST stop and ask if:

1. A new QA script uses real patient names / DOBs / phones / MRNs / emails. **Use fictional data only.**
2. A new QA script depends on a live DB or live network. **Source-code invariant checks only**, until Batch 21g introduces the integration-test substrate.
3. A new QA script is flaky on back-to-back runs. **Determinism is a hard requirement.**
4. A sub-batch silently modifies an existing QA script's intent rather than adding new asserts. Modifications must follow the wrapper-indirection pattern already in use (Batches 3b.3, 3b.5, 3b.7).
5. A sub-batch removes any existing QA script. Removals require explicit approval; deprecation flagged in this matrix first.
6. A sub-batch attempts to "test" admin-approval (Batch 3b.8 / parity-inventory §1.9) via source-code grep alone. The approval handler triggers `commitPatient(auto: true)` + scheduler routing; a real integration test is required, not a literal check.

---

## 8. Cross-references

- `docs/architecture/protected-flows.md` — the canonical protected-flow list.
- `docs/architecture/pdf-protection-contract.md` §3.4 — the ICD invariant tested by the new PDF script.
- `docs/architecture/backend-route-parity-inventory.md` — the per-route parity contracts that the gap rows reference.
- `docs/architecture/full-21-batch-orchestrator-review.md` Batch 21 — the orchestrator entry.

End of matrix.
