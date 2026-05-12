# Plexus IQ Clinical Import + Qualification Job

This document describes the bulk clinical-paste import flow added to
Plexus IQ. The flow is designed for 100–200 patients pasted from a
spreadsheet, and runs qualification as a separate durable job so the
HTTP request that imports patients never blocks on AI calls.

## Supported paste format

The new clinical-spreadsheet format uses tab-separated rows, each row
wrapped between `Start` and `End` markers. Either with a header row or
without (positional fallback).

### Required columns (in order)

```
Start  DATE  TIME  NAME  DOB  AGE  SEX  MRN  Dx  Hx  Rx  Ancillaries Completed  INSURANCE  End
```

- `DATE` — `YYYY-MM-DD` or `MM/DD/YYYY`. If blank, the page-level
  default date is applied.
- `TIME` — free-form (e.g. `09:30`, `9:30 AM`). Preserved verbatim.
- `NAME` — required. Missing names produce a row error.
- `DOB` — `YYYY-MM-DD` or `MM/DD/YYYY`. Optional. Missing DOB is
  tolerated.
- `AGE` — numeric. Parsed into the `age` column.
- `SEX` — free-form. Stored in the `gender` column.
- `MRN` — free-form. Stored in structured `notes`.
- `Dx`, `Hx`, `Rx`, `Ancillaries Completed` — long clinical text,
  multi-line per cell, preserved exactly. Never mixed.
- `INSURANCE` — free-form. Inner whitespace preserved; outer trimmed.

### Other supported formats (preserved)

- **Start/End label blocks** — multi-line free-form per block, with
  inline `DOB:` / `Hx:` / `Dx:` labels. Goes through the legacy
  per-row POST loop.
- **Legacy CSV** — `facility,date,name,type,time` header. Goes
  through the legacy per-row POST loop.

The modal auto-detects which format you've pasted and surfaces a
**Detected format** badge in the preview step.

## How clinical fields map to `patient_screenings`

| Pasted column | DB column |
| --- | --- |
| `NAME` | `name` |
| `TIME` | `time` |
| `DATE` | (used to resolve `screening_batches.scheduleDate`) |
| `DOB` | `dob` |
| `AGE` | `age` |
| `SEX` | `gender` |
| `Dx` | `diagnoses` |
| `Hx` | `history` |
| `Rx` | `medications` |
| `Ancillaries Completed` | `previousTests` (+ `noPreviousTests` flag set when the cell text contains "no record") |
| `INSURANCE` | `insurance` |
| `MRN` | `notes` (structured prefix `MRN: …`) |

No schema migration is introduced. `MRN` lives in `notes` because no
dedicated column exists; if it gets promoted to its own column later,
the parser stays unchanged — only the route's structured-notes call
needs updating.

## Import vs qualification job separation

- `POST /api/plexus-iq/clinical-import` performs the **bulk insert**
  only. It does not run AI. For 100–200 patients this is a single
  fast SQL round-trip per `(facility, scheduleDate)` group.
- `POST /api/plexus-iq/qualification-jobs` accepts `{ batchIds }` (or
  `{ patientIds }`) and starts the **qualification job** via the
  shared `batchAnalysisRunner` service. It returns `{ ok, jobId }`
  immediately; the heavy work runs in the background using
  `screenSinglePatientWithAI` with limited concurrency
  (`BATCH_ANALYSIS_CONCURRENCY` env var, default 5).

After clinical import, the page automatically kicks off a
qualification job for every batch that received new patients and
shows the status banner at the top of the workspace.

## Job status + retry

- `GET /api/plexus-iq/qualification-jobs/:jobId/status` — returns
  `{ status, total, queued, processing, completed, failed, skipped,
  percent, errors }`. The shape mirrors `/api/batches/:id/analysis-status`
  but adds per-patient failure detail by joining
  `patient_screenings.status === "error"`.
- The banner UI polls every 2.5 seconds while a job is
  `queued`/`processing` and stops polling once that job is terminal.
