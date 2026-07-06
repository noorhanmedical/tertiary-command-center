---
name: Engagement Center Documents view
description: How the Documents tab gates note/billing lanes on report status, and portal-upload pitfalls
---

# Engagement Center Documents view

- The Documents tab in `/engagement-center` reads `case_document_readiness` grouped by `patientScreeningId::serviceType`; Order Note / Procedure Note / Billing Document lanes unlock only when the report row's status is one of uploaded/generated/completed/approved.
- **Why:** the report is the clinical source for downstream notes and billing; showing locked lanes with "Awaiting report" keeps the boundary honest instead of faking progress.
- **How to apply:** any new surface that exposes these lanes must reuse the same passing-status set and never generate/unlock notes without a report.
- Report upload rides the canonical two-step: multipart `POST /api/portal/uploads` then `POST /api/case-document-readiness/complete` with `documentStatus=uploaded`. `billing_document` rows are auto-created by billing readiness evaluation — view-only, never completed directly.
- Pitfall: `/api/portal/uploads` 404s "Patient not found" for **soft-deleted** screenings (repo getScreening filters ACTIVE) and is role-gated to admin/technician/liaison. Test data with deleted_at set will always fail upload even though readiness rows exist.
