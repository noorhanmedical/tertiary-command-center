---
name: Ancillary doc-readiness icons + billing gate
description: How the ACS appointment-card readiness indicators and the billing READINESS_GATE are wired.
---

# Ancillary document-readiness (ACS appointment cards)

Three readiness items per ancillary appointment, persisted in `case_document_readiness` (documentType column is free text):
- `informed_consent` — every patient
- `screening_form` — BrainWave/VitalWave only
- `brainwave_pdf` — BrainWave only (a NEW documentType string; NOT in REQUIRED_DOC_RULES, so it never affects the existing billingReadiness engine)

**Where things live**
- Summary builder + per-service requirement flags + the billing-gate evaluator: `server/services/ancillary/ancillaryReadinessSummary.ts`. Requirement split keys off `getAncillaryCategory()` (`@shared/ancillaryCategory`).
- The ACS ancillary schedule feed is `GET /api/technician-liaison/ancillary-schedule` (in `server/routes/globalSchedule.ts`), NOT any `/api/portal/...` path. It enriches each row with a `readiness` summary.
- Mark/upload writers: `server/routes/portalCaseReadiness.ts` → `POST /api/portal/case-readiness/:executionCaseId/mark` and `/upload-brainwave-pdf`. BrainWave bytes use `blobStore` ownerType `brainwave_result`.
- Card UI: `client/src/components/portal/AncillaryReadinessRow.tsx`, rendered inside the `activeWorkspaceMode === "ancillarySchedule"` card in `TeamPortalShell.tsx`. PDF preview iframes `/api/documents-library/:id/file?disposition=inline` (canonical doc-library path).

**Complete-status set** (any of these = done): complete, completed, uploaded, approved, generated.

**Billing gate** — `evaluateCaseReadinessGate()` is called in `server/routes/billing.ts`:
- `POST /api/billing-records` when `patientId` present.
- `PATCH /api/billing-records/:id` only when `billingStatus` transitions to a submitted-ish state (Submitted/Accepted/Pending/Denied/Rejected — NOT "Not Billed").
- Returns 400 `{ error: "Document readiness incomplete", code: "READINESS_GATE", missing }`.

**Why scoped this way:** the lazy GET auto-create scan in `billingRecordsService` is intentionally NOT gated (it pre-populates the worklist and gating it would break the billing page). The gate also no-ops when no execution case is resolvable, so non-ancillary/manual rows still work.
