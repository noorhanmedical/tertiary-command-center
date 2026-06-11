# Phase 1 AWS backup / restore runbook

**Status:** Docs-only (Batch H4 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-aws-backup-runbook.mjs`.

Manual backup + restore runbook for the staging Postgres (and, when
approved, production Postgres). No automation is committed in Phase
1; every step is operator-run.

## Backup posture

- **Cadence:** Daily logical dump via `pg_dump` to S3 (operator-run).
- **Retention:** 14 daily snapshots in S3; older snapshots aged out
  manually until automation lands in a later phase.
- **Encryption:** S3 SSE-KMS using the staging KMS key alias
  `alias/tertiary-staging`.
- **PHI handling:** Backups CONTAIN PHI. Access to the backup bucket
  is restricted to the deploy IAM role; no individual user has
  read.

## Backup procedure

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=/tmp/tertiary-$TS.dump
aws s3 cp /tmp/tertiary-$TS.dump \
  s3://tertiary-staging-backups/$TS.dump \
  --sse aws:kms \
  --sse-kms-key-id alias/tertiary-staging
rm /tmp/tertiary-$TS.dump
```

If `pg_dump` errors, STOP. Investigate connectivity / DB lock /
permissions before retrying.

## Restore procedure (staging only)

1. Snapshot the current staging DB FIRST (run the backup procedure
   above before any destructive restore).
2. Choose the snapshot to restore:
   ```bash
   aws s3 ls s3://tertiary-staging-backups/ | tail
   ```
3. Download the dump:
   ```bash
   aws s3 cp s3://tertiary-staging-backups/$SNAPSHOT.dump /tmp/restore.dump
   ```
4. Wipe and restore (staging only — NEVER prod without explicit Ali
   approval):
   ```bash
   psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" /tmp/restore.dump
   rm /tmp/restore.dump
   ```
5. Restart the staging service per the H3 runbook.
6. Run the H5 smoke-test runbook.

## What this runbook does NOT do

- Auto-schedule backups (manual today; automated in a later phase).
- Run a destructive restore against production.
- Modify the schema as part of restore. (The dump should match the
  active schema; otherwise STOP and call Ali.)
- Touch Plexus IQ, Admin Review, or any UI surface.

## Disaster matrix

| Scenario | Action |
|---|---|
| Lost row | Run a `pg_restore --table=…` against a temp DB and copy the row back. |
| Lost table | Run a `pg_restore --table=…` against staging; do NOT run a full restore. |
| Total DB loss | Full restore from latest snapshot. Notify Ali first. |
| Backup bucket unreachable | Halt deploy. Open AWS support ticket. |

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[phase-1-aws-deploy-runbook]]
- [[phase-1-aws-smoke-test-runbook]]
- [[phase-1-env-var-inventory]]

End of runbook.
