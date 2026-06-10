# Qualification structure cleanup — design

**Status:** Docs-only (Bundle 31). No code added. No runtime behavior change.
**Date:** 2026-06-09.
**Scope:** Describe the eventual cleanup of how qualification logic, canonical reasoning, qualifying factors, supporting buttons, and regeneration boundaries are organised. This is a SPECIFICATION, not an implementation. Every change it describes is for a future explicitly approved PR; this bundle ships zero code.
**Cross-references:**
- `admin-review-approval-commit-inventory.md` (Bundle 30 — pipeline inventory).
- `plexus-iq-read-model-contract.md` (Bundle 25 — forwarding rule).
- `pdf-protection-contract.md` (the reasoning blob the PDF consumes).
- `protected-flows.md` + `do-not-touch.md`.
- `full-21-batch-orchestrator-review.md` Batch 8 ("Qualification structure cleanup") and Batch 15 ("Admin Review modularization").

---

## 1. What "qualification structure" means today

The qualification surface is fragmented across:

- **AI services**: `server/services/screening.ts` (`screenSinglePatientWithAI`), `server/services/batchAnalysisRunner.ts`, `server/services/plexusIq/adminReviewRuleEngine.ts`, `server/services/plexusIq/adminReviewAiRegeneration.ts`, `server/services/plexusIq/adminReviewIcdSearch.ts`.
- **Routes**: `server/routes/patients.ts` (analyze, commit, admin-review evidence, admin-review regenerate, regenerate-all, regenerate-ancillary, ICD search).
- **Persistence**: `patient_screenings.reasoning` (canonical blob), `patient_screenings.qualifyingTests` (array), `patient_screenings.cooldownTests`, `patient_execution_cases.engagementBucket` (derived).
- **Client**: `client/src/components/qualification/AdminReviewDialog.tsx` (4,230 lines), `AdminApprovalControl.tsx`, `PatientPdfActions.tsx`, `ChangeEngagementAssignmentDialog.tsx`, `client/src/lib/adminReviewStatus.ts`.

The fragmentation works today, but it makes three things hard:
1. Adding a new qualifying factor without touching all four layers.
2. Verifying the modal's "supporting buttons" enable/disable rules without manually clicking through.
3. Reasoning about the regeneration boundary (which fields a regenerate may overwrite vs preserve).

This design does not refactor; it pins the cleanup contract so a future series of PRs can move toward it without changing behavior in any single step.

---

## 2. Design principles

The cleanup obeys the same principles every architecture bundle has obeyed so far:

- **Read paths first, writes second.** A read-side aggregation (Bundle 25's contract) is the first cleanup; write-side splitting comes later.
- **No drift.** Every move is a pure relocation: the same string, the same key, the same blob shape. The fixture-pinned canonical reasoning blob is the source of truth.
- **Behind a flag if anything moves at runtime.** Default OFF. Mirrors the `USE_OPERATIONAL_QUEUE_CALL_LIST` pattern.
- **Audit trail preserved.** Every regenerate / approve writes a `patient_journey_events` row; the cleanup MUST NOT change the event shape or the write order.
- **Admin Review modal is the LAST thing touched.** PRs 1 through N-1 of the cleanup add new modules, helpers, and contracts. PR N is the modal adopting them, and it ships only after a UI-walkthrough sign-off.

---

## 3. Target structure

### 3.1 Server-side modules

```
server/modules/qualification/
  contracts.ts        ← QualifyingFactor, ReasoningBlob, SupportingButtonState
  rules.ts            ← Pure rule helpers — under-16 guard, ICD-coverage helpers
  reasoning-blob.ts   ← Pure helpers that READ the reasoning blob (no writes)
  evidence-cache.ts   ← Read-only memoization key shape

server/modules/admin-review/
  contracts.ts        ← AdminApprovalStatus, AdminReviewState
  read-aggregator.ts  ← The Bundle 25 aggregate read contract (dormant)
  audit-shapes.ts     ← Journey-event shapes for admin_approval_updated
```

Both new module trees are DORMANT — no route imports them in the cleanup's early PRs. The dormancy invariant follows the same pattern as `scripts/qa-engagement-board-dormant-service.mjs` (Bundle 23).

### 3.2 Shared contracts

```
shared/contracts/qualifyingFactor.ts ← single source of truth for the
                                       qualifying-factor row shape
shared/contracts/reasoning.ts        ← structural type for reasoning blob
shared/contracts/adminReviewStatus.ts ← already exists (Batch 2 / PR #53)
```

`shared/contracts/reasoning.ts` is type-only. Importing it from any runtime file is allowed; importing the schema is NOT.

### 3.3 Client-side hooks (Batch 4 territory)

`client/src/hooks/api/admin-review.ts` already exists (Batch 4 plan in orchestrator). The cleanup formalises:

- One hook per query/mutation in `AdminReviewDialog.tsx`. No new JSX, no test-id change.
- A new `useReasoningBlob(patientScreeningId)` selector hook that wraps the canonical reasoning blob with typed accessors.
- Per-ancillary state grouped into a `useSupportingButtonsForAncillary(patientScreeningId, ancillaryId)` selector.

The selectors are PURE — no fetching themselves; they read from React Query's cache.

---

## 4. Regeneration boundary

The cleanup makes the regeneration boundary explicit.

### 4.1 Inputs each regenerate path accepts

- `regenerate` (single ancillary): patient id, ancillary id, optional evidence overrides.
- `regenerate-all`: patient id, optional set of ancillary ids to skip.
- `regenerate-ancillary`: same as `regenerate` with stricter ancillary-id validation (the existing route variant).

### 4.2 Fields each regenerate path may write

The cleanup pins, per ancillary `<id>`:

- `reasoning.adminReview:<id>` — the regenerate metadata blob.
- `reasoning.adminReview:<id>.evidenceSnapshot` — cached evidence.
- `reasoning.adminReview:<id>.modelMetadata` — model version, prompt hash, timestamps.

The regenerate path may NOT write:

- `qualifyingTests` (AI analyze owns this).
- `cooldownTests`.
- The top-level `reasoning` AI rationale outside the `adminReview:<id>` namespace.
- `adminApprovalStatus`, `adminApprovedAt`, `adminApprovedByUserId`, `adminApprovalNote`.
- `patient_journey_events` rows of type other than `admin_review_regenerated`.

### 4.3 Idempotency contract

Re-running any regenerate path with the SAME inputs on the SAME patient produces the SAME `reasoning.adminReview:<id>` shape (modulo timestamps + prompt hash). The cleanup adds a hash-equality assertion in the new `admin-review/audit-shapes.ts` for the future test layer.

---

## 5. Supporting-button state model

The Admin Review modal renders a per-ancillary set of "supporting buttons" (Approve, Reject, Needs Info, Regenerate, Evidence). The enable/disable rules are scattered across the modal source today.

The cleanup centralises them into one pure function:

```ts
// server/modules/qualification/contracts.ts
export type SupportingButtonState = {
  approve: { enabled: boolean; reason?: string };
  reject: { enabled: boolean; reason?: string };
  needsInfo: { enabled: boolean; reason?: string };
  regenerate: { enabled: boolean; reason?: string };
  evidence: { enabled: boolean; reason?: string };
};

// server/modules/qualification/rules.ts
export function computeSupportingButtonState(input: {
  ancillaryId: string;
  reasoning: ReasoningBlob;
  adminApprovalStatus: AdminApprovalStatus;
  under16Guard: boolean;
}): SupportingButtonState;
```

The function is PURE: it does not fetch, log, or write. The modal's existing JSX consumes the returned object via the Batch-4 hook layer. No button is renamed, no test-id is changed.

---

## 6. Cutover sequence

The cleanup ships as a series of PRs, each one trivially small and each one passing the strict QA pass:

1. **PR-1** — `shared/contracts/qualifyingFactor.ts` + `shared/contracts/reasoning.ts` (type-only). No consumers updated. Dormancy QA pins them.
2. **PR-2** — `server/modules/qualification/contracts.ts` + `server/modules/admin-review/contracts.ts`. Type re-exports. Dormancy QA.
3. **PR-3** — `server/modules/qualification/reasoning-blob.ts` + a no-DB parity test that pins canonical reasoning-blob accessors against the existing inline reads.
4. **PR-4** — `server/modules/qualification/rules.ts` with `computeSupportingButtonState`. Dormancy QA. No-DB test asserts the same output the existing inline rules produce on a canned fixture.
5. **PR-5** — `server/modules/admin-review/audit-shapes.ts`. Dormancy QA. No journey-event write paths touched yet.
6. **PR-6** — `server/modules/admin-review/read-aggregator.ts` (Bundle 25's contract, finally implementable). Behind `USE_PLEXUS_IQ_AGGREGATE_READ` flag, default OFF.
7. **PR-7..N-1** — incremental adoption: route handlers call the dormant helpers behind feature flags; legacy paths stay primary.
8. **PR-N (UI)** — Admin Review modal adopts the Batch-4 hooks and the new contracts. No JSX changes; only the data layer.

Every PR runs the strict validation (`npm run check && npm run build && for s in scripts/qa-*.mjs ...`).

---

## 7. Stop conditions for every cleanup PR

A cleanup PR MUST stop and ask if:

1. It would change the `patient_screenings.reasoning` blob shape.
2. It would change the journey-event shape, name, or order.
3. It would rename, retype, or remove any column listed in `admin-review-approval-commit-inventory.md` §1–§4.
4. It would alter the order of writes in `commitPatient` or the approval handler.
5. It would touch `AdminReviewDialog.tsx` JSX or test-ids before PR-N.
6. It would touch any qualification AI prompt or model id.
7. It would flip a feature-flag default in production.
8. It would change a UI surface that renders qualifying factors.
9. It would change the AI input shape `screenSinglePatientWithAI` accepts.

---

## 8. Non-promises

- This design does NOT specify when each PR ships.
- This design does NOT lock the exact function signatures — they are illustrative. The contract is on shape and intent.
- This design does NOT modify any existing test or QA script.
- This design does NOT replace `plexus-iq-read-model-contract.md` (Bundle 25). The two are complementary: Bundle 25 pins the aggregate response shape; this bundle pins the source-side module layout.
- This design does NOT change any qualification rule, AI prompt, or canonical reasoning value.

End of design.
