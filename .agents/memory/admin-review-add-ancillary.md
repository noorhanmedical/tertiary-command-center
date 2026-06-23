---
name: Admin Review manual add-ancillary
description: How manual ancillary selection in AdminReviewDialog persists and flows downstream
---

# Admin Review manual add-ancillary

Adding a manual ancillary in the Admin Review dialog is fundamentally one lever:
**append the canonical test name to `patient.qualifyingTests`**. Everything
downstream already reads from `qualifyingTests`:

- Approval → `commitPatient` → `createOrUpdateExecutionCaseFromScreening` sets
  `selectedServices = screening.qualifyingTests` (one case per screening,
  deduped by `patientScreeningId` — no dup cases).
- Call list reason is derived live by `deriveCallReason` from `selectedServices`
  (BrainWave/VitalWave outreach, Ultrasound scheduling). There is NO persistent
  callReason column.
- PDFs (`client/src/lib/pdfGeneration.ts`) group services via
  `getAncillaryCategory(qualifyingTests[])`.

**Why honest "not generated":** admin-added tests must NOT fabricate AI
narrative. The add service writes only operator-selected `qualifying_factors`
into canonical `reasoning[testName]` and leaves `clinician_understanding` /
`patient_talking_points` blank, so `CanonicalReasoningCardView` renders
"Not generated yet" until a regenerate populates it.

**How to apply:**
- Provenance lives in supplemental reasoning keys, never in canonical narrative:
  `adminReview:test:<testName>` = `{adminAdded, source, addedAt, reason, factors}`
  and `adminReview:<ancillaryId>` merged with `{adminAdded:true}` (preserve
  existing assignedEvidence). Remove service already deletes these keys but never
  the canonical `reasoning[testName]`.
- Categorization gotcha: `getAncillaryCategory` (shared/ancillaryCategory.ts) is
  substring keyword matching. "Abdominal Aortic Aneurysm Duplex (93978)" did NOT
  match any keyword (aorta≠aortic, abdomen≠abdominal) and fell to "other" — added
  "aortic"/"abdominal" keywords so it buckets as ultrasound everywhere.
- Backend: `addAdminReviewAncillary` in
  `server/services/plexusIq/adminReviewAddService.ts`, route
  `POST /api/patient-screenings/:id/admin-review/add-ancillary` mirrors
  remove-ancillary validation. Dedupe reports `alreadyPresent` (never duplicates).
