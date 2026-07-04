---
name: Dev DB migration lag
description: Dev database can be missing older migration tables; event writers swallow the failure silently.
---
Migrations under `migrations/*.sql` are NOT auto-applied to the dev database — apply manually with `psql "$DATABASE_URL" -f migrations/NNNN_*.sql`.

**Why:** the patient_directory_events table (an older migration) was missing from dev even though newer migrations had been applied, and the event-writer's try/catch swallowed every insert failure — features looked "working" while producing zero audit events.

**How to apply:** when a feature writes to a table via a fire-and-forget/try-catch path, verify the table actually exists in dev (`\dt` or a direct SELECT) before trusting green e2e results; check for skipped older migrations, not just the latest one.
