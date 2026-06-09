# PDF protection contract (Batch 9)

**Branch:** `architecture/batch-9-pdf-protection-contract`
**Date:** 2026-06-09
**Scope:** READ-ONLY documentation. No code changed by this branch.
**Purpose:** Lock down the contract for `client/src/lib/pdfGeneration.ts` and `client/src/lib/pdfPacketGrouping.ts` so any future batch that touches a PDF caller can be evaluated against an explicit invariant list.

> Cross-reference: `docs/architecture/protected-flows.md`, `docs/architecture/do-not-touch.md`, `docs/architecture/dependency-map.md`, `docs/architecture/backend-route-parity-inventory.md` §1 (Admin Review handlers; reasoning blob shape), `docs/architecture/full-21-batch-orchestrator-review.md` Batches 4, 10, 15 (the future PDF-adjacent refactors).

---

## 0. How this contract is enforced

1. **Any PR that touches `pdfGeneration.ts`, `pdfPacketGrouping.ts`, or a PDF caller** must cite this contract in its description and explain how each invariant in §3 is preserved.
2. **Any PR that touches the canonical reasoning blob shape** (`patient_screenings.reasoning`) must verify the four required keys in §3.2 are still present in writes; PDF callers depend on those keys being there.
3. **The do-not-touch list in §6 supplements** `docs/architecture/do-not-touch.md`. Files listed here may be moved, renamed, or refactored only by an explicitly approved batch (Batch 4 hooks extraction, Batch 15 Admin Review modularization). Other batches must leave them alone.
4. **A baseline-snapshot regression test is deferred** (see §8). Until it ships, every PDF-touching PR carries a manual-regression checklist in its body.

---

## 1. Important correction to prior inventory

The original architecture review (`docs/architecture/review-canonical-spine-2026-06-09.md` §3.5/§6.3) and the Batch 3a parity inventory (`docs/architecture/backend-route-parity-inventory.md` §1.4) both implied that ICD-10 codes are rendered in the **Plexus PDF** but not the Clinician PDF.

**This is incorrect.** A direct re-read of `client/src/lib/pdfGeneration.ts` finds identical comments at:

- `pdfGeneration.ts:403–405` (inside `buildClinicianPdfBody`)
- `pdfGeneration.ts:607–609` (inside `buildPlexusPdfBody`)

Both say:

> ICD-10 codes are intentionally not rendered in either PDF. They live in canonical `patient.reasoning[testName].icd10_codes` for Admin Review and downstream coding, not for distributed PDF output.

**The corrected invariant** is in §3.4 below. The earlier review and parity inventory should be considered superseded on this single point; the rest of those documents stands.

---

## 2. Public exports

### 2.1 `client/src/lib/pdfGeneration.ts`

