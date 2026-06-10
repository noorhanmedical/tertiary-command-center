# Shadow-read parity-log analyzer — design

**Status:** Docs-only (Bundle 15). No code added. No script added. No source code modified.
**Date:** 2026-06-09.
**Scope:** Define the tool that ingests the shadow-read log lines pinned by Bundle 14 and emits a daily pass/fail verdict against the §7 staging gate criteria.
**Related:**
- `operational-queue-call-list-projection-design.md` §6 (canonical log schema), §6.3 (PHI prohibition), §7 (staging gate).
- `scripts/qa-shadow-read-parity-log-schema.mjs` (Bundle 14 source-invariant check).
- PR #80 (route emits the shadow-read line), PR #94 (parity test), PR #96 (projection module).

This document does NOT add the analyzer to the repo. It pins the contract the analyzer will satisfy when it is added in a later PR. That PR may live under `scripts/` or `tools/` — both fit existing conventions — and is intentionally not designed in this bundle.

---

## 1. Purpose

The §7 staging gate in the projection design doc says:

> Observe `parityMatch` distribution for 7 consecutive days of staging traffic ... The window passes if `parityMatch=true` for every request OR `(inLegacyOnly + inQueueOnly) / legacyCount < 0.001` (0.1%) every day, with zero `[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read failed:` lines.

That criterion is only enforceable if a tool computes it from real log files. Doing it manually is fragile (operator counts events by eye) and impossible to attach to a PR description as evidence. The analyzer turns the criterion into a single command that any reviewer can re-run on the same log snapshot.

This bundle pins:

- The input format the analyzer accepts.
- The output format reviewers can paste into a future production-flag-flip PR description.
- The pass / fail / skip rules that map §7's English to a deterministic check.
- The PHI envelope the analyzer operates inside.
- The stop conditions a future analyzer PR must respect.

---

## 2. Input

### 2.1 Source

Plain-text log files captured from the staging app's stdout/stderr — exactly what the deploy platform already retains. The analyzer reads from:

- One or more files passed as positional args (`analyzer.mjs day1.log day2.log ...`), or
- A directory passed via `--logs-dir <path>` (recurses one level; matches `*.log`).

No DB connection. No app boot. No network. The analyzer is a pure stream parser — it can run on a laptop with a downloaded log file.

### 2.2 Recognised log lines

Three prefixes, all pinned by `qa-shadow-read-parity-log-schema.mjs` (Bundle 14):

1. **Success** — `[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read ` followed by the JSON-like object containing exactly the five canonical fields from §6.1 of the design doc:
   ```
   { parityMatch: <bool>, legacyCount: <num>, queueCount: <num>,
     inLegacyOnly: <num>, inQueueOnly: <num> }
   ```
2. **Skip** — `[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read skipped: no userId for scheduler`. No fields.
3. **Error** — `[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read failed: <err.message>`. No counts.

Any other line starting with `[USE_OPERATIONAL_QUEUE_CALL_LIST]` is unexpected — the analyzer MUST surface it as a contract violation and refuse to emit a pass verdict. This is the load-bearing tripwire: if a future PR adds a fourth log line without updating §6, the analyzer rejects the whole window.

### 2.3 Parsing rules

The analyzer MUST parse each success line by extracting the substring between the first `{` and the matching `}` and re-reading it as JSON-ish (the route uses `console.log(prefix, obj)` which serialises numbers and booleans verbatim). Any line where the substring fails to parse is counted as a parse failure and fails the window (different from a `shadow-read failed:` line — the route is healthy but the log format drifted).

The analyzer MUST NOT use a regex that matches on the canonical field names individually. Field-by-field regex would silently tolerate extra fields. The whole-object parse is the schema enforcer.

---

## 3. Output

### 3.1 Per-day summary

For each calendar day (UTC) detected in the input window, the analyzer emits one row:

```
day=2026-06-12  requests=14213  match=14209  drift=0.0003  errors=0  skips=8   verdict=pass
day=2026-06-13  requests=15022  match=15022  drift=0.0000  errors=0  skips=12  verdict=pass
day=2026-06-14  requests=  897  match=  893  drift=0.0045  errors=0  skips=2   verdict=fail (drift>0.001)
day=2026-06-15  requests=    0  match=    0  drift=0.0000  errors=0  skips=0   verdict=skip (no traffic)
```

- `requests` — count of success lines parsed.
- `match` — count of success lines with `parityMatch === true`.
- `drift` — `sum(inLegacyOnly + inQueueOnly) / sum(legacyCount)` across the day. Two-decimal-place precision is enough; the §7 threshold is 0.001.
- `errors` — count of `shadow-read failed:` lines.
- `skips` — count of `shadow-read skipped:` lines (not counted toward pass/fail; reported for context).
- `verdict` — one of `pass`, `fail (<reason>)`, `skip (no traffic)`.

