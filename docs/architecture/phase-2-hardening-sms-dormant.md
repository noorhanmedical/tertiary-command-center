# Phase 2 hardening — SMS dormant (item 6)

## Goal

Make absolutely sure no surface tells the operator "SMS sent" when
no real SMS provider is configured.

## Audit results

- `server/services/communication/communicationLogService.ts` accepts
  `kind: "sms_scaffold"`. Today no caller writes that kind because
  no SMS sender exists.
- `client/src/components/portal/LogCommunicationDialog.tsx`
  supports an `sms` type, but the underlying writer is a generic
  patient communication log — it does NOT actually dispatch an
  SMS. We do not promote this in PR hardening 6 either.
- No server route sends SMS. No client component initiates an SMS
  via a provider SDK.

## Surface change (CommunicationTimeline)

`labelFor(kind, summary, fallback)` re-labels SMS rows:

- `kind === "sms_scaffold"` or `"sms"` → label becomes
  "`<summary>` (SMS scaffold — not sent)" or "SMS scaffold (not
  sent)".

So even if a future caller writes a `sms_scaffold` row to the
journey log, the timeline honestly says "not sent".

## Anti-pattern guards

`qa-phase-2-hardening-sms-dormant.mjs`:

- communicationLogService must keep `sms_scaffold` as the only SMS
  kind it accepts.
- No server route may call a real SMS provider SDK
  (`twilio.messages.create`, `ringcentral.platform.send`, etc.).
- CommunicationTimeline must wrap SMS rows with the "not sent"
  suffix.
- No portal component fakes an "SMS sent" toast or status.
- The Communication Log dialog's "sms" type stays read-only logging
  (no provider dispatch).

## Future enablement path

To enable SMS properly (NOT in scope here):

1. Add a real SMS provider adapter (env-gated similar to
   RingCentral).
2. Add a `POST /api/portal/send-sms` route that uses the adapter.
3. Update `communicationLogService` to accept a new `kind: "sms"`
   for genuine sends — keep `sms_scaffold` for the dormant path.
4. Update `CommunicationTimeline` to use a real "Sent" label only
   for `kind: "sms"` (genuine send), keeping the scaffold suffix
   for `kind: "sms_scaffold"`.

## Update — Task #648: SMS enabled via Twilio adapter

The enablement path above has been executed:

- `server/integrations/twilioSms.ts` is the single provider
  integration point (Replit Twilio connector first, then
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`
  env vars). When neither is configured, `getTwilioConfig()` returns
  null and every surface shows an honest "not connected" boundary.
- `server/routes/patientMessages.ts` exposes
  `/api/portal/patient-messages/*` (status, threads, thread, send,
  patient picker) plus the public Twilio inbound webhook
  `POST /api/sms/twilio/inbound`. Sends are recorded as `sent` ONLY
  after Twilio accepts; provider failures persist as `failed` with
  the error message.
- `communicationLogService` now accepts `kind: "sms"` for genuine
  sends; `sms_scaffold` remains and is still labeled "not sent" by
  `CommunicationTimeline`.
- Message store: `patient_sms_messages`
  (migration 0045, `shared/schema/patientSms.ts`).
- The QA guard (`qa-phase-2-hardening-sms-dormant.mjs`) now enforces
  the honesty invariants of the ENABLED state (single adapter,
  gated config, honest failure recording, scaffold labeling).