| Export | Kind | Source line | Notes |
| --- | --- | --- | --- |
| `ReasoningValue` | type | 4 | Per-test reasoning value union (object with `clinician_understanding`, `patient_talking_points`, `qualifying_factors?`, `icd10_codes?`, `pearls?`, `confidence?`, `approvalRequired?`). |
| `esc` | function | 16 | HTML escape helper. |
| `getOneSentenceDesc` | function | 60 | One-line test description string. |
| `getTestDescHTML` | function | 68 | Multi-line test description HTML. |
| `exportPdfDocument` | async function | 193 | Single-document PDF emitter (`html2pdf.js` path). |
| `buildPrintWindow` | function | 218 | Multi-page print-preview window opener with optional `injectScript`. |
| `buildPatientDemoBlock` | function | 248 | Patient demographics HTML block. |
| `buildPatientTop` | function | 272 | Per-patient header HTML. |
| `normalizeUltrasoundName` | function | 337 | Ultrasound display-name canonicalization. |
| `getUltrasoundIcon` | function | 341 | Ultrasound icon SVG. |
| `formatScheduleDate` | function | 348 | Schedule-date display string. |
| `getPrevTestsSign` | function | 360 | Prior-tests signal helper. |
| **`generateClinicianPDF`** | function | 364 | **Clinician PDF — sync path.** Inputs: `(batchName, patients, scheduleDate?, createdAt?)`. |
| **`generateClinicianPDFAsync`** | async function | 375 | **Clinician PDF — async path.** Same signature. |
| `buildClinicianPdfBody` | function | 387 | HTML body builder used by both Clinician paths. |
| **`generatePlexusPDF`** | function | 539 | **Plexus PDF — sync path.** Same signature as Clinician. |
| **`generatePlexusPDFAsync`** | async function | 553 | **Plexus PDF — async path.** Same signature. |
| `buildPlexusPdfBody` | function | 566 | HTML body builder used by both Plexus paths. |
| `PacketPrintPreviewMode` | type | 710 | `"plexus" \| "clinician"`. |
| `PacketPrintPreviewResult` | type | 712 | Result-envelope union for the preview builders. |
| `PacketPrintPreviewSection` | type | 720 | Single-section preview shape. |
| **`openPatientPacketPrintPreview`** | function | 794 | **Multi-patient packet preview — used by Plexus IQ + Admin Review.** |
| `SchedulerPacketPreviewGroup` | type | 836 | Per-scheduler grouping for the scheduler-packet preview. |
| `SchedulerPacketPreviewResult` | type | 852 | Result-envelope union for the scheduler-packet preview. |
| **`openSchedulerPacketPrintPreview`** | function | 856 | **Scheduler-packet preview — used by Engagement Center.** |

### 2.2 `client/src/lib/pdfPacketGrouping.ts`

| Export | Kind | Source line | Notes |
| --- | --- | --- | --- |
| `PdfPacketSourcePatient` | type | 15 | Patient row plus per-patient `batch?` info needed by the packet grouping. |
| `PdfPacketKey` | type | 19 | `(facility, scheduleDate)` packet key. |
| `getPatientPdfPacketKey` | function | 24 | Computes the packet key for one patient. |
| `PdfPacketValidation` | type | 37 | Ok / facility-mismatch / date-mismatch / multi-facility / multi-date discriminated union. |
| **`validateSameFacilityDatePacket`** | function | 72 | Used by AdminReviewDialog + PlexusIQWorkspace + EngagementAssignmentBoard to prevent mixed-facility/mixed-date packets. |
| `SchedulerPdfPacket` | type | 151 | One scheduler's packet (patients + scheduler info). |
| `SchedulerPdfSplit` | type | 160 | Split of patients across schedulers. |
| **`splitPatientsByFacilityDate`** | function | 167 | Used by EngagementAssignmentBoard to split bulk PDF actions across (facility, date) groups. |
| **`isPatientPdfEligible`** | function | 228 | Used by PatientCard + PatientListRow + PatientPdfActions to gate the PDF action visibility. |

---

## 3. Invariants (the contract)

Any PR that touches a PDF caller MUST preserve all of the following invariants. The contract is satisfied when every box can be answered "yes".

### 3.1 Caller-side input shape

