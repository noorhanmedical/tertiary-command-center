# Frontend hooks extraction — plan (Batch 4)

**Status:** Docs-only (Bundle 55). No client source change. No JSX change. No `data-testid` change. No new dependency.
**Date:** 2026-06-10.
**Scope:** Concrete sequencing for the Batch 4 frontend hooks extraction described in `full-21-batch-orchestrator-review.md`, broken into the smallest verifiable PRs each with explicit test-id parity gates. The goal is to lift `useQuery` / `useMutation` calls out of three large components into custom hooks WITHOUT changing UI behavior, markup, or test ids.
**Cross-references:**
- `full-21-batch-orchestrator-review.md` Batch 4 (medium-high risk; protected flows).
- `protected-flows.md` (Admin Review, Engagement Center, Team Portals listed).
- `do-not-touch.md`.
- `admin-review-approval-commit-inventory.md` (Bundle 30).
- `qualification-structure-cleanup-design.md` (Bundle 31).
- `team-portal-playground-wiring-contract.md` (Bundle 11).
- `qa-index-regression-map.md` (Bundle 36).

This plan ships zero code. It sequences the hook extraction so each PR is small, reversible, and verifiable by an automated test-id parity check.

---

## 1. Why this plan exists

`AdminReviewDialog.tsx` (~4,200 lines), `EngagementAssignmentBoard.tsx` (~2,000 lines), and `PortalShell.tsx` (~1,800 lines) inline their `useQuery` / `useMutation` calls. Any future:

- Modularization of the Admin Review modal (Batch 15).
- Adoption of the v2 Engagement Center read model (Bundle 51).
- Adoption of the Patient Directory envelope on Team Portal (Bundle 49).

…benefits from extracting those calls into hooks first. The risk is that a careless extraction silently reorders hook calls, changes `data-testid`s, or breaks the modal's sibling-Next/Prev navigation. This plan structures the work so reviewers catch any of those regressions in code review, and the test-id parity gate catches them at CI.

---

## 2. Which hooks to extract first (ordered)

Order is from lowest-risk to highest-risk. Each PR adopts the matching component last; new hook files land in earlier PRs WITHOUT consumers.

### PR-A — Hook files only (zero consumers)

- Add `client/src/hooks/api/portalShell.ts` with named hooks mirroring every `useQuery` / `useMutation` in `PortalShell.tsx` (calendar month-summary, consent templates, sign-consent mutation, patient docs, my-facilities, today-schedule, etc.).
- Add `client/src/hooks/api/engagementBoard.ts` mirroring `EngagementAssignmentBoard.tsx`.
- Add `client/src/hooks/api/adminReview.ts` mirroring `AdminReviewDialog.tsx`.
- DO NOT update any component yet. Run `npm run check` + `npm run build` to confirm the types compile.
- Add a test-id parity counter script (`scripts/qa-frontend-testid-parity.mjs`) that captures the current `grep -c 'data-testid' <component>` count for the three target files. This becomes the parity baseline.

Validation: existing 35+ `qa-*.mjs` scripts pass; new parity counter shows baseline counts.

### PR-B — PortalShell adoption (lowest risk)

- `PortalShell.tsx` swaps inline calls to the new hooks. No JSX changes. No new state. No new effect. No new prop.
- Local variable names preserved (`const { data: docs } = useQuery(...)` → `const { data: docs } = usePatientDocs(patient.patientScreeningId)`).
- The parity counter MUST report the SAME `data-testid` count before and after.

Validation: parity counter unchanged + all qa scripts pass + manual click-through of PortalShell.

### PR-C — EngagementAssignmentBoard adoption

- Same pattern: hook-call swap only. No grouping logic, no PDF logic, no bulk-assign logic touched.
- The component's bulk-assign + cancel-many handlers KEEP their inline `onSuccess` invalidation logic (the hook layer doesn't take ownership of cache invalidation — that's the call site's concern).
- Parity counter unchanged.

Validation: parity counter unchanged + all qa scripts pass + manual click-through of Engagement Center (group expand, bulk assign, cancel-many, PDF buttons).

### PR-D — AdminReviewDialog adoption (HIGHEST risk)

