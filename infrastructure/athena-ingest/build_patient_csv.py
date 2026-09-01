"""
build_patient_csv.py

Reads a completed athenaOne bulk-export run from S3 (NDJSON, 13-17 FHIR
resource types) and writes ONE flat per-patient CSV back to S3, matching the
Plexus master layout:

  patient_id, practice_id, mrn, family_name, given_name, birth_date, gender,
  race, ethnicity, marital_status, language, address_line, city, state,
  postal_code, phone, email, hx, rx, dx, insurance

Blob columns (multi-line text, one entry per line):
  hx  -> [ENC] encounters + [RPT] diagnostic reports (reverse-chronological)
  rx  -> [RX]  medication requests (blocks separated by '---')
  dx  -> [DX]  conditions
  insurance -> [INS]/[INS-Primary]/[INS-Secondary] coverage

Streams NDJSON from S3 (no full-object caching beyond what's needed to group
per patient). Writes the CSV via a temp file then uploads to S3.

Env / config:
  INGEST_BUCKET   source+dest bucket (e.g. fhir-bulk-exp-athena-33071-...)
  RUN_TS          run folder under incoming/ (e.g. 20260830T050557)
  ATHENA_PRACTICE_ID  practice id for the practice_id column (e.g. 33071)
  COHORT_ONLY     '1' to keep only patients with an Encounter in last 365d;
                  default '0' (ALL patients).
  OUTPUT_PREFIX   dest prefix, default 'processed'

Usage (container / local):
  python build_patient_csv.py                 # uses env
  python build_patient_csv.py <RUN_TS>        # override run ts
"""

import csv
import io
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import boto3

BUCKET = os.environ["INGEST_BUCKET"]
PRACTICE_ID = os.environ.get("ATHENA_PRACTICE_ID", "33071")
RUN_TS = os.environ.get("RUN_TS", "")
COHORT_ONLY = os.environ.get("COHORT_ONLY", "0") in ("1", "true", "yes")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "processed")
COHORT_WINDOW_DAYS = 365

s3 = boto3.client("s3")

COLUMNS = [
    "patient_id", "practice_id", "mrn", "family_name", "given_name",
    "birth_date", "gender", "race", "ethnicity", "marital_status", "language",
    "address_line", "city", "state", "postal_code", "phone", "email",
    "hx", "rx", "dx", "insurance", "labs",
]

# US-Core extension URLs
RACE_URL = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race"
ETHNICITY_URL = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity"


def _iter_ndjson(resource_type):
    """Yield parsed resources for a type across all NDJSON files in the run."""
    prefix = f"incoming/{RUN_TS}/{resource_type}/json/"
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".ndjson"):
                continue
            body = s3.get_object(Bucket=BUCKET, Key=key)["Body"]
            # Stream line by line; athena embeds control chars -> strict=False.
            for raw in io.TextIOWrapper(body, encoding="utf-8"):
                line = raw.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line, strict=False)
                except Exception:
                    continue


def _patient_ref_id(resource):
    ref = (resource.get("subject") or resource.get("patient") or {}).get("reference", "")
    return ref.split("/")[-1] if ref else None


def _fmt_dt(s):
    return s or ""


# --------------------------- demographic parsing ---------------------------
def parse_patients():
    rows = {}
    for p in _iter_ndjson("Patient"):
        pid = p.get("id")
        if not pid:
            continue
        names = p.get("name", [])
        nm = next((n for n in names if n.get("use") == "official"), (names or [{}])[0])
        addrs = p.get("address", [])
        addr = next((a for a in addrs if a.get("use") == "home"), (addrs or [{}])[0])
        tel = p.get("telecom", [])

        race = ethnicity = ""
        for ext in p.get("extension", []):
            if ext.get("url") == RACE_URL:
                race = _extract_uscore_text(ext)
            elif ext.get("url") == ETHNICITY_URL:
                ethnicity = _extract_uscore_text(ext)

        marital = ""
        mc = (p.get("maritalStatus") or {}).get("coding") or []
        if mc:
            marital = mc[0].get("display", "")

        language = ""
        comm = p.get("communication", [])
        if comm:
            lang = comm[0].get("language", {})
            language = lang.get("text") or (
                (lang.get("coding") or [{}])[0].get("code", "")
            )

        rows[pid] = {
            "patient_id": pid,
            "practice_id": PRACTICE_ID,
            "mrn": pid.split("E-")[-1] if "E-" in pid else pid,
            "family_name": nm.get("family", ""),
            "given_name": " ".join(nm.get("given", [])),
            "birth_date": p.get("birthDate", ""),
            "gender": p.get("gender", ""),
            "race": race,
            "ethnicity": ethnicity,
            "marital_status": marital,
            "language": language,
            "address_line": ", ".join(addr.get("line", [])),
            "city": addr.get("city", ""),
            "state": addr.get("state", ""),
            "postal_code": addr.get("postalCode", ""),
            "phone": next((t.get("value", "") for t in tel if t.get("system") == "phone"), ""),
            "email": next((t.get("value", "") for t in tel if t.get("system") == "email"), ""),
        }
    return rows