- The PDF generators (`generateClinicianPDF`, `generateClinicianPDFAsync`, `generatePlexusPDF`, `generatePlexusPDFAsync`, `buildClinicianPdfBody`, `buildPlexusPdfBody`) all share the same signature: `(batchName: string, patients: PatientScreening[], scheduleDate?: string | null, createdAt?: string | Date | null)`. **Callers must not invent a new signature variant**; this is the only contract.
- `patients` must be an array of full `PatientScreening` rows (Drizzle `$inferSelect` shape). **Callers must not pass a partial shape**; the body builders read `qualifyingTests`, `reasoning`, `name`, `dob`, `age`, `gender`, `insurance`, `time`, `phoneNumber`, `email`, `previousTests`, `diagnoses`, `history`, `medications`, `notes`.
- The print-preview helpers (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`) accept their own typed inputs (see §2.1). Callers must not bypass them by calling `buildPrintWindow` directly when the existing entry point fits.

### 3.2 Reasoning blob keys required by both PDFs

Both `buildClinicianPdfBody` and `buildPlexusPdfBody` read `(p.reasoning || {})` and treat it as `Record<string, ReasoningValue>`. Each per-test entry must support these fields (all are read by at least one PDF path):

- `clinician_understanding: string`
- `patient_talking_points: string`
- `qualifying_factors?: string[]`
- `icd10_codes?: string[]` (**kept on the wire even though the PDFs do not render it — see 3.4**)
- `pearls?: string[]`
- `confidence?: "high" | "medium" | "low"`
- `approvalRequired?: boolean`

**Any batch that proposes to drop or rename any of these keys must explain how PDF output is unaffected. The default assumption is that dropping a key breaks PDF output.**

### 3.3 Reasoning blob may carry string overrides

Both PDF bodies tolerate `reasoning[testName]` being a string (admin-review free-form override). The `ReasoningValue` union is `TestReasoning | string`. Callers and writers must preserve this fork.

### 3.4 ICD codes are NOT rendered in either PDF (CORRECTED INVARIANT)

- **`buildClinicianPdfBody` does not emit `icd10_codes`.** Source: `pdfGeneration.ts:403–405`.
- **`buildPlexusPdfBody` does not emit `icd10_codes`.** Source: `pdfGeneration.ts:607–609`.

The codes must continue to be **stored** in `patient.reasoning[testName].icd10_codes` (Admin Review and downstream coding read them), but they are **not** distributed via PDF.

Any batch that:
- removes `icd10_codes` from the stored reasoning blob → blocks Admin Review (do not ship).
- adds `icd10_codes` to either PDF body → changes distributed clinical paperwork (do not ship without an explicit clinical sign-off batch).

### 3.5 Multi-patient packets use print-preview

The two print-preview helpers (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`) exist specifically to avoid the `html2canvas` freeze that occurred when multiple patient pages were rendered through `html2pdf.js` directly. Commits cited in the architecture review: `4dd40df`, `f0c9e90`, `449580e`, `88c5467`. **Callers must not "simplify" multi-patient packets back to a direct `exportPdfDocument` path** — the print-preview pattern is load-bearing.

### 3.6 Packet grouping invariants

- `getPatientPdfPacketKey(patient)` computes `(facility, scheduleDate)`. Callers must not invent their own grouping key.
- `validateSameFacilityDatePacket(...)` returns a discriminated `PdfPacketValidation` union. **The UI consumes the variant tags** (`ok`, `facility-mismatch`, etc.) — do not collapse them into a string.
- `splitPatientsByFacilityDate(...)` is the only correct way to split a heterogenous patient list across packets. EngagementAssignmentBoard uses this.
- `isPatientPdfEligible(patient)` is the only correct way to gate per-patient PDF action visibility. PatientCard, PatientListRow, and PatientPdfActions all use it.

### 3.7 Reasoning data source

PDFs are read-only client renders. They source data from the client-side `PatientScreening` row already in React Query cache. **PDFs do not make their own API call.** Any batch that adds an API fetch from PDF code changes that contract.

---

## 4. Caller inventory

11 caller files were found via grep. Each one is listed with the symbols it imports and what it does with them. **None of these may be edited by a non-PDF-batch without citing this contract.**

### 4.1 `client/src/components/qualification/PatientPdfActions.tsx`

```ts
import {
  generateClinicianPDF,
  generatePlexusPDF,
} from "@/lib/pdfGeneration";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
```

- **Role:** Single-patient PDF action buttons (Clinician PDF + Plexus PDF) used in card / list / dialog contexts.
- **Surface:** Visibility gated by `isPatientPdfEligible`. On click invokes the sync generator with `[patient]` as a single-element array.
- **Risk if changed:** Any rename of `generateClinicianPDF` / `generatePlexusPDF` propagates here first.

### 4.2 `client/src/components/ResultsView.tsx`

```ts
import {
  generateClinicianPDF,
  generatePlexusPDF,
  type ReasoningValue,
} from "@/lib/pdfGeneration";
```

- **Role:** Plexus IQ results view (post-AI screening). Owns the bulk Plexus PDF + Clinician PDF buttons + the `PdfPatientSelectDialog` flow that scopes the bulk action to selected patients.
- **Risk if changed:** This is the principal Plexus IQ bulk PDF entry. Any change to the bulk-PDF semantics begins here.

