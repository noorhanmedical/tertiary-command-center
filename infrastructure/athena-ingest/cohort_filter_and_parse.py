"""
cohort_filter_and_parse.py

Phase 3 (post-download) step for the athenaOne bulk-all pipeline.

Strategy (decided 2026-08-09): bulk $export the WHOLE practice, then filter
DOWN to the active cohort here — patients with an Encounter in the last 365
days. Bulk $export cannot take a patient-ID list, so cohort scoping happens
at parse time, not at export time.

IMPORTANT: "seen in last year" = Encounter.period.start >= today-365d.
Do NOT use _since — _since filters by record-UPDATE time, not visit date,
so it would wrongly include stale patients whose record was merely touched.

Input layout (written by athena_bulk_export_to_s3.py, ECW-compatible):
    {base}/incoming/{run_ts}/{ResourceType}/json/{n}.ndjson
Also handles the older group layout via load_all_patients_from_ndjson_groups.

Downstream: feeds build_flat_patient_csv(...) -> master rows -> qualification
-> master DB upsert (keyed by MRN, tagged clinic_id).

Parsing rule carried over from per-patient work: json.loads(..., strict=False)
because athena embeds control chars (newlines/tabs) in narrative text.
"""

import glob
import json
import os
from datetime import datetime, timedelta, timezone

COHORT_WINDOW_DAYS = 365


def _iter_ndjson(base_path, resource_type):
    """Yield resource dicts for a given type across all run/group folders."""
    patterns = [
        os.path.join(base_path, "incoming", "*", resource_type, "json", "*.ndjson"),
        os.path.join(base_path, "incoming", "*", resource_type, "*.ndjson"),
        os.path.join(base_path, "*", "*", resource_type, "json", "*.ndjson"),
        os.path.join(base_path, "*", resource_type, "json", "*.ndjson"),
    ]
    seen_files = set()
    for pat in patterns:
        for fp in glob.glob(pat):
            if fp in seen_files:
                continue
            seen_files.add(fp)
            with open(fp) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line, strict=False)  # tolerate control chars
                    except Exception:
                        continue


def _patient_ref_id(resource):
    """Extract the patient FHIR id a resource points to."""
    ref = (resource.get("subject") or resource.get("patient") or {}).get("reference", "")
    # e.g. "Patient/a-33071.E-21672"
    return ref.split("/")[-1] if ref else None


def active_cohort(base_path, window_days=COHORT_WINDOW_DAYS):
    """
    Return the set of patient FHIR ids with an Encounter whose period.start
    is within the last `window_days`.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    cohort = set()
    for enc in _iter_ndjson(base_path, "Encounter"):
        pid = _patient_ref_id(enc)
        if not pid:
            continue
        start = (enc.get("period") or {}).get("start")
        if not start:
            continue
        try:
            # handle 'Z' and offset forms
            dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if dt >= cutoff:
            cohort.add(pid)
    return cohort


def build_resource_dicts(base_path, cohort_ids):
    """
    Build resource_type -> {patient_id: [records]} for cohort patients only.
    Keys match build_flat_patient_csv's expected `resource_dicts` shape.
    """
    type_map = {
        "encounters": "Encounter",
        "conditions": "Condition",
        "medications": "MedicationRequest",
        "diagnostic_reports": "DiagnosticReport",
        "procedures": "Procedure",
        "documents": "DocumentReference",
        "observations": "Observation",
        "coverage": "Coverage",
        "allergies": "AllergyIntolerance",
        "immunizations": "Immunization",
    }
    out = {k: {} for k in type_map}
    for out_key, rtype in type_map.items():
        for r in _iter_ndjson(base_path, rtype):
            pid = _patient_ref_id(r) or (r.get("id") if rtype == "Patient" else None)
            if pid in cohort_ids:
                out[out_key].setdefault(pid, []).append(r)
    return out


def parse_patients(base_path, cohort_ids):
    """patient_id -> demographic dict, cohort only."""
    rows = {}
    for p in _iter_ndjson(base_path, "Patient"):
        pid = p.get("id")
        if pid not in cohort_ids:
            continue
        nm = next((n for n in p.get("name", []) if n.get("use") == "official"),
                  (p.get("name") or [{}])[0])
        addr = next((a for a in p.get("address", []) if a.get("use") == "home"),
                    (p.get("address") or [{}])[0])
        tel = p.get("telecom", [])
        rows[pid] = {
            "patient_id": pid,
            "mrn": pid.split("E-")[-1] if "E-" in pid else pid,
            "last_name": nm.get("family", ""),
            "first_name": " ".join(nm.get("given", [])),
            "gender": p.get("gender", ""),
            "birth_date": p.get("birthDate", ""),
            "phone": next((t["value"] for t in tel if t.get("system") == "phone"), ""),
            "email": next((t["value"] for t in tel if t.get("system") == "email"), ""),
            "address": ", ".join(addr.get("line", [])),
            "city": addr.get("city", ""),
            "state": addr.get("state", ""),
            "zip": addr.get("postalCode", ""),
        }
    return rows


def run(base_path, clinic_id, output_path):
    """Full Phase-3: cohort filter -> per-patient rows -> flat master CSV."""
    cohort = active_cohort(base_path)
    patient_rows = parse_patients(base_path, cohort)
    resource_dicts = build_resource_dicts(base_path, cohort)
    # build_flat_patient_csv is pre-loaded in the Plexus run_python namespace.
    path = build_flat_patient_csv(patient_rows, resource_dicts, output_path)  # noqa: F821
    return {
        "clinic_id": clinic_id,
        "active_cohort_size": len(cohort),
        "patients_written": len(patient_rows),
        "output_path": path,
    }


if __name__ == "__main__":
    import sys
    base = sys.argv[1] if len(sys.argv) > 1 else "/Users/abdulrahmanalhadheri/Desktop/fhir-bulk-exp-incoming"
    print(json.dumps(run(base, "33071", "artifacts/athena_33071_master.csv"), indent=2))