def _extract_uscore_text(ext):
    """Prefer the 'text' sub-extension, else ombCategory display."""
    subs = ext.get("extension", [])
    for s in subs:
        if s.get("url") == "text" and s.get("valueString"):
            return s["valueString"]
    for s in subs:
        if s.get("url") == "ombCategory":
            return (s.get("valueCoding") or {}).get("display", "")
    return ""


# ------------------------------- blob builders ------------------------------
def _enc_line(e):
    period = e.get("period") or {}
    start = period.get("start", "")
    types = e.get("type") or []
    type_txt = types[0].get("text", "") if types else ""
    cls = (e.get("class") or {}).get("display") or (e.get("class") or {}).get("code") or "Ambulatory"
    reasons = e.get("reasonCode") or []
    reason = reasons[0].get("text", "") if reasons else ""
    return f"[ENC] {start} | {cls} - {type_txt} | reason: {reason}"


def _rpt_line(dr):
    eff = dr.get("effectiveDateTime") or (dr.get("effectivePeriod") or {}).get("start") or dr.get("issued", "")
    cat = dr.get("category") or []
    cat_txt = cat[0].get("text") if cat and cat[0].get("text") else "Laboratory"
    code = (dr.get("code") or {})
    name = code.get("text") or ((code.get("coding") or [{}])[0].get("display", ""))
    status = dr.get("status", "")
    return f"[RPT] {eff} | {cat_txt}: {name} | status: {status}"


def build_medication_lookup():
    """id -> medication name, from the Medication NDJSON (for reference joins)."""
    lookup = {}
    for med in _iter_ndjson("Medication"):
        mid = med.get("id")
        code = med.get("code") or {}
        name = code.get("text") or ((code.get("coding") or [{}])[0].get("display", ""))
        if mid and name:
            lookup[mid] = name
    return lookup


def _rx_block(m, med_lookup):
    # athena delivers the drug name via medicationReference (display, or a
    # Medication resource we join on), NOT inline. Fall back to any inline
    # codeable concept (e.g. CVX-coded vaccines).
    med_txt = ""
    drug_code = ""
    drug_sys = ""
    mref = m.get("medicationReference") or {}
    if mref:
        med_txt = mref.get("display", "")
        if not med_txt:
            ref_id = mref.get("reference", "").split("/")[-1]
            med_txt = med_lookup.get(ref_id, "")
    med = (m.get("medicationCodeableConcept") or {})
    if not med_txt:
        med_txt = med.get("text") or ((med.get("coding") or [{}])[0].get("display", ""))
    coding = (med.get("coding") or [{}])[0]
    drug_code = coding.get("code", "")
    drug_sys = coding.get("system", "")
    dosage = m.get("dosageInstruction") or [{}]
    d0 = dosage[0] if dosage else {}
    dosage_txt = d0.get("text", "")
    route = (d0.get("route") or {}).get("text", "")
    dose_qty = (((d0.get("doseAndRate") or [{}])[0].get("doseQuantity")) or {})
    dose = f"{dose_qty.get('value','')} {dose_qty.get('unit','')}".strip()
    timing_txt = ((d0.get("timing") or {}).get("code") or {}).get("text", "")
    disp = m.get("dispenseRequest") or {}
    qty = (disp.get("quantity") or {})
    qty_txt = f"{qty.get('value','')} {qty.get('unit','')}".strip()
    refills = disp.get("numberOfRepeatsAllowed", "")
    supply = (disp.get("expectedSupplyDuration") or {}).get("value", "")
    reasons = m.get("reasonCode") or []
    reason = ""
    if reasons:
        rc = (reasons[0].get("coding") or [{}])[0]
        reason = f"{rc.get('code','')} - {reasons[0].get('text', rc.get('display',''))}".strip(" -")
    status = m.get("status", "")
    authored = m.get("authoredOn", "")
    return (
        f"[RX] {med_txt}\n"
        f"  Drug     : {drug_code} ({drug_sys})\n"
        f"  Dosage   : {dosage_txt}\n"
        f"  Route    : {route}\n"
        f"  Dose     : {dose}\n"
        f"  Timing   : {timing_txt}\n"
        f"  Dispense : {qty_txt} x {refills} refills | supply: {supply} days\n"
        f"  Reason   : {reason}\n"
        f"  Status   : {status} | authored: {authored}"
    )