### 4.3 `client/src/components/qualification/AdminReviewDialog.tsx`

```ts
import {
  …,
  openPatientPacketPrintPreview,
} from "@/lib/pdfGeneration";
import {
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
} from "@/lib/pdfPacketGrouping";
```

- **Role:** Admin Review modal's PDF preview button. Uses `openPatientPacketPrintPreview` so multi-patient sibling-navigation preview matches the print-preview path. `validateSameFacilityDatePacket` guards against accidental mixed-facility packets.
- **Risk if changed:** Highest-risk caller. AdminReviewDialog is in §10 of the do-not-touch list independently; Batch 15 is the only batch that may touch it, and only sub-batch-by-sub-batch.

### 4.4 `client/src/components/engagement/EngagementAssignmentBoard.tsx`

```ts
import {
  …,
  type SchedulerPacketPreviewGroup,
} from "@/lib/pdfGeneration";
import {
  splitPatientsByFacilityDate,
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
  type SchedulerPdfPacket,
} from "@/lib/pdfPacketGrouping";
```

- **Role:** Engagement Center bulk-PDF action. Splits selected patients across (facility, date) groups; uses `openSchedulerPacketPrintPreview` (via the `SchedulerPacketPreviewGroup` type).
- **Risk if changed:** Bulk-PDF behavior is a load-bearing piece of the Engagement Center UX; the print-preview path is the only freeze-safe option for N > 1 patients.

### 4.5 `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`

```ts
import {
  …,
  openPatientPacketPrintPreview,
} from "@/lib/pdfGeneration";
import {
  isPatientPdfEligible,
  validateSameFacilityDatePacket,
  type PdfPacketSourcePatient,
} from "@/lib/pdfPacketGrouping";
```

- **Role:** Plexus IQ workspace top-level PDF actions (the "All Patients" / facility-grouped views). Uses the same print-preview helper as AdminReviewDialog.
- **Risk if changed:** Workspace bulk PDF semantics.

### 4.6 `client/src/components/PatientCard.tsx`

```ts
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
```

- **Role:** Per-patient card. Imports `ReasoningValue` for its own reasoning rendering AND `isPatientPdfEligible` to gate the embedded PDF action button visibility.
- **Risk if changed:** Card visibility logic depends on `isPatientPdfEligible`'s exact semantics.

### 4.7 `client/src/components/qualification/PatientListRow.tsx`

```ts
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
```

- **Role:** Per-row PDF eligibility gate in the qualification list view.
- **Risk if changed:** Same shape as PatientCard.

### 4.8 `client/src/components/PatientDetailDialog.tsx`

```ts
import type { ReasoningValue } from "@/lib/pdfGeneration";
```

- **Role:** Type-only import — the dialog renders reasoning data with the same shape the PDFs do.
- **Risk if changed:** Type-only impact; renaming `ReasoningValue` here is mechanical but must be the same batch as any rename elsewhere.

### 4.9 `client/src/components/plexus-iq/PlexusIQDayModal.tsx`

```ts
import type { ReasoningValue } from "@/lib/pdfGeneration";
```

- **Role:** Type-only import — the day-click modal renders `ResultsView` which is the bulk-PDF host.
- **Risk if changed:** Type-only.

### 4.10 `client/src/pages/home.tsx`

```ts
import type { ReasoningValue } from "@/lib/pdfGeneration";
```

- **Role:** Type-only import on the home page where the dashboard + sidebar + ResultsView all compose.
- **Risk if changed:** Type-only.

### 4.11 `client/src/pages/shared-schedule.tsx`

```ts
import { generateClinicianPDF, generatePlexusPDF, type ReasoningValue } from "@/lib/pdfGeneration";
```

- **Role:** Shared-schedule public-PIN-gated page. Direct sync invocations.
- **Risk if changed:** This is the **only public-facing entry point** for the PDF generators (a PIN-gated read view used to share a schedule snapshot). Renaming the generators here is mechanical, but any change to the gating / PIN flow must be evaluated for PHI exposure separately.

