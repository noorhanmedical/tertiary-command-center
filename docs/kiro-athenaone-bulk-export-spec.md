# Kiro Spec: athenaOne FHIR Bulk Export Pipeline (Practice 33071)

## Goal
Build and deploy an automated pipeline that pulls the full patient population from an athenaOne clinic (Practice 33071, ~11,756 patients), lands the data in an isolated S3 bucket, filters to an active cohort (seen in last 365 days), and feeds it into Command Center's `patient_directory` table.

## Context — What's Already Done (Aug 9 session)

### 1. athenaOne Developer Portal & App Registration
- **Developer account:** emr@plexusclinical.com (Ayman Alhadheri) at https://developer.api.athena.io/ams-portal
- **Production app:** "Plexus Clinical Data Extraction"
  - Client ID: `0oa13p8mqsvLEmQjl298`
  - Secret: stored in terminal via `read -rs ATHENA_SECRET` (⚠️ MUST be rotated and stored in AWS Secrets Manager — the old secret was exposed in chat)
  - API access: Certified APIs ONLY (free, no contract)
  - Auth: 2-legged OAuth (client_credentials), client secret
  - Scopes: FHIR R4 SMART V2 read + search (`system/{Resource}.r` and `.rs`)
- **Preview app** also exists (Client ID `0oa13p8e2jzS1FoHT298`) — used for sandbox testing, not needed for production.

### 2. Clinic Authorization
- Practice ID: **33071** (Life Medical Center, Michigan, ~11,756 patients)
- Clinic admin authorized our app via athenaOne Settings → Manage Certified API App Access ✅
- Bulk export Group ID: `a-1.C-33071`

