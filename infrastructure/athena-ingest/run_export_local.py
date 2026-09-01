"""
run_export_local.py — local (non-Lambda) runner for the athena bulk export.

Invokes the SAME validated handler in athena_bulk_export_to_s3.py with an
explicit resource-type list, so we can run the pull on a workstation without
the 15-minute Lambda timeout. Credentials + config come from the environment
(exported by the caller). Prints a JSON result on success.

Usage:
    python run_export_local.py Patient,Condition,Encounter,...
    python run_export_local.py ALL            # full 17-type set
"""
import json
import sys
import time

import athena_bulk_export_to_s3 as m

ALL_TYPES = m.EXPORT_TYPES


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "ALL"
    types = ALL_TYPES if arg == "ALL" else [t for t in arg.split(",") if t]
    print(f"[{time.strftime('%H:%M:%S')}] starting export | {len(types)} types: {types}", flush=True)
    t0 = time.time()
    try:
        result = m.handler({"types": types})
    except Exception as e:  # surface the failure clearly in the log
        print(f"[{time.strftime('%H:%M:%S')}] FAILED after {round(time.time()-t0)}s: {e!r}", flush=True)
        return 1
    result["elapsed_seconds"] = round(time.time() - t0)
    print(f"[{time.strftime('%H:%M:%S')}] DONE:\n{json.dumps(result, indent=2)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
