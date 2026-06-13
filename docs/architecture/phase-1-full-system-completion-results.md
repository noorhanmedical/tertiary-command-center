# Phase 1 Full-System Completion Results

**Status:** Slice 1.7 honesty audit. Updated by each later slice.
**Branch:** `fix/phase-1-full-system-audit-and-completion`

This document classifies every downstream Phase 1 surface against the
canonical label set defined in `CLAUDE_PHASE_GUARDRAILS.md` §12:

- **Live** — code path is wired, exercised by Phase 1 surfaces, and
  source-level QA proves it.
- **Scaffold** — the file / route / table exists but the workflow it
  participates in is not yet end-to-end usable.
- **Dormant** — present in code but intentionally unwired pending a
  later phase.
- **Flag-gated** — behavior swings on an environment flag.
- **Read-only** — only fetched / displayed, no write surface.
- **Requires activation** — code is ready but a runbook step (env
  variable / external service config) gates it.
- **Requires staging DB** — only verifiable end-to-end on a staging
  database; the source-level QA validates wiring only.

Every claim below is anchored to a file path. If the file moves, the
QA in `scripts/qa-phase-1-downstream-scaffolds-honesty.mjs` fails.

---

## 1. Documents / Report Upload / Document Library

### 1.1 Documents page (`client/src/pages/documents.tsx`)

**State:** Live (read + upload).
**Evidence:**

- `DocumentSection`, `DocumentReadinessPanel`, `EditableScreeningFormModal`
  imported and rendered.
- Reads via React-Query against the canonical document endpoints.
- Upload goes through `POST /api/portal/uploads` (`server/routes/portal.ts`
  line 584) which uses `multer` memory storage + the canonical
  `fileStorage` adapter.

### 1.2 Document Library (`client/src/pages/document-library.tsx`)

**State:** Live (admin-only).
**Evidence:**

- `Library` icon nav entry in `GlobalNav.tsx`.
- Backed by `migrations/0010_central_document_library.sql`.

### 1.3 Document Upload (`client/src/pages/document-upload.tsx`)

**State:** Live (flag-aware).
**Evidence:**

- Routes to the canonical upload helper.
- File storage adapter resolved at runtime via
  `server/services/fileStorage.ts` →
  `googleDriveFileStorage.ts` / `s3FileStorage.ts`.

### 1.4 Report Upload

**State:** Live (admin / technician / liaison role-gated).
**Evidence:**

- `POST /api/portal/uploads` is `requirePortalRole`-gated
  (`server/routes/portal.ts:584`).
- Accepts `kind: report` (`PORTAL_DOC_KINDS` set in `portal.ts:54`).

### 1.5 External storage adapters

**State:** Live (selectable via env).
**Evidence:**

- `server/integrations/googleDriveFileStorage.ts`
- `server/integrations/s3FileStorage.ts`
- `server/integrations/fileStorage.ts` (selector).
- `server/integrations/googleDrive.ts` (OAuth + raw file ops)
- `server/integrations/googleSheets.ts` (read access for sheet-backed
  configuration / import flows).

---

## 2. Physician Signing

**State:** Scaffold for physician-order signing; **Live** only for
patient / technician-side consent signing (`POST /api/portal/sign-consent`
in `server/routes/portal.ts:644`). Physician signature workflow on
orders / reports is not yet end-to-end usable.

**Evidence of Live consent signing:**

- `SignaturePad` component (`client/src/components/portal/SignaturePad.tsx`).
- `sign-consent` route + `informed_consent` document kind.
- Slice 1.4 PCS Workspace consumes the consent surface via the
  workspace feeds.

**Evidence of Scaffold-only physician signing:**

- No `/api/portal/sign-order` route.
- No `physician_signature` document kind in `PORTAL_DOC_KINDS`.
- No UI surface in the canonical PCS / ACS workspaces for a
  physician-order signature event.

**Phase 2 work:** end-to-end physician-order signing routed through
the canonical document layer with the canonical audit trail.

---

## 3. Billing Readiness

### 3.1 Backend

**State:** Live (DB-backed, query-only on Phase 1 surfaces).
**Evidence:**

- `shared/schema/billingReadiness.ts` defines
  `billing_readiness_checks` + `case_document_readiness`.
- React-Query keys `["/api/billing-readiness-checks"]` and
  `["/api/case-document-readiness"]` invalidated by
  `CanonicalRowActions` on relevant actions (line 471 + 498 + 499 +
  500 in Slice 1.4 inspection).

### 3.2 Frontend

**State:** Live read-only on ACS Workspace via
`DocumentReadinessPanel`.

**Phase 2 work:** billing-readiness write workflow (currently the
checks are surfaced but the operator cannot mark them ready from the
PCS / ACS workspace — only from admin surfaces).

---

## 4. Billing

### 4.1 Billing page (`client/src/pages/billing.tsx`)

**State:** Live (admin / biller role).
**Evidence:**

- Imports `VALID_FACILITIES`, `apiRequest`, real React-Query hooks.
- Role-gated entry in `GlobalNav.tsx`:
  `roles: ["admin", "biller"]`.
- Backed by `shared/schema/billing.ts` +
  `shared/schema/billingDocuments.ts`.

### 4.2 Cash Pricing

**State:** Live (admin-edited per facility).
**Evidence:** `shared/schema/cashPricing.ts` + admin surfaces.

---

## 5. Invoicing

### 5.1 Invoices page (`client/src/pages/invoices.tsx`)

**State:** Scaffold (DB-backed, UI present, external payment dispatch
NOT wired).
**Evidence:**

