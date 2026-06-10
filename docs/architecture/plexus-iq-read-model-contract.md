# Plexus IQ aggregate read-model contract

**Status:** Docs-only (Bundle 25). No code added. No runtime change.
**Date:** 2026-06-09.
**Scope:** Pin the contract a future Plexus IQ aggregate read endpoint MUST satisfy so it cannot reshape, re-derive, or re-rank the canonical reasoning, qualifying factors, supporting buttons, or Admin Review state today's UI depends on.
**Related:**
- `protected-flows.md` (Plexus IQ + Admin Review listed as load-bearing).
- `do-not-touch.md` (AdminReviewDialog.tsx + plexusIq/* services).
- `pdf-protection-contract.md` (the reasoning blob the PDF consumes).
- `team-portal-playground-wiring-contract.md` §17 (Patient Packet wiring is hard-stop).
- `team-task-spine-design.md` and `patient-directory-design.md` (the dormant read-only module pattern).

This contract does NOT add the read endpoint. It defines the rules every future PR that proposes one must obey.

---

## 1. Why the contract exists

Plexus IQ's read surface is fragmented today:

- `GET /api/patient-screenings` returns rows by facility/batch.
- `GET /api/patient-screenings/:id/admin-review/evidence` returns the rule-engine output.
- `GET /api/patient-screenings/:id` returns the screening row with its `reasoning` blob.
- The Admin Review modal composes these in the client, plus several per-ancillary regenerate endpoints.

A future aggregate endpoint (`GET /api/plexus-iq/patient/:id` or similar) would compose these server-side so a single round trip carries the row + reasoning + evidence + supporting-button context the modal needs.

The risk: any aggregate that re-derives instead of forwards can silently change the *semantics* of qualification. This contract prevents that.

---

## 2. Scope and out-of-scope

In scope:

- The fields the aggregate response carries.
- The forwarding rules — what counts as "forwarded verbatim" vs "re-derived".
- The hard-stop areas the aggregate must not touch.
- The cutover sequence (mirrors the operational-queue / patient-directory pattern).

Out of scope:

- The aggregate endpoint's exact route name and HTTP method.
- The aggregate endpoint's auth surface — uses the same auth gate as the underlying routes; no new auth shape introduced.
- AI prompt or model changes.
- Schema migrations.
- UI changes.

---

## 3. Hard-stop fields

The aggregate response MUST forward these fields **byte-identical** from the underlying source. The aggregate may not re-shape, re-compute, re-rank, or re-format them. If any of these fields drift, the future PR is non-compliant.

### 3.1 From `patient_screenings`

- `id`
- `name`, `dob`, `phoneNumber`, `email` (raw row values)
- `facility`, `patientType`
- `commitStatus`, `committedAt`, `committedByUserId`
- `adminApprovalStatus`, `adminApprovedAt`, `adminApprovedByUserId`, `adminApprovalNote`
- `qualifyingTests` (the array as written by AI / batch analysis)
- `cooldownTests` (whatever the qualification spine has set)
- `reasoning` (the canonical JSON blob — see §4)
- `diagnoses`, `history`, `medications`, `previousAncillaries`, `insurance`
- `status`

### 3.2 From the rule engine

- `evidence` shape exactly as `GET /api/patient-screenings/:id/admin-review/evidence` returns it. The aggregate may CACHE the evidence call but MUST NOT alter its body.

### 3.3 From the Admin Review supplemental metadata

- `reasoning["adminReview:<ancillaryId>"]` keys (the per-ancillary regenerate metadata appended by the `/admin-review/regenerate` and `/admin-review/regenerate-ancillary` endpoints).
- `reasoning["adminReview:<ancillaryId>"].evidenceSnapshot` (the cached evidence at the time of regenerate).
- Supporting-button state: any field the Admin Review modal reads to decide which buttons to render.

### 3.4 From `patient_execution_cases`

- `engagementStatus`, `engagementBucket`, `commitStatus`, `assignedTeamMemberId`, `assignedRole`, `lifecycleStatus`.

---

## 4. The canonical reasoning blob

The `reasoning` JSON blob on `patient_screenings` is the source of truth for:

- AI qualification rationale per ancillary.
- Admin Review override reasoning per ancillary (under `adminReview:<id>` keys).
- Supporting-button enable/disable signals.
- ICD chips rendered in the modal (under each ancillary's `icdChips` array).
- Under-16 guardrails (the modal reads a `guardrails` slice).

The aggregate endpoint MUST forward the entire `reasoning` blob without re-keying, re-ordering, or stripping keys it does not recognise. Forward-compatibility for unknown keys is non-negotiable: any future qualification field added by AI prompt changes must reach the modal unchanged.

The aggregate endpoint MUST NOT:

- Re-run any qualification or regenerate logic to "freshen" `reasoning` on read. Reads are read-only.
- Strip `evidenceSnapshot` to save bytes — the snapshot is load-bearing for the modal's Re-evaluate button.
- Merge `reasoning` with `evidence` into a single derived field. The two shapes are kept distinct because Admin Review needs to compare them.

---

## 5. PHI safety

The aggregate's logs MUST follow the PHI-safe logger contract (Bundle 8 / PR #89). Specifically:

- Log lines may carry `patientScreeningId` (numeric) only when the log is part of the existing audit trail (`patient_journey_events` writes). Ad-hoc info logs MUST NOT carry the id.
- Patient name, DOB, MRN, insurance, diagnosis, raw row, raw `reasoning`, raw `evidence` — never logged.
- Any cache-hit / cache-miss log is counts-only.

---

## 6. Gates the future read-model PR satisfies

1. The aggregate endpoint is **additive** — no existing route is changed or removed in the same PR.
2. The endpoint lives behind a feature flag (`USE_PLEXUS_IQ_AGGREGATE_READ` reserved). Default OFF.
3. A no-DB parity-fixture test under `server/modules/plexus-iq/__tests__/aggregate-read-parity.test.ts` encodes the forwarding rule from §3 and asserts byte-for-byte equivalence on a canned fixture.
4. A QA wrapper `scripts/qa-plexus-iq-aggregate-read.mjs` mirrors `scripts/qa-shadow-read-parity-log-schema.mjs` and pins:
   - The forwarding rule (every §3 field MUST appear in the aggregate response).
   - The PHI prohibition list.
   - The flag-default-OFF invariant.
5. A staging gate analogous to `operational-queue-staging-runbook.md` §7 — 7 consecutive days of canned-fixture pass before any production flag flip is considered.
6. Admin Review modal source files (`AdminReviewDialog.tsx`, `PatientPdfActions.tsx`, `AdminApprovalControl.tsx`) are UNTOUCHED by the read-model PR. The modal adopts the aggregate endpoint only after the gates pass and via a separate UI PR.

---

## 7. Stop conditions for the future read-model PR

The PR MUST stop and ask if:

1. The aggregate response would re-shape any §3 field.
2. The aggregate would re-run qualification, regenerate, or rule-engine logic at read time.
3. The aggregate would merge `reasoning` with `evidence` or strip any reasoning key.
4. The PR also touches `AdminReviewDialog.tsx`, `AdminApprovalControl.tsx`, `PatientPdfActions.tsx`, the qualification AI services (`server/services/plexusIq/*`), or any qualification helper.
5. The PR removes any existing Plexus IQ endpoint.
6. The PR adds a write path. The aggregate is read-only.
7. The PR flips a feature flag default in any environment.
8. The PR includes a migration or AI prompt change.
9. The PR's response shape would change for any caller.
10. The PR's logs carry PHI identifiers.

---

## 8. Non-promises

- This contract does NOT specify the aggregate's HTTP route name. The future PR may use `GET /api/plexus-iq/patient/:id`, `GET /api/patient-screenings/:id/aggregate`, or any other additive path — but it MUST keep the existing routes untouched.
- This contract does NOT specify pagination or batching. The aggregate is per-patient.
- This contract does NOT specify caching strategy. The future PR may add a same-request memo (e.g., re-using the rule-engine output across forwarded fields) but cache invalidation is its own design decision.
- This contract does NOT replace `pdf-protection-contract.md`. The PDF still reads from the existing reasoning blob; the aggregate is for the modal, not the PDF.

End of contract.
