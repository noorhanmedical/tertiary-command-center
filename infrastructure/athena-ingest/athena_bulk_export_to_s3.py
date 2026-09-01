"""
athena_bulk_export_to_s3.py

Production athenaOne (athenaClinicals) FHIR Bulk $export → S3 ingestion job.
Runs IN your AWS account (Lambda / ECS task) — NOT in a local sandbox.
Streams each NDJSON output file directly from athena to the clinic's
isolated bucket (never staged on local disk).

athenaOne equivalent of the ECW "FHIR Bulk Export App", but a direct API
call instead of browser automation.

Per-clinic isolation: writes to fhir-bulk-exp-athena-{clinic_id}-<acct>.
Downstream parse (parse_fhir_resource_to_patient_dict) is unchanged — the
internal incoming/{timestamp}/{ResourceType}/ layout matches ECW.

Env / config:
  ATHENA_CLIENT_ID        athenaOne Production client id
  ATHENA_SECRET_ARN       Secrets Manager ARN holding the client secret
  ATHENA_PRACTICE_ID      e.g. '33071'
  INGEST_BUCKET           e.g. 'fhir-bulk-exp-athena-33071-107554921331'
  ATHENA_BASE             default 'https://api.platform.athenahealth.com'

Key facts baked in (validated against practice 33071):
  * Auth: 2-legged client_credentials, HTTP Basic (NOT body params).
  * Bulk $export uses SMART-v2 read+search scopes: system/{Resource}.rs
    (.r alone = read-only, insufficient for $export which is a search-class op).
  * Group id format: a-1.C-{practiceId}.
  * $export is async: 202 + Content-Location -> poll -> 200 + manifest.
  * NDJSON parsing must be strict=False (control chars in narrative text).
  * Bulk $export does NOT paginate/‘next’/intent — it returns whole-type
    NDJSON files listed in the manifest. (Those per-patient-search rules
    do NOT apply here.)
  * $export is throttled behind provider workflows — retry on 429/503
    honoring Retry-After. Not for real-time/daily sync.
"""

import base64
import json
import os
import time
import urllib.parse
import urllib.request

import boto3

ATHENA_BASE = os.environ.get("ATHENA_BASE", "https://api.platform.athenahealth.com")
CLIENT_ID = os.environ["ATHENA_CLIENT_ID"]
SECRET_ARN = os.environ["ATHENA_SECRET_ARN"]
PRACTICE_ID = os.environ["ATHENA_PRACTICE_ID"]
INGEST_BUCKET = os.environ["INGEST_BUCKET"]

# USCDI resources we pull for qualification (Hx/Rx/Dx + insurance).
EXPORT_TYPES = [
    "Patient", "Condition", "Observation", "MedicationRequest", "Medication",
    "AllergyIntolerance", "DiagnosticReport", "Encounter", "Procedure",
    "Immunization", "Coverage", "DocumentReference", "CarePlan", "CareTeam",
    "Goal", "Device", "Provenance",
]

s3 = boto3.client("s3")
_secrets = boto3.client("secretsmanager")


def _client_secret() -> str:
    return _secrets.get_secret_value(SecretId=SECRET_ARN)["SecretString"]


def get_token(scopes: str) -> str:
    """2-legged client-credentials token. HTTP Basic auth (required)."""
    basic = base64.b64encode(f"{CLIENT_ID}:{_client_secret()}".encode()).decode()
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": scopes,
    }).encode()
    req = urllib.request.Request(
        f"{ATHENA_BASE}/oauth2/v1/token",
        data=body,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]


def _scopes_for(types) -> str:
    # SMART-v2 read+search scope per resource type. $export requires .rs (not .r alone).
    return " ".join(f"system/{t}.rs" for t in types)


def invoke_export(token: str, types) -> str:
    """Kick off Group-level $export; return the Content-Location poll URL."""
    group = f"a-1.C-{PRACTICE_ID}"
    type_param = urllib.parse.quote(",".join(types))
    url = f"{ATHENA_BASE}/fhir/r4/Group/{group}/$export?_type={type_param}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/fhir+json",
            "Prefer": "respond-async",
        },
        method="GET",
    )
    with urllib.request.urlopen(req) as r:
        if r.status != 202:
            raise RuntimeError(f"Expected 202, got {r.status}")
        loc = r.headers.get("Content-Location")
    if not loc:
        raise RuntimeError("No Content-Location returned from $export")
    return loc


def poll(token: str, poll_url: str, timeout_s: int = 3600) -> dict:
    """Poll until 200 + manifest. Honor Retry-After on 202/429/503."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        req = urllib.request.Request(
            poll_url, headers={"Authorization": f"Bearer {token}"}, method="GET"
        )
        try:
            with urllib.request.urlopen(req) as r:
                if r.status == 200:
                    return json.load(r)
                retry = int(r.headers.get("Retry-After", "10"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                retry = int(e.headers.get("Retry-After", "30"))
            else:
                raise
        time.sleep(min(retry, 60))
    raise TimeoutError("Export did not complete within timeout")


def stream_output_to_s3(token: str, manifest: dict, run_ts: str) -> list:
    """
    Stream each NDJSON output file straight into the clinic bucket.
    Layout mirrors ECW:  incoming/{run_ts}/{ResourceType}/json/{n}.ndjson
    """
    written = []
    counters: dict = {}
    for out in manifest.get("output", []):
        rtype = out.get("type", "Unknown")
        url = out["url"]
        n = counters.get(rtype, 0)
        counters[rtype] = n + 1
        key = f"incoming/{run_ts}/{rtype}/json/{n}.ndjson"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/fhir+ndjson",
            },
        )
        # Stream response body directly into S3 (no local disk).
        with urllib.request.urlopen(req) as resp:
            s3.upload_fileobj(resp, INGEST_BUCKET, key)
        written.append(key)
    # Persist the manifest + any error files for auditing.
    s3.put_object(
        Bucket=INGEST_BUCKET,
        Key=f"incoming/{run_ts}/_manifest.json",
        Body=json.dumps(manifest, indent=2).encode(),
    )
    return written


def handler(event, context=None):
    types = (event or {}).get("types", EXPORT_TYPES)
    run_ts = time.strftime("%Y%m%dT%H%M%S")
    token = get_token(_scopes_for(types))
    poll_url = invoke_export(token, types)
    manifest = poll(token, poll_url)
    # refresh token before the download phase (job may have run > 1h)
    token = get_token(_scopes_for(types))
    keys = stream_output_to_s3(token, manifest, run_ts)
    return {
        "clinic_id": PRACTICE_ID,
        "bucket": INGEST_BUCKET,
        "run_ts": run_ts,
        "files_written": len(keys),
        "resource_types": sorted({k.split("/")[2] for k in keys}),
    }


if __name__ == "__main__":
    print(json.dumps(handler({}), indent=2))