- Hooks `useInvoiceAging`, `useInvoices`, `useCreateInvoice`,
  `useRecordPayment` exist and call real endpoints.
- Migrations `migrations/0020_add_invoices.sql`,
  `0021_add_invoice_payments.sql`,
  `0021_invoice_email_metadata.sql`,
  `0022_add_invoice_last_reminded.sql` exist.
- Surface displays invoices, ageing, payments — internal data only.

**Scaffold seams:**

- No external payment gateway integration (Stripe / payor portal).
- No automated email dispatch beyond manual remind tracking.
- Invoice export (PDF / sheet) is not in scope.

**Phase 4 work:** real payment dispatch + automated email rounds.

---

## 6. AWS Production

**State:** Requires activation. Phase 1 documents the runbook; no
GitHub Actions or other automated deploy hooks are wired.

**Evidence (already on `main` from prior batches):**

- `docs/architecture/aws-readiness-checklist.md`
- `docs/architecture/aws-readiness-design.md`
- `docs/architecture/phase-1-aws-backup-runbook.md`
- `docs/architecture/phase-1-aws-deploy-runbook.md`
- `docs/architecture/phase-1-aws-deployment-contract.md`
- `docs/architecture/phase-1-aws-smoke-test-runbook.md`

**Phase 5 work:** activate the runbook (configure secrets via
Secrets Manager, push the deploy hook, smoke test on staging).

---

## 7. External Integrations

**State:** Live (Google Drive + Google Sheets + S3 wired; selectable
via `server/services/fileStorage.ts`).

**Evidence:**

- `server/integrations/googleDrive.ts` — OAuth + file ops.
- `server/integrations/googleDriveFileStorage.ts` — adapter
  conforming to the `fileStorage` interface.
- `server/integrations/googleSheets.ts` — read access for sheet-backed
  configuration / import flows.
- `server/integrations/s3FileStorage.ts` — S3 adapter (AWS-bound).

**Phase 6 work:** add the integration partners listed in the Phase 6
roadmap (insurance eligibility, EHR adapters, etc.). Not in scope
here.

---

## 8. Mission Control

**State:** Dormant (Phase 7).
**Evidence:**

- No pages under `client/src/pages/` matching `mission*`.
- No `MissionControl*` component anywhere in `client/src/`.
- No `/mission-control` route registered in `client/src/App.tsx`.

**Phase 7 work:** the entire Mission Control surface is intentionally
absent. The guardrails forbid landing it as a side effect of any
Phase-1–6 slice.

---

## 9. Honesty audit summary table

| Surface | Label | Source path(s) | QA |
|---|---|---|---|
| Documents page | Live | `client/src/pages/documents.tsx` | qa-phase-1-downstream-scaffolds-honesty.mjs |
| Document Library | Live | `client/src/pages/document-library.tsx` | same |
| Document Upload | Live | `client/src/pages/document-upload.tsx` | same |
| Report Upload | Live | `server/routes/portal.ts` `/api/portal/uploads` | same |
| External storage adapters | Live | `server/integrations/{fileStorage,googleDrive,googleDriveFileStorage,s3FileStorage,googleSheets}.ts` | same |
| Consent signing | Live | `server/routes/portal.ts` `/api/portal/sign-consent` | qa-phase-1-acs-document-signing-billing-handoff.mjs |
| Physician order signing | Scaffold | (no route) | same |
| Billing Readiness backend | Live | `shared/schema/billingReadiness.ts` | same |
| Billing Readiness UI | Read-only on ACS | `client/src/components/patient/DocumentReadinessPanel.tsx` | same |
| Billing page | Live (admin/biller) | `client/src/pages/billing.tsx` | qa-phase-1-downstream-scaffolds-honesty.mjs |
| Invoicing | Scaffold | `client/src/pages/invoices.tsx` | same |
| AWS production | Requires activation | `docs/architecture/aws-*.md` runbooks | qa-phase-1-aws-readiness-final.mjs |
| External integrations (Drive/Sheets/S3) | Live | `server/integrations/googleDrive*.ts`, `googleSheets.ts`, `s3FileStorage.ts` | qa-phase-1-downstream-scaffolds-honesty.mjs |
| Mission Control | Dormant | (absent) | qa-phase-1-downstream-scaffolds-honesty.mjs |

---

## 10. Remaining work by phase

### Phase 2 — Full operations runtime

- Wrap Admin Review commit fan-out (`patient_screenings` update +
  `commitPatient` + journey event) in one DB transaction (deferred
  from Slice 1.3).
- Physician-order signing route + canonical UI surface.
- Billing-readiness write workflow on PCS / ACS workspaces.
- ACS-Workspace ancillary document / signing / billing handoff
  surfaced inline instead of relying on Admin surfaces.

### Phase 3 — AI automation + exception intelligence

- AI-driven exception triage on top of the Admin Review evidence
  layer.
- Auto-routing of unclear cases to the Admin Review queue.

### Phase 4 — Billing + invoicing runtime

- Real payment gateway integration.
- Automated invoice email rounds.
- PDF invoice export.

### Phase 5 — AWS staging / production activation

- Activate the runbook (secrets, deploy hook, staging smoke).
- Resolve the `0021` migration id collision (intentionally not
  touched in Phase 1 per the migration policy ADR).
- Master facilities table migration (deferred from Slice 1.2).

### Phase 6 — External integrations

- Insurance eligibility partners.
- EHR adapters.

### Phase 7 — Mission Control

- Whole surface — not begun.

### Phase 8 — Enterprise scale / multi-clinic controls

- Multi-tenant aware facility scoping (currently per-clinic).
- Cross-clinic reporting.