def _dx_line(c):
    code = (c.get("code") or {})
    coding = (code.get("coding") or [{}])[0]
    icd = coding.get("code", "")
    disp = code.get("text") or coding.get("display", "")
    status = ((c.get("clinicalStatus") or {}).get("coding") or [{}])[0].get("code", "")
    recorded = c.get("recordedDate", "") or (c.get("onsetDateTime", ""))
    return f"[DX] {icd} {disp} | status: {status or 'unknown'} | recorded: {recorded}"


def _ins_line(cov):
    order = cov.get("order")
    kind = (cov.get("type") or {})
    kind_txt = kind.get("text") or ((kind.get("coding") or [{}])[0].get("display", ""))
    member = cov.get("subscriberId") or ""
    grp = ""
    for cls in cov.get("class", []):
        if (cls.get("type") or {}).get("text", "").lower() == "group" or \
           ((cls.get("type") or {}).get("coding") or [{}])[0].get("code") == "group":
            grp = cls.get("value", "")
    rel = ((cov.get("relationship") or {}).get("coding") or [{}])[0].get("code", "") or \
          (cov.get("relationship") or {}).get("text", "")
    status = cov.get("status", "")
    since = (cov.get("period") or {}).get("start", "")
    tag = "[INS-Primary]" if order == 1 else ("[INS-Secondary]" if order == 2 else "[INS]")
    parts = [f"Type: {kind_txt}", f"Member: {member}"]
    if grp:
        parts.append(f"Group: {grp}")
    parts.append(f"Rel: {rel}")
    parts.append(f"Status: {status}")
    if since:
        parts.append(f"Since: {since}")
    return f"{tag} " + " | ".join(parts)


def _sort_key_desc(line):
    # Extract leading ISO datetime for reverse-chronological sort; fallback low.
    import re
    m = re.search(r"\d{4}-\d{2}-\d{2}(T[\d:.\-+]+)?", line)
    return m.group(0) if m else ""


def _lab_line(o):
    code = o.get("code") or {}
    name = code.get("text") or ((code.get("coding") or [{}])[0].get("display", ""))
    eff = o.get("effectiveDateTime") or (o.get("effectivePeriod") or {}).get("start", "") or o.get("issued", "")
    # value: quantity, string, coded, or component-based
    val = ""
    vq = o.get("valueQuantity")
    if vq:
        val = f"{vq.get('value','')} {vq.get('unit','')}".strip()
    elif o.get("valueString"):
        val = o["valueString"]
    elif o.get("valueCodeableConcept"):
        vcc = o["valueCodeableConcept"]
        val = vcc.get("text") or ((vcc.get("coding") or [{}])[0].get("display", ""))
    elif o.get("component"):
        parts = []
        for comp in o["component"]:
            cn = (comp.get("code") or {}).get("text", "")
            cq = comp.get("valueQuantity") or {}
            parts.append(f"{cn}={cq.get('value','')} {cq.get('unit','')}".strip())
        val = "; ".join(parts)
    rng = ""
    rr = o.get("referenceRange") or []
    if rr:
        rng = rr[0].get("text", "")
    status = o.get("status", "")
    tail = f" (ref: {rng})" if rng else ""
    return f"[LAB] {eff} | {name}: {val}{tail} | status: {status}"


