# Email Outbox Migration — Plan

> **Scope:** Inline `emailService.sendMail()` callers and the
> migration path to put each one behind the existing outbox queue.
> Read-only plan — no migration runs here.

## Today

`server/services/emailService.ts` exposes `sendMail()` (nodemailer).
Three callers send email inline:

1. `server/services/invoiceReminderService.ts` — invoice
   reminders, fired from a scheduled job.
2. `server/routes/email.ts` (`POST /api/outreach/send-email` +
   `POST /api/outreach/send-material`) — outbound marketing /
   patient communication.
3. `server/routes/invoices.ts` (`POST /api/invoices/:id/send-email`)
   — invoice PDF send.

Each path:
- writes a `patient_communications` row (where applicable).
- on failure, logs the SMTP error but returns 500 to the caller.
- has no retry, no DLQ, no idempotency key.

## Outbox today

`shared/schema/outbox.ts` declares `outbox_items` with kinds:

`drive_file` · `sheet_billing` · `sheet_patients`

Statuses: `pending` · `uploading` · `completed` · `failed`.

`server/services/outbox.ts` exposes `enqueue*` helpers + `drainOutbox()`.
The drain loop is owned by `syncService.backgroundSyncBilling` /
`backgroundSyncPatients` — both run on intervals.

## Migration target

Add a new outbox kind: `"email"`.

Required new columns (or jsonb metadata fields):
- `targetEmail: text` (could live in `outbox_items.metadata.to` as
  an array; simpler if schema stays narrow).
- `subject: text`
- `bodyKey: text` (pointer to a blob OR a templateId)
- `templateId?: text`
- `replyTo?: text`
- `idempotencyKey?: text` (hash of `(to, subject, bodyKey)`)

A drain-side adapter inside `outbox.drain()` reads pending rows of
kind `email`, looks up the rendered body, calls `sendMail()`, and
flips to `completed`/`failed` with the SMTP response captured.

## Per-caller migration plan

### 1. `invoiceReminderService.ts`

- Replace `sendMail(...)` with `enqueueEmail({ kind: "invoice_reminder", ... })`.
- The reminder text is already template-driven; pass the
  templateId + invoice id.
- Idempotency key: `(invoiceId, reminderType, scheduledFor)`.

### 2. `POST /api/outreach/send-email`

- Same swap. Add an `idempotencyKey` of
  `(patientScreeningId, subjectHash)` to prevent duplicate sends
  when a user double-clicks.

### 3. `POST /api/invoices/:id/send-email`

- This caller already accepts a PDF base64 attachment.
- Persist the PDF as a blob (`documentBlobs` already exists),
  then enqueue `{ kind: "email", attachmentBlobId, ... }`. The
  drain reads the blob and attaches it on send.

## Cross-cutting concerns

- **Audit log**: every enqueue should call `logAudit(req, "enqueue",
  "outbox_email", id, ...)`. Successful drains should append a
  `patient_journey_events.eventType = "email_sent"` row.
- **DLQ**: extend `OUTBOX_STATUSES` with `"dead_letter"` (or
  promote at `attempts >= 5` to `failed` + a metadata flag).
  Surface the new status in the admin outbox dashboard.
- **Idempotency**: the drain should look up `idempotencyKey`
  before sending; a row with the same key and `completed` status
  is a no-op for re-enqueue.

## Risk assessment

| Step | Risk | Mitigation |
| --- | --- | --- |
| Add `"email"` to `OUTBOX_KINDS` | None — additive enum | Tested by `qa:outbox-coverage` (next batch) |
| Add new optional columns | Low | jsonb metadata avoids migration |
| Replace inline `sendMail()` callers | Medium — behavior change | Keep `sendMail()` available for dev tooling; production paths go through the outbox |
| Add DLQ status | Medium | Migrate `failed` rows that crossed threshold; admin can re-queue manually |
| Add idempotency | Low | Falls back to current behavior when no key provided |

## Recommended sequence (out of scope for this audit batch)

1. Add `"email"` to `OUTBOX_KINDS` + extend the type union. No
   migration yet.
2. Add `enqueueEmail(...)` helper + drain handler. Tests in
   isolation.
3. Migrate `invoiceReminderService` first (lowest blast radius —
   reminders are idempotent by design).
4. Migrate `outreach/send-email` second.
5. Migrate `invoices/:id/send-email` last (PDF attachment path
   needs the blob lookup).
6. Add DLQ in a separate batch with a small data migration
   (status promotion script).
7. Cross-link successful drains to `patient_journey_events`.

## Cross-references

- `docs/architecture/integration-outbox-audit.md` — outbox audit
  doc (gap #1 names this migration).
- `docs/architecture/audit-log-coverage.md` — covers the audit
  cross-link contract.
- `server/services/outbox.ts` — current outbox service.
- `server/services/emailService.ts` — inline email today.
