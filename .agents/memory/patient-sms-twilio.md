---
name: Patient SMS via Twilio
description: Honest-boundary patient texting layer — adapter gating, webhook auth exemption, QA guard semantics
---

# Patient SMS (Team Portal Patients tab)

- Single provider integration point: `server/integrations/twilioSms.ts`. Connector-first, then `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` env vars. `getTwilioConfig()` returns null when unconfigured — never fake a send.
- **Why:** platform honesty rule — no fabricated messages/sends; composer disables and send returns 503 `SMS_NOT_CONNECTED` when unconnected.
- Sends persist as "sent" ONLY after Twilio accepts; provider errors persist as "failed" + errorMessage. Journey log kind is genuine `"sms"`; `"sms_scaffold"` remains the dormant kind and is still labeled "not sent".
- The inbound webhook (`POST /api/sms/twilio/inbound`) must be exempted from the global `app.use("/api", requireAuth)` session gate in `server/routes.ts` — Twilio can't hold a session. It's signature-validated when an auth token is available; connector API-key setups can't validate (open follow-up: enforce always in prod).
- **How to apply:** any new public webhook under `/api` needs the same explicit path exemption in `requireAuth` or it 401s silently.
- `scripts/qa-phase-2-hardening-sms-dormant.mjs` no longer enforces dormancy — it enforces the ENABLED honesty invariants (single adapter, gated config, honest failure recording, scaffold labeling). Don't "fix" it back to forbidding `"sms"`.
- Connector settings field names in the adapter (account_sid/api_key/api_key_secret/phone_number) are GUESSES — verify via `listConnections('twilio')` once the user actually connects.
