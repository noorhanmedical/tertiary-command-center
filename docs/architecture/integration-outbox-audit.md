# Integration Outbox — Coverage Audit

> **Scope:** Where external writes happen in this repo (Google
> Drive / Google Sheets / email / S3 / PDF export) and whether
> they're queued through `outbox_items` or written inline. The
> outbox is the *intended* canonical queue for at-least-once external
> writes with retry + dead-letter visibility; the audit below names
> which flows are covered, which bypass it, and where the gaps are.
>
> No mutations land in this batch. This doc is an inventory.

## Outbox schema reference

`shared/schema/outbox.ts`

- Table: `outbox_items`
- Kinds today: `drive_file` · `sheet_billing` · `sheet_patients`
- Statuses: `pending` · `uploading` · `completed` · `failed`
- Columns include `attempts`, `errorText`, `resultId`, `resultUrl`,
  `isTest`, `lastAttemptAt`, `completedAt`.

## Outbox service

`server/services/outbox.ts` exposes:

- `enqueueDriveFile(...)` — enqueues a `drive_file` row pointing at
  a blob in `documentBlobs`.
- `enqueueSheetSync(kind)` — idempotent sheet sync enqueue (skips
  if a `pending`/`failed` row already exists for the kind).
- `listOutboxItems({ status, kind, isTest })`
- `drainOutbox()` — picks up `pending` items, marks `uploading`,
  attempts the upload, sets `completed` or `failed` (with
  `attempts` + `errorText`).
- `deleteOutboxItem(id)` — admin-only via route.
- `getOutboxSummary()` — counts by status/kind.

`server/services/syncService.ts` runs the drain on an interval
(see `backgroundSyncPatients` / `backgroundSyncBilling`).

## Routes

`server/routes/outbox.ts` (`requireAdmin`):

- `GET /api/outbox` — list + summary.
- `POST /api/outbox/drain` — manual drain trigger.
- `POST /api/outbox/enqueue-sheets` — manual sheet sync.
- `DELETE /api/outbox/:id` — admin delete.

UI: `client/src/pages/admin-outbox.tsx` is the admin dashboard.

## External write flows in this repo

| Flow | Provider | Through outbox? | Notes |
| --- | --- | --- | --- |
| Document generation → Drive upload | `server/integrations/googleDrive.ts` | **Yes** (`drive_file`) | Generated PDF lands in a blob first; outbox row carries it to Drive with retry + result URL captured back. |
| Billing roster → Sheets | Google Sheets | **Yes** (`sheet_billing`) | `enqueueSheetSync("sheet_billing")` is the canonical path. |
| Patient roster → Sheets | Google Sheets | **Yes** (`sheet_patients`) | Same pattern as billing. |
| Patient communications email send | `nodemailer` via `emailService.ts` | **No** — sent inline | Outbound text logs a `patient_communications` row; failures surface as a 500. No retry, no DLQ. |
| Invoice reminder email | `invoiceReminderService.ts` → `emailService.ts` | **No** — sent inline | Schedule runs `morningRebuildScheduler`; a failed SMTP send drops the reminder. |
| Marketing material PDF generation | `marketingMaterials.ts` | **Mixed** — PDF is created locally and surfaced via download; when shared via Drive it goes through `enqueueDriveFile`. The Drive path is covered, the direct-download path is not (and doesn't need to be — no external side effect). |
| S3 blob upload (avatar/large file) | `s3FileStorage.ts` | **No** — sync upload | Uploads run inline during request; failures bubble back. |
| AI generation calls (OpenAI) | `aiClient.ts` → `noteGenerationServer.ts` / `batchAnalysisRunner.ts` | **No** — sync RPC | Idempotent at the application layer via `analysis_jobs` row state; no outbox queue. |

## Gaps named explicitly

1. **Email sends are not queued.**
   - Patient communications outbound email (`emailService.sendMail`)
     and invoice reminder email both run inline. A failed SMTP send
     is logged but not retried.
   - Adding an `outbox_kind = "email"` (with `targetEmail`,
     `subject`, `bodyKey`, `templateId`) would unify retry semantics
     with Drive / Sheets.

2. **No dead-letter queue.**
   - `outbox_items.status = "failed"` rows accumulate without a
     reaper / DLQ topic. `attempts` increments, but there's no
     "give up after N tries" gate; manual admin action via
     `DELETE /api/outbox/:id` is the only escape.
   - Recommended: a service-level guard
     (e.g. `attempts >= 5` flips status to `dead_letter` and emits
     a journey event tagged `outbox_dead_letter`) plus an admin
     filter for the new status.

3. **No idempotency keys on drive_file rows.**
   - `enqueueDriveFile` does not currently dedupe by content hash;
     two enqueues for the same blob produce two Drive uploads.
   - `enqueueSheetSync` already deduplicates by kind +
     pending/failed status — extending that pattern with a
     content hash to `drive_file` is the canonical close.

4. **AI calls have no outbox path.**
   - `analysis_jobs` carries job state but failures don't retry
     automatically. The `batchAnalysisRunner` is a manual
     re-trigger surface. An `outbox_kind = "ai_generation"`
     would centralize the retry contract.

5. **No audit cross-link.**
   - Outbox completions don't currently write to the audit log /
     `patient_journey_events`. When a Drive upload completes, the
     `documents.driveFileId` is set, but there's no journey event
     tagged `external_write_completed`. Adding one would close
     the loop on the operational audit trail.

## What this batch DID NOT change

- No outbox writers added.
- No retry / DLQ logic added.
- No email enqueue path added.
- No mutations on existing services.

## Recommended close order

1. Add `outbox_kind = "email"` + queue helper in
   `emailService` (`enqueueEmail`) — preserve `sendMail` for the
   dev path.
2. Implement DLQ in `outbox.drain()` (status promotion at
   `attempts >= 5`).
3. Add content-hash dedupe to `enqueueDriveFile`.
4. Cross-link successful outbox drains to
   `patient_journey_events` when the source row has a
   `patientScreeningId`.
5. (Optional) Promote `analysis_jobs` to a retry-driven outbox
   kind so AI generation has the same operational visibility.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md` —
  spine reference.
- `server/services/outbox.ts` — queue + drain.
- `server/services/syncService.ts` — background runner.
- `server/routes/outbox.ts` — API surface.
- `client/src/pages/admin-outbox.tsx` — admin dashboard.