- `POST /api/plexus-iq/qualification-jobs/:jobId/retry-failed` resets
  patients with `status="error"` in the underlying batch back to
  `draft` and re-kicks the runner. Returns the new `jobId`; the
  affected row in the banner swaps to it automatically while the
  other jobs are untouched.

## Multi-job tracking

When a clinical import creates patients across multiple
`(facility, scheduleDate)` groups, the response from
`POST /api/plexus-iq/qualification-jobs` includes a `jobs[]` array —
one entry per batch. The Plexus IQ page tracks the full array and
renders one combined banner that:

- Polls each job concurrently via `useQueries` (one queryKey per
  jobId, refetch every 2.5s while non-terminal).
- Shows a header **patient-weighted** progress bar:
  `percent = (Σcompleted + Σfailed + Σskipped) / Σtotal`.
- Lists each job as a row underneath with its own status, counts,
  failure expander, and per-job **Retry failed** button.
- Retrying one job swaps in the new jobId in place without removing
  the other rows. All rows keep polling.
- Header status resolves to `completed` only when every row is
  terminal; if any row failed, the header status is `failed`.

Dismissing the banner clears the local list; the underlying
`analysis_jobs` rows remain on the server and are still queryable via
`/api/batches/:id/analysis-status`.

## Reliability rules

- The clinical-import endpoint **does not** call OpenAI. Importing
  cannot fail due to AI rate limits or timeouts.
- The qualification job uses the existing `batchProcess` helper
  (`p-limit` for concurrency, `p-retry` for OpenAI rate-limit
  backoff). One patient failure does not fail the whole job; failed
  patients are written with `status="error"` and surfaced in the
  status response's `errors[]`.
- Each patient result (`qualifyingTests` + `reasoning`) is saved
  immediately after the AI call returns — no batched commits at the
  end of the run.
- **No PDFs are generated** during the import or qualification job.
  Existing Plexus PDF / Clinician PDF generation continues to work
  unchanged from saved `qualifyingTests` + `reasoning` after the job
  completes.
- Single-patient analysis (`POST /api/patients/:id/analyze`) is
  untouched and continues to be the source of truth for one-off
  re-runs.

## Tests

- `npm run test:plexus-iq-clinical-parser` — 47 assertions covering
  positional/header parsing, multiline Dx/Hx/Rx, missing fields,
  quoted/whitespace cells, "No Record" tolerance, and fallback to
  the legacy formats.
- `npm run test:plexus-iq-clinical-import-api` — DB smoke test
  (skips gracefully when `DATABASE_URL` is empty). Verifies bulk
  insert preserves clinical fields without mixing and that the
  `analysis_jobs` row shape matches what the status endpoint reads.

## File map

| File | Purpose |
| --- | --- |
| `client/src/lib/plexusIqClinicalImportParser.ts` | Deterministic Start/End tab-separated parser |
| `client/src/lib/plexusIqClinicalImportApi.ts` | Fetch helpers for the new routes |
| `client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx` | Adds clinical-spreadsheet detection + format indicator |
| `client/src/components/plexus-iq/PlexusIQQualificationJobStatus.tsx` | Legacy single-job progress banner (kept; unused on the page now) |
| `client/src/components/plexus-iq/PlexusIQQualificationJobsStatus.tsx` | Multi-job banner used by `plexus-iq.tsx`: aggregates progress + per-job rows + per-job retry |
| `client/src/pages/plexus-iq.tsx` | Wires the clinical-import flow + status banner |
| `server/routes/plexusIqClinicalImport.ts` | Bulk-import endpoint + qualification-job routes |
| `server/services/batchAnalysisRunner.ts` | Shared analyze runner reused by `/api/batches/:id/analyze` and the new qualification-jobs route |
| `script/testPlexusIqClinicalImportParser.ts` | Parser regression tests |
| `script/testPlexusIqClinicalImportApi.ts` | API smoke test |
