# Plexus OS - Ancillaries — Backup & Disaster Recovery

**Scope:** technical DR posture for the Plexus AWS environment. A backup is NOT
considered validated until a restore has been successfully tested (see §5).

---

## 1. Current backup state (VERIFIED — staging)

| Item | State |
|---|---|
| RDS automated backups | Enabled, **7-day** retention (staging) |
| RDS backup window | 07:42–08:12 UTC |
| RDS PITR (point-in-time restore) | Available — latest restorable time tracked continuously |
| RDS automated snapshots present | Yes (2 at inspection) |
| RDS deletion protection | **OFF (staging)** — ON in production stack |
| RDS Multi-AZ | OFF (staging) — ON in production stack |
| S3 documents bucket | **Versioning ENABLED** (object-level recovery) |
| S3 removal policy | RETAIN |
| ECS | Stateless; recovered by redeploying the SHA-pinned image (no data) |

## 2. Production targets (encoded in PlexusProduction stack)

| Item | Production setting |
|---|---|
| RDS backup retention | **21 days** (within 14–30 day window) |
| RDS Multi-AZ | **Enabled** (automatic failover) |
| RDS deletion protection | **Enabled** |
| RDS removal policy | **SNAPSHOT** (final snapshot on delete) |
| RDS storage autoscaling | 50 GB → 200 GB max |
| S3 | Versioned, BPA on, SSE (CMK in prod follow-up) |

## 3. RPO / RTO objectives (proposed — confirm with owner)

| Metric | Target (production) | Basis |
|---|---|---|
| **RPO** (max data loss) | ≤ 5 minutes | RDS PITR transaction-log granularity |
| **RTO** (max downtime) | ≤ 1 hour | Multi-AZ failover (seconds–minutes) or PITR restore-to-new-instance (typically <1h for this size) + ECS redeploy |

## 4. Restore procedure (RDS PITR → new instance; NON-destructive)

Never restore over a live instance. Always restore to a NEW identifier, verify,
then repoint the app.

```
# 1. Restore to a new instance at a chosen timestamp (or latest restorable).
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier plexus-prod-postgres \
  --target-db-instance-identifier plexus-prod-postgres-restore-<ts> \
  --restore-time <ISO8601>            # or --use-latest-restorable-time \
  --db-subnet-group-name <prod-db-subnet-group> \
  --vpc-security-group-ids <prod-db-sg> \
  --no-publicly-accessible --region us-east-1

# 2. Wait until available, then validate row counts / schema on the RESTORE
#    instance (never on the live one).
# 3. Repoint DATABASE_URL secret to the restored endpoint (or promote), then
#    roll the ECS service (SHA-pinned image, no schema push on startup).
# 4. Keep the original instance until the restore is confirmed good.
```

S3 object recovery (versioned bucket):
```
# Recover a deleted/overwritten object to a prior version.
aws s3api list-object-versions --bucket plexus-prod-documents-<acct> --prefix <key>
aws s3api copy-object --bucket <b> --key <key> \
  --copy-source "<b>/<key>?versionId=<goodVersionId>"
```

## 5. Restore-TEST procedure (required before "validated")

Run in a NON-production, NON-destructive way on a schedule (e.g. monthly):
1. PITR-restore prod (or a copy) to `...-drtest-<ts>` in an isolated SG.
2. Connect read-only; verify: table count, row-count sanity on key tables,
   schema hash matches the canonical migration baseline, a known synthetic
   record resolves. **No real PHI leaves the restored instance; no PHI in logs.**
3. Record the measured restore duration (actual RTO) and the restorable
   timestamp gap (actual RPO).
4. Tear down the drtest instance.
5. A backup/DR claim is only "validated" after a successful documented restore
   test. Until then, DR status = UNVALIDATED.

## 6. Current DR status

- **Staging:** backups on (7d) + PITR + S3 versioning, but **restore test NOT
  yet performed** → DR = **UNVALIDATED**.
- **Production:** DR settings encoded in stack (Multi-AZ, 21d, deletion
  protection, final snapshot) but **not deployed and not restore-tested**.

## 7. Guardrails
- Never restore over an existing instance/bucket.
- Never point a DR test at the live app.
- Restore tests use synthetic verification only; no real PHI in test output/logs.