- Same pattern. The modal has 50+ inline `data-testid`s, sibling navigation, per-ancillary regenerate, regenerate-all, admin approve, ICD chips, under-16 guardrails — ALL of these JSX surfaces stay byte-identical.
- Hook-call ORDER preserved (React tracks hook order; reordering a hook between sibling renders breaks state).
- `useEffect` / `useMemo` dependency arrays unchanged.
- The mutation `onSuccess` / `onError` handlers stay on the call site. Hook layer exposes only the `mutationFn`.

Validation: parity counter unchanged + all qa scripts pass + manual click-through of Admin Review on a representative patient (open dialog → regenerate one ancillary → regenerate-all → admin approve → sibling Next/Prev → ICD chips render).

---

## 3. Protected components — files the extraction MUST NOT touch in any PR

The hook extraction MUST NOT edit:

- `client/src/components/qualification/AdminApprovalControl.tsx`.
- `client/src/components/qualification/PatientPdfActions.tsx`.
- `client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx`.
- `client/src/lib/pdfGeneration.ts`, `client/src/lib/pdfPacketGrouping.ts`.
- `client/src/lib/queryClient.ts`.
- `client/src/hooks/api/keys.ts` (the `qk` factory; new keys are added in the new hook files, not here).
- `client/src/components/portal/TeamPortalShell.tsx` (kept for Bundle 32 Step D).
- Any component under `client/src/components/plexus-iq/*`.
- Any server source.

---

## 4. Test-id parity expectations

Every PR in this plan obeys the same rule:

```
grep -c 'data-testid' <component>  →  unchanged
```

The parity counter script (added in PR-A) captures the baselines:

| Component | Baseline (`data-testid` count) |
|---|---|
| `client/src/components/portal/PortalShell.tsx` | TBD (recorded at PR-A merge) |
| `client/src/components/engagement/EngagementAssignmentBoard.tsx` | TBD (recorded at PR-A merge) |
| `client/src/components/qualification/AdminReviewDialog.tsx` | TBD (recorded at PR-A merge) |

If a swap PR (B / C / D) drops the count by even one, CI fails. The reviewer either restores the missing `data-testid` or splits the PR.

---

## 5. No UI behavior change rules

For PRs B, C, D:

- No JSX node added, removed, wrapped, or rearranged.
- No prop signature change on the components.
- No default-prop change.
- No `useEffect` dependency array change.
- No `useMemo` dependency array change.
- No new `useState`.
- No `useRef` swap.
- The component's exports stay byte-identical.
- The component's named-import surface stays byte-identical.

Reviewers verify by `git diff --stat` showing a low number of insertions+deletions per swap (a ratio of "lines changed / inline-hook-call count" close to 1:1 is the target).

---

## 6. Rollback plan

- Each swap PR is independently revertable. PR-D's revert restores the inline `useQuery` calls in `AdminReviewDialog.tsx` without affecting PRs A-C.
- PR-A is also revertable (delete the three hook files).
- The parity counter baseline is captured in the script — a revert restores the baseline naturally.

---

## 7. Stop conditions for any swap PR

A swap PR MUST stop and ask if:

1. The `data-testid` count drops in any of the three target files.
2. A new console warning about hook order appears.
3. A new console warning about missing key appears.
4. A QA script regresses.
5. A manual click-through reveals a visible UI change.
6. The PR also touches a protected component from §3.
7. The PR adds a new hook to `client/src/hooks/api/keys.ts`.
8. The PR adds a server-side change.
9. The PR adds a new dependency (no new npm package).
10. The PR changes the order of hook calls in the consuming component.

---

## 8. QA gates for every PR in this plan

- `npm run check` clean.
- `npm run build` clean.
- All 35+ `scripts/qa-*.mjs` scripts pass.
- The new `scripts/qa-frontend-testid-parity.mjs` (added in PR-A) reports baseline counts before any swap PR; reports MATCHING counts after a swap PR.
- Manual click-through checklist from §2 for the matching component.

---

## 9. Non-promises

- No commitment that all four PRs ship in any timeframe.
- No commitment to specific hook function signatures — the contract is on the BEHAVIOR (no JSX change, no test-id change), not on the hook surface shape.
- No commitment that the extraction precedes any other Batch 4-15 work. The plan can be paused without losing intent.
- No commitment that the parity counter catches every possible regression — it catches `data-testid` drift specifically; reviewers still verify visual + behavioural parity by hand.

End of plan.