### 3. Auth Flow (validated end-to-end)
```
POST https://api.platform.athenahealth.com/oauth2/v1/token
  Auth: HTTP Basic (client_id:client_secret) — NEVER body params
  Body: grant_type=client_credentials&scope=system/Patient.rs system/Condition.rs system/Encounter.rs system/MedicationRequest.rs system/Observation.rs system/Procedure.rs system/DiagnosticReport.rs system/DocumentReference.rs system/AllergyIntolerance.rs system/Immunization.rs system/Coverage.rs system/CarePlan.rs system/CareTeam.rs system/Goal.rs system/Device.rs system/Provenance.rs system/Medication.rs
  Returns: {"access_token":"eyJ...","expires_in":3600,"token_type":"Bearer"}
```
- Token lifetime: 3600s (1 hour)
- SMART v2 scope syntax: `.r` = read, `.s` = search, `.rs` = both. NOT `.read` (that's v1).
- Global FHIR base (Prod): `https://api.platform.athenahealth.com/fhir/r4`
- Practice addressing: query param `?ah-practice=Organization/a-1.Practice-33071` (NOT in URL path)

### 4. Bulk $export Flow (validated — Patient export succeeded, returned 11,756 patients)
```
1. INVOKE:  GET /fhir/r4/Group/a-1.C-33071/$export?_type=Patient,Condition,...
            Headers: Authorization: Bearer $TOKEN, Accept: application/fhir+json, Prefer: respond-async
            Returns: HTTP 202 + Content-Location header (poll URL)

2. POLL:    GET {poll URL}
            Returns: HTTP 202 (x-progress: NN%) while running → HTTP 200 + JSON manifest when done

3. DOWNLOAD: manifest.output[] lists signed NDJSON URLs per resource type
             requiresAccessToken may be false (pre-signed) — send auth anyway
```

### 5. Production Artifacts (already written, in agent_files)
Located at: `~/.quickwork/profiles/social-a769360181a0/chat_agent_files/SYSTEM/agent_files/artifacts/athenaone_integration/production/`

- **`clinic-ingest-bucket.ts`** — CDK construct: per-clinic isolated S3 bucket + dedicated KMS key + scoped writer IAM role. Usage: `new ClinicIngestBucket(this, 'Clinic33071', { clinicId: '33071', emrVendor: 'athena' })`
- **`athena_bulk_export_to_s3.py`** — Lambda: token → $export → poll (with Retry-After) → stream NDJSON to S3 via upload_fileobj (no local disk). Auto-detects account ID for bucket naming.
- **`cohort_filter_and_parse.py`** — Post-download filter: reads Encounter NDJSON, keeps patients with `period.start >= today-365d`, builds resource_dicts for qualification pipeline.
- **`cloudshell_export_to_s3.sh`** — Bash script for running from CloudShell: bootstraps bucket (idempotent), invokes $export with retry/backoff, polls, streams to S3.

### 6. Architecture Decisions
- **S3 isolation:** Separate bucket per clinic (new clinics only). Bucket name: `fhir-bulk-exp-athena-33071-{accountId}`. Existing ECW groups stay in `fhir-bulk-exp`.
- **Strategy:** Bulk-all → filter downstream. Bulk $export pulls ALL patients (can't filter by cohort at export time — athena limitation), then `cohort_filter_and_parse.py` keeps only patients with encounters in last 365 days.
- **Encounter date for cohort:** Use `Encounter.period.start >= today-365d`, NOT `_since` (which is record-update time, not visit date).
- **Resources to export:** Patient, Condition, Observation, MedicationRequest, Medication, AllergyIntolerance, DiagnosticReport, Encounter, Procedure, Immunization, Coverage, DocumentReference, CarePlan, CareTeam, Goal, Device, Provenance
- **S3 layout (ECW-compatible):** `incoming/{timestamp}/{ResourceType}/json/{n}.ndjson`

### 7. Known Numbers
- Practice 33071: 11,756 total patients (roster export confirmed)
- Estimated full-pull size: ~6 GB (all resources); ~2.5 GB without DocumentReference
- DocumentReference dominates (~56% of per-patient footprint)
- One validated patient: Micah Tolbert (MRN 21672, FHIR id `a-33071.E-21672`) — 68 Dx, 22 Rx, 45 labs, Medicaid HMO, active

## Critical Gotchas (all discovered empirically)

1. **SMART v2 scope syntax:** `.r` not `.read`. Requesting `.read` against a v2 app → "Policy evaluation failed."
2. **⚠️ $export REQUIRES `.rs` (read+search) scopes — NOT `.r` alone.** This was a 20-day blocker. `.r` = read-by-id only; `.s` = search only; `.rs` = both. The $export operation is a search-class operation — requesting a token with only `.r` scopes returns `401 "Invalid authorization token. Must have appropriately scoped permissions... Must have scopes allowing read+search for each resource being exported."` The token request MUST use `system/{Resource}.rs` for every resource type being exported. Confirmed working Aug 29 2026.
3. **MedicationRequest search requires `&intent=order`** — without it, returns a "required parameter combinations" error.
4. **Practice is a query param, not a path segment:** `?ah-practice=Organization/a-1.Practice-{id}`, NOT `/{id}/fhir/r4/...`
5. **Auth MUST be HTTP Basic** (`-u id:secret`), never POST body params.
6. **Bulk $export does NOT paginate.** Returns complete NDJSON files listed in the manifest. No `Bundle.link[next]`, no `intent`, no search params.
7. **Per-patient search DOES paginate** (default page size 20). Must follow `Bundle.link[next]` for full history.
8. **JSON parsing must use `strict=False`** — athena embeds control chars (newlines/tabs) in narrative text fields. `json.loads(line, strict=False)` handles it.
9. **Bulk $export is NOT for daily syncs** — athena throttles it behind provider workflows. Use for initial/periodic full loads; use targeted reads or Data View for daily freshness.
10. **`x-cache: Error from cloudfront` in a 401 is NOT a WAF block** — it's CloudFront passing through athena's own 401 response. We misdiagnosed this for 20 days. The actual cause was always insufficient scopes (`.r` vs `.rs`). Still use exponential backoff for retries, but don't assume a 401 means you're gateway-blocked.
11. **New apps start with ZERO scopes** — must be added in the Developer Console (Scopes tab → Edit Scopes → FHIR R4 SMART V2).
12. **Production apps are self-service for Certified-only** — no form/email needed; create via the Developer Console with Environment = Production.

## AWS Account Map

| Account | Role | ID |
|---|---|---|
| Payer/management | Org root | `052808603738` |
| Dev | Holds `fhir-bulk-exp`, target for athenaOne pipeline | `107554921331` |
| Prod | Holds Command Center (ECS + RDS) | `374604322534` |

- CLI access to dev: `--profile dev` (assume `OrganizationAccountAccessRole` from `plexus-admin` in payer, with MFA `arn:aws:iam::052808603738:mfa/admin-abdul`)
- Root user CANNOT Switch Role — must use IAM user `plexus-admin`

## Blockers (status as of Aug 29 2026)

1. **AWS billing:** ✅ PAID (was restricted for non-payment on payer 052808603738 → cascaded org-wide → blocked CloudShell/deploys)
2. **athena $export:** ✅ RESOLVED (Aug 29 2026). Root cause was requesting `.r` scopes instead of `.rs` — the 401 was a normal auth rejection, NOT a gateway block. Fix: use `system/{Resource}.rs` in the token request. Validated: Encounter export job `16c3ef79-cc78-4ff3-b482-f8b0b51903b8` launched successfully with `.rs` scope.

**No remaining blockers.** All infrastructure and API access is clear for Kiro to proceed.
## What Kiro Needs To Do

### Phase 1 — Verify & Deploy Infrastructure
1. **Store athena Production secret in Secrets Manager** (dev account 107554921331). Name: `athena/33071/client-secret`. Rotate the exposed one in the Developer Console first.
2. **Deploy `ClinicIngestBucket`** for practice 33071 via CDK in dev account. The construct is written (`clinic-ingest-bucket.ts`); wire it into the existing CDK stack.
3. **Deploy the export Lambda** (`athena_bulk_export_to_s3.py`) with:
   - Env vars: `ATHENA_CLIENT_ID`, `ATHENA_SECRET_ARN`, `ATHENA_PRACTICE_ID=33071`, `INGEST_BUCKET`
   - IAM: the scoped writer role from `ClinicIngestBucket` + Secrets Manager read
   - Timeout: 15 min (bulk export can take a while)
   - Runtime: Python 3.12

### Phase 2 — Run the Full Pull
4. **$export is confirmed working** (validated Aug 29 2026). No need to "test" — proceed directly. **CRITICAL:** The Lambda's token request MUST use `.rs` scopes for every resource type (e.g. `system/Patient.rs system/Encounter.rs ...`), NOT `.r`. If you see a 401 with "Must have scopes allowing read+search", the scope string is wrong.
5. **Invoke the full bulk-all export:** `_type=Patient,Condition,Observation,MedicationRequest,Medication,AllergyIntolerance,DiagnosticReport,Encounter,Procedure,Immunization,Coverage,DocumentReference,CarePlan,CareTeam,Goal,Device,Provenance`
   Token scope: `system/Patient.rs system/Condition.rs system/Observation.rs system/MedicationRequest.rs system/Medication.rs system/AllergyIntolerance.rs system/DiagnosticReport.rs system/Encounter.rs system/Procedure.rs system/Immunization.rs system/Coverage.rs system/DocumentReference.rs system/CarePlan.rs system/CareTeam.rs system/Goal.rs system/Device.rs system/Provenance.rs`
6. **Stream NDJSON to** `s3://fhir-bulk-exp-athena-33071-107554921331/incoming/{timestamp}/{ResourceType}/json/{n}.ndjson`

### Phase 3 — Parse & Load into Command Center
7. **Run cohort filter** (`cohort_filter_and_parse.py`): keep patients with Encounter `period.start >= today-365d`
8. **Map to `patient_directory`** schema (per the Patient Directory Rearchitecture Decision — Kiro spec `workspace/artifacts/kiro-patient-directory-rearchitect.md`):
   - MRN (dedup key), clinic_id=33071, demographics, insurance (Coverage), Dx, Rx, encounters
   - clinic_id is integer FK to clinics table (watch for the TEXT bug noted in known entities)
9. **Upsert into patient_directory** — match by MRN within clinic_id, insert new / update existing

### Phase 4 — Automate
10. Schedule periodic re-runs (EventBridge → Lambda, e.g. weekly)
11. Use `_since={last_run_timestamp}` on subsequent runs for incremental/delta pulls (note: this filters by record-update time, not visit date — the cohort filter handles the clinical date)

## File References
All production code is in `infrastructure/athena-ingest/` within this repo:
- CDK construct: `infrastructure/athena-ingest/clinic-ingest-bucket.ts`
- Export Lambda: `infrastructure/athena-ingest/athena_bulk_export_to_s3.py`
- Cohort filter: `infrastructure/athena-ingest/cohort_filter_and_parse.py`
- CloudShell script: `infrastructure/athena-ingest/cloudshell_export_to_s3.sh`
- This spec: `docs/kiro-athenaone-bulk-export-spec.md`
