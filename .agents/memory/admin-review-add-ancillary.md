---
name: Admin Review manual add-ancillary
description: How manual ancillary selection in AdminReviewDialog persists and flows downstream
---

# Admin Review manual add-ancillary

Adding a manual ancillary now **qualifies on add**: the add service builds the
shared admin-review evidence for the patient and decides what (if anything)
qualifies before writing anything.
- `brainwave`/`vitalwave`: qualify only if their `candidate.evidenceIds` are
  non-empty (the same support set used by the panels).
- generic `ultrasound` (test name "Ultrasound Studies"): fans out to
  `qualifyingUltrasoundSubtests(evidence)` — the AI-qualifying 6 (NOT the 3
  manual-only) ultrasounds that have non-medication clinical support — and adds
  each qualifying subtype not already present.
- a specific ultrasound subtype: qualifies via
  `clinicalEvidenceForUltrasoundTest` (non-medication evidence only).
If nothing qualifies, the service returns `{ qualified:false, state:"no_evidence" }`
and the dialog shows an amber "No qualifying evidence found" block with a
**required** reason and an "Add anyway" override (`override:true` skips
qualification, requires a reason, writes a blank narrative). Helpers live in
`shared/plexus-iq/adminReviewEvidence.ts`. The qualifying outcome union carries
`candidates`, `addedTests`, `narrativeGenerated`.

Whether qualified or overridden, the underlying lever is still the same:
**append the canonical test name(s) to `patient.qualifyingTests`**. Everything
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