### 3.2 Window verdict

After the per-day rows, one final line summarises the whole 7-day window:

```
window=7d  pass=5  fail=1  skip=1  overall=fail
```

`overall` is `pass` only if **every** non-skip day is `pass` AND at least one day in the window has non-zero traffic. A single `fail` day flips the window to `fail`. A window of only `skip` days is `inconclusive` — the analyzer must NOT emit `pass` on no traffic.

### 3.3 Machine-readable output

The analyzer MUST also support `--json` which emits the same content as a stable JSON object. The future production-flag-flip PR pastes either the human-readable form OR the JSON; the JSON is meant for archiving alongside the PR.

---

## 4. Pass / fail rules

A day is `pass` if BOTH:

- `errors === 0` (no `shadow-read failed:` lines), AND
- EITHER `requests === match` (every request matched) OR `drift < 0.001`.

A day is `fail` if `errors > 0` OR (`requests > 0` AND `drift >= 0.001` AND `requests !== match`).

A day is `skip` if `requests === 0 AND errors === 0`.

The window is `pass` only if every non-skip day is `pass` AND at least one day has non-zero traffic.

These rules are intentionally narrower than §7 of the design doc — Bundle 14's text said \"`parityMatch=true` for every request OR drift < 0.1%\" which left room for a day with 100% parityMatch but zero requests counting as a pass. The analyzer treats that as `skip` so a deploy outage doesn't get credited as parity evidence.

---

## 5. PHI envelope

The analyzer reads logs that should already be PHI-free per §6.3 of the design doc. But the analyzer must NOT rely on that — if a future regression accidentally logs PHI:

- The analyzer MUST surface any line whose object parses but contains keys OUTSIDE the five-field schema and refuse a pass verdict.
- The analyzer MUST NOT echo PHI-shaped strings to its output. Specifically: it MUST NOT print the raw matched line if the line contains any of the prohibited identifiers from §6.3 (`patientName`, `patientDob`, `mrn`, `insurance`, `diagnosis`, `summary:`, etc.) — instead it MUST emit a redacted marker (`<line contains forbidden identifier; redacted>`).
- The analyzer MUST NOT emit any individual log line content in its `--json` output. Only counts and verdicts.

This is the same posture Bundle 14 applied to the route's log emitter: the contract is enforced at every layer that touches the line.

---

## 6. What the analyzer does NOT promise

- It does NOT verify the projection module's algorithm. That's what `server/modules/operational-queue/__tests__/projection-parity.test.ts` does (Bundle 12, PR #94).
- It does NOT verify the route's log schema. That's what `scripts/qa-shadow-read-parity-log-schema.mjs` does (Bundle 14).
- It does NOT decide whether to flip the production flag. That decision lives in the production-flag-flip PR.
- It does NOT consume metrics or APM data. Logs only — the lowest common denominator the platform provides.
- It does NOT alert. A future cron-driven alerting PR may wrap the analyzer's `--json` output.

---

## 7. Stop conditions for the future analyzer PR

The PR that ships the analyzer MUST stop and ask if:

1. The analyzer would import the DB or any service-layer module. It is a pure log parser.
2. The analyzer would call out to the live staging environment. Logs must be downloaded first; the analyzer is offline.
3. The analyzer would echo a parsed line as part of its happy-path output. Counts and verdicts only.
4. The pass-rule windows would be widened (e.g., 5 days instead of 7) without an explicit risk write-up updating §7 of the projection design doc.
5. The analyzer would emit `pass` on an all-skip window. That violates §4 here.
6. The analyzer would tolerate an unrecognised `[USE_OPERATIONAL_QUEUE_CALL_LIST]` prefix. That defeats the load-bearing tripwire.

---

## 8. Verification checklist for the future analyzer PR

The analyzer PR is expected to satisfy:

- `npm run check` clean (TypeScript or JavaScript; either is acceptable for a script under `scripts/`).
- `npm run build` unaffected (no server import).
- A new `scripts/qa-shadow-read-parity-log-analyzer.mjs` that runs the analyzer against a canned PHI-free fixture log file shipped under `scripts/fixtures/` and asserts the verdict matches an expected reference.
- All existing `scripts/qa-*.mjs` continue to pass.
- No mutation of any route file, module, or schema.

---

## 9. Non-goals

- Designing a UI for the analyzer.
- Designing the production-flag-flip PR.
- Designing a generic log analyzer for other shadow reads. Each shadow read has its own schema; a separate design doc owns each.

End of design.
