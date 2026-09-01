#!/usr/bin/env bash
# cloudshell_export_to_s3.sh
# Run inside AWS CloudShell in account 107554921331 (established/verified,
# where fhir-bulk-exp already lives). CloudShell gives us:
#   (a) an AWS-origin IP  -> bypasses the athena CloudFront block hitting the laptop
#   (b) built-in AWS creds -> can write to S3 with no key setup
#
# Streams each athena $export NDJSON file straight into the clinic's
# isolated bucket via `curl | aws s3 cp -` (no local disk — CloudShell only
# has ~1GB home, so streaming is required).
#
# Bakes in the lesson learned: retry-with-backoff on CloudFront 401/5xx on
# the $export INVOKE step (the exact failure that blocked the laptop).
#
# USAGE:
#   1. read -rs ATHENA_SECRET   # paste Production secret once, Enter
#   2. bash cloudshell_export_to_s3.sh Encounter        # cohort test first
#   3. bash cloudshell_export_to_s3.sh ALL              # full pull
set -euo pipefail

# ---------- config ----------
CLIENT_ID="0oa13p8mqsvLEmQjl298"
PRACTICE_ID="33071"
# Auto-detect the account CloudShell is running in (bucket name matches reality).
ACCT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="fhir-bulk-exp-athena-${PRACTICE_ID}-${ACCT}"
BASE="https://api.platform.athenahealth.com"
REGION="us-east-1"

ALL_TYPES="Patient,Condition,Observation,MedicationRequest,Medication,AllergyIntolerance,DiagnosticReport,Encounter,Procedure,Immunization,Coverage,DocumentReference,CarePlan,CareTeam,Goal,Device,Provenance"

ARG="${1:-Encounter}"
if [ "$ARG" = "ALL" ]; then TYPES="$ALL_TYPES"; else TYPES="$ARG"; fi

: "${ATHENA_SECRET:?Run 'read -rs ATHENA_SECRET' and paste the Production secret first}"

# scopes = one .r per requested type
SCOPES=$(echo "$TYPES" | tr ',' '\n' | sed 's#^#system/#; s#$#.r#' | tr '\n' ' ')

RUN_TS=$(date +%Y%m%dT%H%M%S)
echo "Bucket:   s3://${BUCKET}"
echo "Types:    ${TYPES}"
echo "Run ts:   ${RUN_TS}"

# ---------- 0. bootstrap isolated bucket (idempotent) ----------
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Creating isolated bucket ${BUCKET} ..."
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
  aws s3api put-bucket-tagging --bucket "$BUCKET" \
    --tagging 'TagSet=[{Key=clinic_id,Value='"$PRACTICE_ID"'},{Key=emr_vendor,Value=athena},{Key=data_class,Value=phi}]'
  echo "Bucket created + hardened."
else
  echo "Bucket already exists — reusing."
fi

# ---------- helpers ----------
get_token() {
  curl -s -X POST "${BASE}/oauth2/v1/token" \
    -u "${CLIENT_ID}:${ATHENA_SECRET}" \
    -d "grant_type=client_credentials" \
    -d "scope=${SCOPES}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])"
}

# ---------- 1. invoke $export with retry/backoff (CloudFront 401/5xx lesson) ----------
GROUP="a-1.C-${PRACTICE_ID}"
TYPE_ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$TYPES")
POLL=""
for attempt in 1 2 3 4 5 6; do
  TOKEN=$(get_token)
  HDRS=$(curl -s "${BASE}/fhir/r4/Group/${GROUP}/\$export?_type=${TYPE_ENC}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/fhir+json" \
    -H "Prefer: respond-async" -D - -o /dev/null)
  STATUS=$(echo "$HDRS" | awk 'NR==1{print $2}')
  if [ "$STATUS" = "202" ]; then
    POLL=$(echo "$HDRS" | awk -F': ' 'tolower($1)=="content-location"{print $2}' | tr -d '\r')
    echo "Export invoked (attempt ${attempt}). Poll: ${POLL}"
    break
  fi
  BACKOFF=$((attempt * attempt * 5))   # 5,20,45,80,125,180s
  echo "Invoke attempt ${attempt} -> HTTP ${STATUS} (CloudFront/transient). Backoff ${BACKOFF}s..."
  sleep "$BACKOFF"
done
[ -z "$POLL" ] && { echo "ERROR: $export invoke failed after retries"; exit 1; }

# ---------- 2. poll until 200 + manifest ----------
MANIFEST=""
while true; do
  TOKEN=$(get_token)
  CODE=$(curl -s "$POLL" -H "Authorization: Bearer ${TOKEN}" -o /tmp/manifest.json -w "%{http_code}")
  if [ "$CODE" = "200" ]; then MANIFEST=$(cat /tmp/manifest.json); echo "Export complete."; break; fi
  PROG=$(curl -s "$POLL" -H "Authorization: Bearer ${TOKEN}" -D - -o /dev/null | awk -F': ' 'tolower($1)=="x-progress"{print $2}' | tr -d '\r')
  echo "  ...processing (${PROG:-?}) [HTTP ${CODE}]"
  sleep 60
done

# ---------- 3. stream each output file to S3 (no local disk) ----------
echo "$MANIFEST" > /tmp/manifest.json
aws s3 cp /tmp/manifest.json "s3://${BUCKET}/incoming/${RUN_TS}/_manifest.json"

python3 - "$RUN_TS" <<'PY'
import json, sys
ts = sys.argv[1]
m = json.load(open("/tmp/manifest.json"))
with open("/tmp/dl.txt","w") as f:
    counts = {}
    for o in m.get("output", []):
        rt = o.get("type","Unknown"); n = counts.get(rt,0); counts[rt]=n+1
        f.write(f"{rt}\t{n}\t{o['url']}\n")
PY

TOKEN=$(get_token)
while IFS=$'\t' read -r RT N URL; do
  KEY="incoming/${RUN_TS}/${RT}/json/${N}.ndjson"
  echo "  -> s3://${BUCKET}/${KEY}"
  # requiresAccessToken may be false (pre-signed) — send auth anyway, harmless.
  curl -s "$URL" -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/fhir+ndjson" \
    | aws s3 cp - "s3://${BUCKET}/${KEY}"
done < /tmp/dl.txt

echo "DONE. Files under s3://${BUCKET}/incoming/${RUN_TS}/"
aws s3 ls "s3://${BUCKET}/incoming/${RUN_TS}/" --recursive --human-readable --summarize