---

## 5. Fan-in summary

| Symbol | Caller count | Callers |
| --- | --- | --- |
| `generateClinicianPDF` | 4 | PatientPdfActions, ResultsView, shared-schedule |
| `generatePlexusPDF` | 3 | PatientPdfActions, ResultsView, shared-schedule |
| `openPatientPacketPrintPreview` | 2 | AdminReviewDialog, PlexusIQWorkspace |
| `openSchedulerPacketPrintPreview` | (referenced via `SchedulerPacketPreviewGroup`) | EngagementAssignmentBoard |
| `ReasoningValue` (type-only) | 6 | PatientCard, PatientDetailDialog, ResultsView, PlexusIQDayModal, home, shared-schedule |
| `isPatientPdfEligible` | 4 | PatientCard, PatientListRow, PatientPdfActions, PlexusIQWorkspace |
| `validateSameFacilityDatePacket` | 3 | AdminReviewDialog, EngagementAssignmentBoard, PlexusIQWorkspace |
| `splitPatientsByFacilityDate` | 1 | EngagementAssignmentBoard |
| `PdfPacketSourcePatient` (type-only) | 3 | AdminReviewDialog, EngagementAssignmentBoard, PlexusIQWorkspace |
| `SchedulerPdfPacket` (type-only) | 1 | EngagementAssignmentBoard |

**Generator sync vs. async:** All current callers use the **sync** generators (`generateClinicianPDF`, `generatePlexusPDF`). The `*Async` variants are defined but not consumed by any caller in the inventory. A future batch that prefers async should switch all callers atomically or treat the sync versions as compat shims.

---

## 6. Do-not-touch list (PDF-specific supplement)

Files that may not be moved, renamed, or refactored except by an explicitly approved batch that cites this contract:

**Core PDF code (only Batches 9, 15, 16 may touch these; never accidentally):**
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`

**Direct PDF callers:**
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/ResultsView.tsx`
- `client/src/components/qualification/AdminReviewDialog.tsx`
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`
- `client/src/components/PatientCard.tsx`
- `client/src/components/qualification/PatientListRow.tsx`
- `client/src/pages/shared-schedule.tsx`

**Type-only consumers (`ReasoningValue` import, no behavior change risk but rename must propagate):**
- `client/src/components/PatientDetailDialog.tsx`
- `client/src/components/plexus-iq/PlexusIQDayModal.tsx`
- `client/src/pages/home.tsx`

**Reasoning blob shape (server-side writers — must keep the four required keys):**
- `server/routes/patients.ts` regenerate handlers (now in `server/services/plexusIq/adminReview*Service.ts` after Batches 3b.1–3b.7)
- `server/services/screening.ts` (initial AI qualification)
- `server/services/plexusIq/adminReviewAiRegeneration.ts` (`regenerateCanonicalReasoning`, `regenerateAdminReviewReasoning`)

---

## 7. Tripwires (known fragilities)

These are NOT invariants — they're hazards a future batch must be aware of:

1. **`html2pdf.js` freeze risk** on > 1 patient. The print-preview helpers exist because of this; do not regress.
2. **Reasoning string overrides.** `reasoning[testName]` may be a string (admin-review free-form override). PDF code handles this; new consumers must too.
3. **`ResultsView` is the only place** `PdfPatientSelectDialog` is used. If that dialog moves, ResultsView's flow breaks.
4. **`shared-schedule.tsx` runs PDF generators on a public PIN-gated page.** Any change to the PIN/gating model changes the data exposure surface — handle separately from PDF refactors.
5. **`buildPrintWindow` accepts an optional `injectScript`.** The print-preview helpers use this to auto-trigger `window.print()` after content is rendered; do not strip the parameter.
6. **`PdfPacketValidation` is a discriminated union**, not a boolean. UI variants depend on the discriminator.
7. **The async generators are defined but unused.** Removing them is fine in a deliberate batch; quietly removing them might break a future PR that intended to switch to async.

---

## 8. Baseline-snapshot status — deferred

The Batch 9 orchestrator entry permits an optional deterministic-baseline fixture under `client/src/lib/pdf-baselines/` plus a `scripts/qa-pdf-baseline-snapshot.mjs` runner. **This batch defers both** for the following enterprise-grade reasons:

1. **Determinism cannot be proven without execution.** I cannot run the PDF library (browser-side `html2pdf.js`) in this environment to verify the output is hash-stable across runs. Shipping a non-deterministic baseline would produce false positives on every CI run.
2. **A flaky baseline is worse than no baseline.** The orchestrator's own stop condition for Batch 9 says: *"If the baseline hash is non-deterministic (different on every run on the same machine), STOP — the PDF library has non-determinism that must be quarantined first."*
3. **Manual regression is the substitute.** Every PDF-touching PR must include the manual checklist in §9 in its description.

**Follow-up batch when ready:** A small "Batch 9b" can ship the baseline once a determinism harness exists (probably as part of Batch 21 QA hardening, after a playwright/headless-browser test substrate is in place).

---

## 9. Manual regression checklist (use in any PDF-touching PR)

Paste this into the PR description if the PR touches any file in §6:

```
PDF regression checklist:
- [ ] Single-patient Clinician PDF: open from Admin Review on one approved patient; visual identity vs. pre-batch screenshot.
- [ ] Single-patient Plexus PDF: same patient; visual identity.
- [ ] Multi-patient packet (3 patients, same facility + date) from Plexus IQ workspace: print-preview window opens; correct page count; no html2canvas freeze.
- [ ] Multi-patient packet (3 patients, mixed facility OR mixed date): packet validation surfaces the right `PdfPacketValidation` variant.
- [ ] Engagement Center bulk PDF: select 3 patients across 2 schedulers; split + preview shows correct grouping.
- [ ] Outreach packet via `CanonicalRowActions` (if PR touches outreach surface).
- [ ] Reasoning blob round-trip: regenerate a patient via Admin Review, then re-open the PDF; reasoning text matches the regenerated content; ICD codes still present in `patient.reasoning[testName].icd10_codes` (verified via patient API) but NOT visible in either PDF body.
- [ ] Type-only consumers (PatientDetailDialog, PlexusIQDayModal, home) compile and render normally.
- [ ] shared-schedule public PIN flow loads, gating intact.
```

---

## 10. Stop conditions

The following situations require stopping and asking before continuing in any PDF-touching batch:

1. **A new caller appears for `pdfGeneration.ts` or `pdfPacketGrouping.ts`** that is not in §4 — add it to §4 before reviewing the rest of the PR.
2. **A new export is added to either PDF module** — add it to §2 and explain its caller in the same PR.
3. **Either of the two ICD-omission comments is removed** (`pdfGeneration.ts:403–405` or `:607–609`) — the comment is the contract; do not remove without an explicit clinical sign-off.
4. **The sync ↔ async generator pair is broken** (e.g., `generateClinicianPDF` removed while `generateClinicianPDFAsync` is still defined) — pick one path or keep both; do not leave the pair half-defined.
5. **`buildPrintWindow` loses the `injectScript` parameter** — the print-preview helpers rely on it.
6. **The reasoning blob loses any of the four required keys** in §3.2 — the PDFs read them; the writers must keep them.
7. **A new PDF entry point bypasses the print-preview helper** for multi-patient flow — the `html2canvas` freeze risk is real.

---

## 11. Cross-references

- Reasoning blob shape: `shared/contracts/reasoning.ts` (Batch 2), `shared/schema/screening.ts:114-143`.
- Admin Review handlers (now wrapped in services after Batches 3b.1–3b.7): see `docs/architecture/backend-route-parity-inventory.md` §1.
- Print-preview commits: `4dd40df`, `f0c9e90`, `449580e`, `88c5467` (cited in `protected-flows.md` §5).
- Future PDF-aware batches: Batch 4 (frontend hooks; does NOT touch PDF behavior), Batch 15 (Admin Review modularization; must preserve PDF preview button), Batch 16 (Documents/reports storage; touches PDF DATA source, not generation).

End of contract.
