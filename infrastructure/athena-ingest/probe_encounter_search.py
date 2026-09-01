"""
probe_encounter_search.py

Fallback probe: can we pull the FORWARD schedule via Encounter *search*
(status=planned + date window), using the Encounter.rs scope we already have?
Read-only. Prints HTTP status + total + a sample.
"""
import base64
import json
import os
import urllib.parse
import urllib.request

import boto3

BASE = os.environ.get("ATHENA_BASE", "https://api.platform.athenahealth.com")
CLIENT_ID = os.environ["ATHENA_CLIENT_ID"]
SECRET_ARN = os.environ["ATHENA_SECRET_ARN"]
PRACTICE_ID = os.environ["ATHENA_PRACTICE_ID"]
_secrets = boto3.client("secretsmanager")


def _secret():
    return _secrets.get_secret_value(SecretId=SECRET_ARN)["SecretString"]


def get_token(scopes):
    basic = base64.b64encode(f"{CLIENT_ID}:{_secret()}".encode()).decode()
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": scopes}).encode()
    req = urllib.request.Request(
        f"{BASE}/oauth2/v1/token", data=body,
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]


def search(token, path):
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r), None
    except urllib.error.HTTPError as e:
        return e.code, None, e.read().decode()[:500]


def main():
    token = get_token("system/Encounter.rs system/Patient.rs")
    print("token OK")
    practice = f"ah-practice=Organization/a-1.Practice-{PRACTICE_ID}"

    # Variant A: date window forward + status=planned
    for label, q in [
        ("planned + date window", f"status=planned&date=ge2026-08-31&_count=50&{practice}"),
        ("date window only", f"date=ge2026-08-31&_count=50&{practice}"),
    ]:
        path = f"/fhir/r4/Encounter?{q}"
        print(f"\n=== {label} ===\nGET {path}")
        status, body, err = search(token, path)
        print("HTTP", status)
        if err:
            print("ERROR:", err)
        elif body:
            print("total:", body.get("total"), "| entries:", len(body.get("entry", [])),
                  "| next:", any(l.get("relation") == "next" for l in body.get("link", [])))
            ents = body.get("entry", [])
            if ents:
                e = ents[0]["resource"]
                print("sample:", json.dumps({
                    "status": e.get("status"), "start": (e.get("period") or {}).get("start"),
                    "type": [t.get("text") for t in e.get("type", [])],
                    "subject": (e.get("subject") or {}).get("reference"),
                }))


if __name__ == "__main__":
    main()
