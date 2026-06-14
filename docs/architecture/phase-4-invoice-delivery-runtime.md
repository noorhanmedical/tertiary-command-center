# Phase 4 — Invoice delivery runtime (PR 4.5)

## Schema

Migration `0037_phase4_invoice_delivery_events.sql`:
`invoice_delivery_events` (id, invoiceId, eventType, recipientSnapshot,
actorUserId, messageId, errorMessage, metadata, createdAt). Six
event types: queued, sent, failed, reminder_sent, download_generated,
blocked.

## Service

`server/services/billing/invoiceDeliveryService.ts`:

- `resolveRecipientsFromSnapshot(snapshot)` — pulls `primaryEmail`,
  `ccEmails`, `bccEmails`, `deliveryMethod` from the captured
  recipient snapshot.
- `queueDelivery({ invoiceId, actorUserId })` — checks approval,
  resolves recipients, transitions `delivery_status` to `queued`
  + logs a `queued` event. Otherwise transitions to a `blocked_*`
  state + logs a `blocked` event.
- `sendEmailDelivery({ invoiceId, actorUserId, subject, body, send })` —
  injectable `send` so the route can wire `sendOutreachEmail` while
  the service stays unit-test-friendly. On `download_only` delivery
  method, transitions to `download_only` + logs `download_generated`.
  On send success, transitions to `sent` + records `sentAt` /
  `sentTo` / `messageId`. On exception, transitions to `failed` +
  logs the error message.
- `sendReminderDelivery({...})` — wraps `sendEmailDelivery` and
  additionally updates `lastRemindedAt` + logs `reminder_sent`.

## Routes

- `GET /api/invoice-delivery-queue`
- `GET /api/invoices/:id/delivery-events`
- `POST /api/invoices/:id/queue-delivery`
- `POST /api/invoices/:id/send-email`
- `POST /api/invoices/:id/send-reminder`

Writes are admin/biller-gated. The send route wires the existing
`sendOutreachEmail` (no new provider). A future PR can swap in a
dedicated billing-mailer if needed.

## UI

`/billing/invoice-delivery` (admin-gated). Tab strip per delivery
state (counts), table of invoices, inline Queue/Send/Reminder
actions (only when allowed by current state), and an events log
panel when a row is selected.

## Honesty guarantees

- "Sent" is only set after the email service returns successfully.
- Failed sends transition to `failed` + log the error message.
- `blocked_missing_recipient` and `blocked_not_approved` keep the
  invoice in an honest visible state instead of pretending the
  send happened.
- `download_only` delivery method short-circuits to `download_only`
  + logs `download_generated` — never claims an email was sent.
