# Ancillary report upload contract

**Status:** Docs-only (Batch F3 of Phase 1 run).
**Companion:** `scripts/qa-ancillary-report-upload-contract.mjs`.

Pins the future report-ingress surface so the storage target, MIME
constraints, size limits, and routing are decided BEFORE any code
lands. F3 is docs+QA only; the ingress route is added in a future
approved batch.

## Storage target

| Layer | Where |
|---|---|
| Blob bytes | `document_blobs` (existing — content-addressed via `sha256`) |
| Logical row | `documents` table, `kind=report` |
| Document surface | `documents.surface=ancillary` |

The blob layer is already content-addressed: duplicate uploads
collapse on `sha256`. Report uploads MUST go through this layer; no
parallel blob store.

## Allowed MIME types

| MIME | Extension |
|---|---|
| `application/pdf` | `.pdf` |
| `image/jpeg` | `.jpg`, `.jpeg` |
| `image/png` | `.png` |
| `image/tiff` | `.tiff`, `.tif` |

Anything else is rejected with `415 Unsupported Media Type`.

## Size limits

- Hard max: 25 MiB per upload.
- 413 returned for anything above the hard max.
- Multipart body parser must enforce server-side; client-side checks
  are UX only.

## Ingress shape (planned for the future batch)

```
POST /api/ancillary/reports
Content-Type: multipart/form-data
fields:
  patientScreeningId (required, integer)
  kind=report       (required, fixed)
  uploadedByUserId  (required, string)
  notes             (optional, string)
file: <bytes>
```

Response: 201 with `{ id, sha256, kind, surface, createdAt }`. Errors
follow the 4xx envelopes above.

## Feature flag

| Flag | Default | Scope |
|---|---|---|
| `USE_ANCILLARY_REPORT_UPLOAD` | OFF | Route registration gate |

Default OFF. Production flip requires explicit Ali approval.

## What ingress MUST NOT do

- Sign the report (signing is F5/F6, separate state machine).
- Mutate `patient_screenings.reasoning` (Admin Review territory).
- Touch `outreach_calls` / `patient_journey_events` (Engagement).
- Generate or modify a PDF (PDF behavior is protected — F6 contract
  expands the boundary, no behavior change without approval).
- Auto-mark billing readiness (Segment G aggregates separately).

## Boundaries with other modules

- **F2 read-model:** observes report presence via the `documents` row.
  Does not write.
- **Engagement:** unaware of report ingress.
- **Plexus IQ:** unaware of report ingress.
- **Admin Review:** unaware of report ingress.
- **Billing readiness (G):** consumes report presence; never writes
  the blob or the row.

## Related contracts

- [[phase-1-ancillary-boundary-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of contract.
