"""
probe_appointments.py

Read-only probe of athenaOne's FHIR R4 Appointment search, to confirm:
  1. our OAuth app has system/Appointment.rs scope granted
  2. the date-window search syntax works
  3. how many upcoming appointments actually exist

Does NOT write anything. Prints scope/HTTP results + a small sample.

Env: ATHENA_CLIENT_ID, ATHENA_SECRET_ARN, ATHENA_PRACTICE_ID, ATHENA_BASE(optional)
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
        f"{BASE}/oauth2/v1/token",
        data=body,
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
            return data.get("access_token"), data.get("scope", ""), None
    except urllib.error.HTTPError as e:
        return None, None, f"{e.code} {e.read().decode()[:300]}"


def search(token, path):
    url = f"{BASE}{path}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r), None
    except urllib.error.HTTPError as e:
        return e.code, None, e.read().decode()[:500]


def main():
    print("=== 1. token with Appointment.rs (+Patient/Coverage) ===")
    scopes = "system/Appointment.rs system/Patient.rs system/Coverage.rs"
    token, granted, err = get_token(scopes)
    if err:
        print("TOKEN FAILED:", err)
        print("\n>>> Likely means the app lacks Appointment scope. Add it in the")
        print(">>> Developer Console (Scopes -> FHIR R4 SMART V2 -> Appointment read+search).")
        return
    print("token OK. granted scope string:", granted or "(not returned)")

    group_practice = f"ah-practice=Organization/a-1.Practice-{PRACTICE_ID}"
    # Try a forward date window: 2026-08-31 .. 2027-12-31
    date_q = "date=ge2026-08-31&date=le2027-12-31"

    print("\n=== 2. Appointment search (date window) ===")
    path = f"/fhir/r4/Appointment?{date_q}&_count=100&{group_practice}"
    print("GET", path)
    status, body, err = search(token, path)
    print("HTTP", status)
    if err:
        print("ERROR body:", err)
    elif body:
        print("Bundle.type:", body.get("type"), "| total:", body.get("total"))
        entries = body.get("entry", [])
        print("entries on page 1:", len(entries))
        has_next = any(l.get("relation") == "next" for l in body.get("link", []))
        print("has next page:", has_next)
        if entries:
            appt = entries[0].get("resource", {})
            print("\n--- sample Appointment ---")
            print(json.dumps({
                "id": appt.get("id"),
                "status": appt.get("status"),
                "start": appt.get("start"),
                "end": appt.get("end"),
                "description": appt.get("description"),
                "serviceType": appt.get("serviceType"),
                "participant": [p.get("actor", {}).get("reference") for p in appt.get("participant", [])],
            }, indent=2))


if __name__ == "__main__":
    main()
