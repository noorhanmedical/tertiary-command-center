# Operational Queue — staging runbook

**Status:** Docs-only (Bundle 17). No code changed.
**Date:** 2026-06-09.
**Purpose:** Step-by-step instructions for satisfying the §7 staging gate of `operational-queue-call-list-projection-design.md` before any future production-flag-flip PR is considered.
**Audience:** On-call engineer driving the staging window. No prior context with the projection module assumed.

This runbook is the operational counterpart to:
- `operational-queue-call-list-projection-design.md` §6 (canonical log schema), §7 (gate criteria).
- `shadow-read-parity-log-analyzer-design.md` (analyzer contract).
- `scripts/parity-log-analyzer.mjs` (analyzer impl, Bundle 16).
- `scripts/qa-shadow-read-parity-log-schema.mjs` (route log schema invariant).
- `scripts/qa-shadow-read-parity-log-analyzer.mjs` (analyzer + fixture invariant).

This runbook does NOT authorise a production flag flip. It produces the evidence a separate PR can attach to its description.

---

## 0. Preconditions

- You have shell access to a clone of the repo at `~/Projects/tertiary-command-center-replit-sync` (or equivalent).
- You have read access to staging stdout/stderr logs (download path is platform-specific; document yours in `docs/architecture/aws-readiness-checklist.md` if it isn't already).
- You have permission to set environment variables on the staging deploy. You do NOT need production permissions.
- `USE_OPERATIONAL_QUEUE_CALL_LIST` default in production is OFF. This runbook will NOT change that.

---

## 1. Pre-staging canned-fixture pass

Verify the projection layer is internally consistent BEFORE flipping the staging flag.

```bash
cd ~/Projects/tertiary-command-center-replit-sync
git checkout main
git pull --ff-only

npm run check
npm run build

# Projection algorithm + module purity:
npx tsx server/modules/operational-queue/__tests__/projection-parity.test.ts
node scripts/qa-operational-queue-projection-parity.mjs

# Route log schema + PHI envelope:
node scripts/qa-shadow-read-parity-log-schema.mjs

# Analyzer + canned fixture:
node scripts/qa-shadow-read-parity-log-analyzer.mjs
```

All five commands must exit 0. If any fails, STOP. Do not proceed to §2 until the failure is root-caused and fixed in a separate PR.

---

## 2. Staging-only flag flip

Set on the staging deploy only:

```
USE_OPERATIONAL_QUEUE_CALL_LIST=1
```

Production default remains OFF. Confirm via the staging deploy console / your platform's environment-variable surface.

After the staging deploy restarts, hit one real `/api/scheduler-assignments` request (any scheduler's call list). Confirm via staging logs:

```bash
# Tail (or download) staging logs and look for the canonical prefix:
grep '\[USE_OPERATIONAL_QUEUE_CALL_LIST\] shadow-read' <staging-log-source>
```

Expected: at least one line like
```
[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read { parityMatch: true, legacyCount: ..., queueCount: ..., inLegacyOnly: 0, inQueueOnly: 0 }
```

If you see `shadow-read failed:` lines, capture them — investigate before continuing.

---

## 3. Observation window — 7 consecutive days

The window starts on the first calendar day (UTC) that includes a `shadow-read` line. The window covers 7 consecutive UTC days.

The window MUST include at least one **weekday morning** (when call-list reads peak). If your start date is a Friday, the window naturally covers the next week's Mon–Fri.

Each day:

1. Download that day's staging stdout/stderr logs to a file:
   ```
   shadow-read-YYYY-MM-DD.log
   ```
   Save into a fresh `~/parity-logs/<window-start-date>/` directory.

2. Do NOT edit, redact, or reformat the lines before saving — the analyzer enforces the canonical schema and a forbidden-identifier guard. Any mid-flight edit risks invalidating the evidence.

3. At end of day, run the analyzer in dry-run mode just on today's file:
   ```bash
   node scripts/parity-log-analyzer.mjs ~/parity-logs/<window-start-date>/shadow-read-YYYY-MM-DD.log
   ```
   Confirm the day's verdict is `pass` or `skip`. A `fail` day means STOP and triage before continuing — `fail` is load-bearing in the window verdict.

---

## 4. End-of-window verdict

After the 7th day:

```bash
node scripts/parity-log-analyzer.mjs --logs-dir ~/parity-logs/<window-start-date>/
```

The analyzer emits the per-day rows + window line. Save both the human-readable output AND the `--json` form:

```bash
node scripts/parity-log-analyzer.mjs --logs-dir ~/parity-logs/<window-start-date>/ \
  > ~/parity-logs/<window-start-date>/report.txt
node scripts/parity-log-analyzer.mjs --json --logs-dir ~/parity-logs/<window-start-date>/ \
  > ~/parity-logs/<window-start-date>/report.json
```

Pass criteria for the window (mirrors `shadow-read-parity-log-analyzer-design.md` §4):

- `overall=pass` in both reports.
- Every non-`skip` day is `pass`.
- At least one day has non-zero traffic — an all-`skip` window is `inconclusive`, NOT pass.
- `tripwires=0`. A non-zero tripwire count signals schema drift or PHI leakage and ALWAYS fails the window.

---

## 5. Interpreting verdicts

| Day verdict | What it means | What to do |
| --- | --- | --- |
| `pass` | All requests matched OR drift < 0.001 AND no errors. | Continue. |
| `fail (drift>=0.001)` | More than 0.1% of legacy ids differ from queue ids. | STOP. Investigate the projection's filter + queue source code. Do NOT continue. |
| `fail (errors>0)` | At least one `shadow-read failed:` line. | STOP. The shadow read threw. Read the error tail; if it's an infra blip (network, restart) re-do the day. If it's a code bug, fix and restart the window. |
| `skip (no traffic)` | The deploy emitted no `shadow-read` line that day. | Confirm staging was actually receiving traffic. If yes, the flag may have flipped off — re-verify. |

| Window verdict | What it means | What to do |
| --- | --- | --- |
| `pass` | All non-skip days pass + at least one day had traffic. | Attach `report.txt` and `report.json` to the future production-flag-flip PR. |
| `fail` | One or more days failed. | STOP. No production flag flip. Fix the root cause, then start a fresh 7-day window. |
| `inconclusive` | All-skip window OR no traffic at all. | Re-run the window after confirming staging is reachable and receiving traffic. |

---

## 6. PHI envelope reminder

- The analyzer redacts any line containing a prohibited identifier (`patientName`, `patientDob`, `mrn`, `insurance`, `diagnosis`, `summary:`).
- The analyzer redacts any line whose payload contains keys outside the five canonical fields.
- Tripwires from either redaction path FAIL the window regardless of `parityMatch` counts.
- Never paste raw log lines into a chat, ticket, or PR description. Use `report.txt` / `report.json` — both are counts-and-verdicts only.

---

## 7. Rollback drill (required before production flip)

Before a future production-flag-flip PR ships, perform the rollback drill on staging:

1. Run §1–§4 with `USE_OPERATIONAL_QUEUE_CALL_LIST=1` on staging — confirm `overall=pass`.
2. Set `USE_OPERATIONAL_QUEUE_CALL_LIST=0` on staging.
3. Confirm via `grep` that the staging logs **stop** emitting `[USE_OPERATIONAL_QUEUE_CALL_LIST]` lines within one minute of restart.
4. Hit `/api/scheduler-assignments` on staging again; confirm the response is identical to the response from §4 (use `curl ... | sha256sum` on two responses to the same request — they should match, since the route's response is the legacy `rows` array in both flag states).

This proves the flag is a clean kill-switch. The production-flag-flip PR description references this drill date.

---

## 8. What this runbook does NOT cover

- Production flag flip. That is a separate, explicitly approved PR.
- Legacy code path retirement (Batches 11d.4 → 11d.5). Each has its own gate.
- AWS infrastructure changes. See `aws-readiness-checklist.md`.
- Latency observation. The shadow read adds one bulk fetch per request; if staging latency dashboards show regression, that is its own decision and its own PR.

End of runbook.