def build_blobs(cohort_ids, med_lookup):
    """Return per-patient hx/rx/dx/insurance/labs blobs."""
    hx = {}   # encounters + reports
    rx = {}
    dx = {}
    ins = {}
    labs = {}

    for e in _iter_ndjson("Encounter"):
        pid = _patient_ref_id(e)
        if pid and (cohort_ids is None or pid in cohort_ids):
            hx.setdefault(pid, []).append(_enc_line(e))
    for dr in _iter_ndjson("DiagnosticReport"):
        pid = _patient_ref_id(dr)
        if pid and (cohort_ids is None or pid in cohort_ids):
            hx.setdefault(pid, []).append(_rpt_line(dr))
    for m in _iter_ndjson("MedicationRequest"):
        pid = _patient_ref_id(m)
        if pid and (cohort_ids is None or pid in cohort_ids):
            rx.setdefault(pid, []).append((_sort_key_desc(m.get("authoredOn", "")), _rx_block(m, med_lookup)))
    for c in _iter_ndjson("Condition"):
        pid = _patient_ref_id(c)
        if pid and (cohort_ids is None or pid in cohort_ids):
            dx.setdefault(pid, []).append(_dx_line(c))
    for cov in _iter_ndjson("Coverage"):
        pid = (cov.get("beneficiary") or {}).get("reference", "").split("/")[-1] or _patient_ref_id(cov)
        if pid and (cohort_ids is None or pid in cohort_ids):
            ins.setdefault(pid, []).append((cov.get("order", 9), _ins_line(cov)))
    # ALL lab/observation results with values.
    for o in _iter_ndjson("Observation"):
        pid = _patient_ref_id(o)
        if pid and (cohort_ids is None or pid in cohort_ids):
            labs.setdefault(pid, []).append(_lab_line(o))

    # sort
    hx = {p: "\n".join(sorted(v, key=_sort_key_desc, reverse=True)) for p, v in hx.items()}
    dx = {p: "\n".join(sorted(v, key=_sort_key_desc, reverse=True)) for p, v in dx.items()}
    rx = {p: "\n---\n".join(b for _, b in sorted(v, key=lambda x: x[0], reverse=True)) for p, v in rx.items()}
    ins = {p: "\n".join(b for _, b in sorted(v, key=lambda x: x[0])) for p, v in ins.items()}
    labs = {p: "\n".join(sorted(v, key=_sort_key_desc, reverse=True)) for p, v in labs.items()}
    return hx, rx, dx, ins, labs


def active_cohort():
    cutoff = datetime.now(timezone.utc) - timedelta(days=COHORT_WINDOW_DAYS)
    cohort = set()
    for e in _iter_ndjson("Encounter"):
        pid = _patient_ref_id(e)
        start = (e.get("period") or {}).get("start")
        if not (pid and start):
            continue
        try:
            dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if dt >= cutoff:
            cohort.add(pid)
    return cohort


def main():
    global RUN_TS
    if len(sys.argv) > 1:
        RUN_TS = sys.argv[1]
    if not RUN_TS:
        raise SystemExit("RUN_TS not set (env or arg 1)")

    print(f"[{time.strftime('%H:%M:%S')}] building CSV for run {RUN_TS} | cohort_only={COHORT_ONLY}", flush=True)

    cohort_ids = active_cohort() if COHORT_ONLY else None
    if cohort_ids is not None:
        print(f"  active cohort size: {len(cohort_ids)}", flush=True)

    patients = parse_patients()
    print(f"  patients parsed: {len(patients)}", flush=True)
    if cohort_ids is not None:
        patients = {p: r for p, r in patients.items() if p in cohort_ids}
        print(f"  patients after cohort filter: {len(patients)}", flush=True)

    med_lookup = build_medication_lookup()
    print(f"  medication names in lookup: {len(med_lookup)}", flush=True)

    hx, rx, dx, ins, labs = build_blobs(cohort_ids, med_lookup)

    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="")
    writer = csv.DictWriter(tmp, fieldnames=COLUMNS, quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    for pid, row in patients.items():
        row = dict(row)
        row["hx"] = hx.get(pid, "")
        row["rx"] = rx.get(pid, "")
        row["dx"] = dx.get(pid, "")
        row["insurance"] = ins.get(pid, "")
        row["labs"] = labs.get(pid, "")
        writer.writerow(row)
    tmp.flush()
    tmp.close()

    suffix = "cohort" if COHORT_ONLY else "all"
    key = f"{OUTPUT_PREFIX}/{RUN_TS}/patient_master_{suffix}.csv"
    s3.upload_file(tmp.name, BUCKET, key)
    size = os.path.getsize(tmp.name)
    os.unlink(tmp.name)

    print(f"[{time.strftime('%H:%M:%S')}] DONE", flush=True)
    result = {
        "bucket": BUCKET,
        "run_ts": RUN_TS,
        "output_key": key,
        "patients_written": len(patients),
        "csv_bytes": size,
    }
    print(json.dumps(result, indent=2), flush=True)
    return result


if __name__ == "__main__":
    main()
