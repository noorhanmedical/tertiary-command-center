# Phase 1 environment variable inventory

**Status:** Docs-only (Batch H2 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-env-var-inventory.mjs`.

Inventory of every `process.env.*` and `import.meta.env.VITE_*` value
the codebase reads, their purpose, whether they're secret, default
posture, and what happens when missing.

## Server-side (process.env)

### Required at boot

| Variable | Purpose | Secret? | Missing behavior |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string. | YES | App fails to start. |
| `NODE_ENV` | `development` / `production`. | no | Defaults handled in code. |
| `PORT` | HTTP listen port. | no | Defaults to 5000. |
| `SESSION_SECRET` | Signs session cookies. | YES | App fails to start. |

### Required for prod sends / integrations

| Variable | Purpose | Secret? |
|---|---|---|
| `OPENAI_API_KEY` | LLM access for qualification + summarization. | YES |
| `OPENAI_MODEL` | Override default LLM model. | no |
| `OPENAI_MAX_CONCURRENT` | Concurrency cap. | no |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Alternate AI access key. | YES |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Alternate AI base URL. | no |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Outbound mail. | YES (creds) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google integrations. | YES |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Drive parent. | no |
| `GOOGLE_SHEETS_PATIENTS_ID` | Patients sheet id. | no |
| `GOOGLE_SHEETS_BILLING_ID` | Billing sheet id. | no |
| `AWS_REGION` | AWS region. | no |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS creds. | YES |
| `S3_BUCKET_NAME` | S3 bucket (not used in Phase 1; reserved). | no |
| `STORAGE_PROVIDER` | Document storage backend toggle. | no |

### Feature flags (all default OFF unless noted)

| Variable | Default | Owner | Scope |
|---|---|---|---|
| `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` | OFF | callResult engagement route | Engagement delegation |
| `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` | OFF | callResult outreach route | Outreach delegation |
| `USE_PORTAL_CALL_HISTORY_READ` | OFF | portal route | GET /api/portal/calls gate |
| `USE_OPERATIONAL_QUEUE_CALL_LIST` | OFF | call-list aggregator | Bridge gate |
| `USE_RINGCENTRAL_ADAPTER` | OFF | E6 adapter scaffold | Telephony adapter |
| `USE_ANCILLARY_READ_MODEL` | OFF | F2 read-model scaffold | Ancillary read |
| `USE_ANCILLARY_REPORT_UPLOAD` | OFF | F3 contract | Future ingress route |
| `USE_ANCILLARY_SIGNING_SERVICE` | OFF | F6 signing scaffold | Signing transitions |
| `USE_BILLING_READINESS_AGGREGATOR_V2` | OFF | G2 aggregator scaffold | Pure aggregator |
| `USE_INVOICING_SCAFFOLD_V2` | OFF | G4 invoicing scaffold | Draft projection |
| `USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT` | OFF | E2 contract | Future directory endpoint |
| `ENGAGEMENT_TO_CALL_LIST_BRIDGE` | OFF | engagement bridge | Bridge between engagement + call list |

### Background-job knobs (already shipped)

| Variable | Purpose |
|---|---|
| `BATCH_ANALYSIS_CONCURRENCY` | Qualification job concurrency cap. |
| `CALL_LIST_BASE_DAILY_TARGET` | Daily target for call-list builder. |
| `CALL_LIST_BUILD_HOUR` | Hour the morning build runs. |
| `CALL_LIST_TICK_MS` | Builder tick interval. |
| `MORNING_REBUILD_DISABLED` | Kill switch for the morning rebuild. |
| `ABSENCE_*` | Absence watcher knobs. |
| `INVOICE_REMINDER_*` | Invoice reminder scheduler knobs. |

### Replit-managed (read-only at runtime)

| Variable | Purpose |
|---|---|
| `REPL_ID` / `REPL_OWNER` / `REPL_SLUG` / `REPL_IDENTITY` | Replit identity. |
| `REPLIT_CONNECTORS_HOSTNAME` / `REPLIT_DEPLOYMENT` / `WEB_REPL_RENEWAL` | Replit runtime hints. |

### Test-only

| Variable | Purpose |
|---|---|
| `PARITY_TEST_DATE_FROM` / `PARITY_TEST_DATE_TO` / `PARITY_TEST_FACILITY` / `PARITY_TEST_USER_ID` / `PARITY_TEST_INCLUDE_CLOSED` | Parity test scoping. |

## Client-side (import.meta.env.VITE_*)

All VITE_* flags default OFF and must be passed at build time. The
production build for Phase 1 must NOT set any of these truthy unless
Ali explicitly approves a specific flip.

| Variable | Owner | Scope |
|---|---|---|
| `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` | E4 | Structured selector render gate inside DispositionSheet |
| `VITE_USE_LEGACY_DISPOSITION_WRITE` | E9 | One-release rollback for legacy primary write |
| `VITE_USE_PATIENT_CALL_HISTORY_READ` | E7 | Call-history panel render gate |
| `VITE_USE_INVOICE_UI` | G5 | Invoice draft panel render gate |
| `VITE_USE_RINGCENTRAL_CLICK_TO_CALL` | E5 contract | Future click-to-call UI |
| `VITE_USE_PATIENT_DIRECTORY_WIRING` | E2 contract | Future patient-directory UI |
| `VITE_USE_ANCILLARY_PANEL_SECTIONS` | F1 contract | Future ancillary UI sections |
| `VITE_USE_STRUCTURED_CALL_RESULT_ENDPOINT` | engagementCallResultEndpoint helper | Existing helper's plural/singular endpoint toggle |

## Secrets handling

- Secret values come from AWS Secrets Manager (staging/prod) or the
  developer's local env (local). Never from a committed file.
- `.gitignore` blocks `.env*` (per H1).
- A key check appears on every QA sweep — committing a secret-shaped
  value to the repo halts deploy.

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[ringcentral-adapter-contract]]
- [[team-portal-structured-call-result-selector-contract]]
- [[team-portal-canonical-call-result-write-switch-plan]]
- [[phase-1-invoicing-boundary-contract]]
- [[team-portal-patient-directory-wiring-contract]]

End of inventory.
