#!/usr/bin/env node
// Shadow-read parity-log analyzer (Bundle 16).
//
// Pure log parser. No DB. No app boot. No network.
//
// Reads plain-text log files captured from staging stdout/stderr,
// parses the three [USE_OPERATIONAL_QUEUE_CALL_LIST] log variants the
// route emits (pinned by scripts/qa-shadow-read-parity-log-schema.mjs),
// and emits a per-day summary + window verdict against the staging
// gate criteria in docs/architecture/operational-queue-call-list-projection-design.md §7.
//
// Contract spec: docs/architecture/shadow-read-parity-log-analyzer-design.md.
//
// Usage:
//   node scripts/parity-log-analyzer.mjs <file>...
//   node scripts/parity-log-analyzer.mjs --logs-dir <path>
//   node scripts/parity-log-analyzer.mjs --json <file>...
//
// PHI safety: see §5 of the design doc. The analyzer never echoes raw
// lines on the happy path. Any line whose payload contains keys
// outside the canonical five-field schema OR contains a prohibited
// identifier substring is reported as `<redacted>` and fails the
// window verdict.

import fs from "node:fs";
import path from "node:path";

const PREFIX = "[USE_OPERATIONAL_QUEUE_CALL_LIST]";
const SUCCESS_PREFIX = `${PREFIX} shadow-read {`;
const SUCCESS_KEYWORD = `${PREFIX} shadow-read `;
const SKIP_PREFIX = `${PREFIX} shadow-read skipped:`;
const ERROR_PREFIX = `${PREFIX} shadow-read failed:`;

const CANONICAL_FIELDS = [
  "inLegacyOnly",
  "inQueueOnly",
  "legacyCount",
  "parityMatch",
  "queueCount",
];

// Identifiers a line MUST NOT contain anywhere — pinned by §6.3 of
// the projection design doc.
const FORBIDDEN_IDENTIFIERS = [
  "patientName",
  "patientDob",
  "mrn",
  "insurance",
  "diagnosis",
  "summary:",
];

const DRIFT_THRESHOLD = 0.001;

function parseArgs(argv) {
  const args = argv.slice(2);
  const files = [];
  let logsDir = null;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--logs-dir") {
      logsDir = args[i + 1];
      i += 1;
    } else if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    } else {
      files.push(a);
    }
  }
  return { files, logsDir, json };
}

function listLogsInDir(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".log")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out.sort();
}

// Pull an ISO timestamp from the start of a line. Returns the UTC day
// (YYYY-MM-DD) or null if no timestamp is present.
function extractUtcDay(line) {
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z/,
  );
  return match ? match[1] : null;
}

// Convert a JS-inspector-style object literal substring into JSON and
// parse it. Returns { ok: true, value } or { ok: false, reason }.
function parseInspectObject(raw) {
  // Quote unquoted keys ({ key: ..., key: ... }).
  const quoted = raw.replace(/([{,]\s*)([A-Za-z_][\w]*)(\s*:)/g, '$1"$2"$3');
  try {
    return { ok: true, value: JSON.parse(quoted) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "parse error" };
  }
}

// Extract the `{...}` substring from a success line. Returns the
// substring or null if no balanced braces are found.
function extractObjectLiteral(line) {
  const start = line.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return line.slice(start, i + 1);
    }
  }
  return null;
}

function containsForbiddenIdentifier(line) {
  for (const needle of FORBIDDEN_IDENTIFIERS) {
    if (line.includes(needle)) return needle;
  }
  return null;
}

function classifyLine(line) {
  // PHI / forbidden-identifier guard runs FIRST so a leaked line
  // cannot reach a success/skip/error verdict.
  const forbidden = containsForbiddenIdentifier(line);
  if (forbidden !== null) {
    return {
      kind: "forbidden",
      reason: `line contains forbidden identifier (${forbidden}); redacted`,
    };
  }
  if (line.includes(ERROR_PREFIX)) return { kind: "error" };
  if (line.includes(SKIP_PREFIX)) return { kind: "skip" };
  if (line.includes(SUCCESS_PREFIX)) {
    const raw = extractObjectLiteral(line);
    if (raw === null) {
      return { kind: "parse_error", reason: "no { } payload" };
    }
    const parsed = parseInspectObject(raw);
    if (!parsed.ok) {
      return { kind: "parse_error", reason: parsed.reason };
    }
    const keys = Object.keys(parsed.value).sort();
    const wanted = [...CANONICAL_FIELDS].sort();
    if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
      return {
        kind: "schema_drift",
        reason: `payload keys [${keys.join(",")}] != canonical [${wanted.join(",")}]`,
      };
    }
    return { kind: "success", value: parsed.value };
  }
  if (line.includes(PREFIX)) {
    return {
      kind: "unknown_prefix_variant",
      reason: `unrecognized [USE_OPERATIONAL_QUEUE_CALL_LIST] log variant`,
    };
  }
  return { kind: "unrelated" };
}

function emptyDayBucket() {
  return {
    requests: 0,
    match: 0,
    legacyCountSum: 0,
    driftSum: 0,
    errors: 0,
    skips: 0,
  };
}

function dayVerdict(b) {
  if (b.errors > 0) return { verdict: "fail", reason: "errors>0" };
  if (b.requests === 0 && b.errors === 0) {
    return { verdict: "skip", reason: "no traffic" };
  }
  const drift = b.legacyCountSum > 0 ? b.driftSum / b.legacyCountSum : 0;
  const everyMatch = b.requests === b.match;
  if (everyMatch || drift < DRIFT_THRESHOLD) {
    return { verdict: "pass", reason: everyMatch ? "all-match" : `drift<${DRIFT_THRESHOLD}` };
  }
  return { verdict: "fail", reason: `drift>=${DRIFT_THRESHOLD}` };
}

function fmtDrift(b) {
  const drift = b.legacyCountSum > 0 ? b.driftSum / b.legacyCountSum : 0;
  return drift.toFixed(4);
}

function processFiles(filePaths) {
  const days = new Map(); // day -> bucket
  const tripwires = []; // contract violations that fail the window
  const errorLineDays = new Set();

  for (const fp of filePaths) {
    let content;
    try {
      content = fs.readFileSync(fp, "utf8");
    } catch (err) {
      tripwires.push(`read-failed: ${fp}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) continue;
      const day = extractUtcDay(line) ?? "unknown";
      if (!days.has(day)) days.set(day, emptyDayBucket());
      const bucket = days.get(day);

      const cls = classifyLine(line);
      if (cls.kind === "unrelated") continue;
      if (cls.kind === "forbidden") {
        tripwires.push(`day=${day}: ${cls.reason}`);
        bucket.errors += 1;
        errorLineDays.add(day);
        continue;
      }
      if (cls.kind === "parse_error") {
        tripwires.push(`day=${day}: parse_error (${cls.reason})`);
        bucket.errors += 1;
        errorLineDays.add(day);
        continue;
      }
      if (cls.kind === "schema_drift") {
        tripwires.push(`day=${day}: schema_drift (${cls.reason})`);
        bucket.errors += 1;
        errorLineDays.add(day);
        continue;
      }
      if (cls.kind === "unknown_prefix_variant") {
        tripwires.push(`day=${day}: ${cls.reason}`);
        bucket.errors += 1;
        errorLineDays.add(day);
        continue;
      }
      if (cls.kind === "skip") {
        bucket.skips += 1;
        continue;
      }
      if (cls.kind === "error") {
        bucket.errors += 1;
        continue;
      }
      // success
      const v = cls.value;
      bucket.requests += 1;
      bucket.legacyCountSum += v.legacyCount;
      bucket.driftSum += v.inLegacyOnly + v.inQueueOnly;
      if (v.parityMatch === true) bucket.match += 1;
    }
  }

  const dayRows = [];
  const sortedDays = [...days.keys()].sort();
  let passDays = 0;
  let failDays = 0;
  let skipDays = 0;
  let anyTraffic = false;
  for (const day of sortedDays) {
    const b = days.get(day);
    const verdict = dayVerdict(b);
    if (verdict.verdict === "pass") passDays += 1;
    else if (verdict.verdict === "fail") failDays += 1;
    else if (verdict.verdict === "skip") skipDays += 1;
    if (b.requests > 0 || b.errors > 0) anyTraffic = true;
    dayRows.push({
      day,
      requests: b.requests,
      match: b.match,
      drift: fmtDrift(b),
      errors: b.errors,
      skips: b.skips,
      verdict: verdict.verdict,
      reason: verdict.reason,
    });
  }

  let overall;
  if (tripwires.length > 0) overall = "fail";
  else if (failDays > 0) overall = "fail";
  else if (!anyTraffic) overall = "inconclusive";
  else if (passDays > 0 && failDays === 0) overall = "pass";
  else overall = "inconclusive";

  return {
    days: dayRows,
    summary: {
      windowDays: sortedDays.length,
      pass: passDays,
      fail: failDays,
      skip: skipDays,
      overall,
    },
    tripwires,
  };
}

function pad(s, width) {
  s = String(s);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function renderHuman(result) {
  const lines = [];
  for (const r of result.days) {
    const verdictLabel =
      r.verdict === "pass"
        ? "pass"
        : r.verdict === "skip"
          ? `skip (${r.reason})`
          : `fail (${r.reason})`;
    lines.push(
      `day=${r.day}  requests=${pad(r.requests, 5)}  match=${pad(r.match, 5)}  ` +
        `drift=${r.drift}  errors=${pad(r.errors, 3)}  skips=${pad(r.skips, 3)}  verdict=${verdictLabel}`,
    );
  }
  const s = result.summary;
  lines.push(
    `window=${s.windowDays}d  pass=${s.pass}  fail=${s.fail}  skip=${s.skip}  overall=${s.overall}`,
  );
  if (result.tripwires.length > 0) {
    lines.push(`tripwires=${result.tripwires.length}`);
    for (const t of result.tripwires) lines.push(`  - ${t}`);
  }
  return lines.join("\n");
}

function renderJson(result) {
  return JSON.stringify(result, null, 2);
}

function main() {
  const { files, logsDir, json } = parseArgs(process.argv);
  let inputs = files.slice();
  if (logsDir) {
    try {
      inputs = inputs.concat(listLogsInDir(logsDir));
    } catch (err) {
      console.error(`could not read --logs-dir ${logsDir}: ${err.message}`);
      process.exit(2);
    }
  }
  if (inputs.length === 0) {
    console.error(
      "usage: node scripts/parity-log-analyzer.mjs [--json] [--logs-dir <dir>] <file>...",
    );
    process.exit(2);
  }
  const result = processFiles(inputs);
  console.log(json ? renderJson(result) : renderHuman(result));
  // Exit code: 0 if overall pass, 1 if fail, 2 if inconclusive.
  // The QA wrapper exercises the analyzer with a known fail fixture
  // and verifies the exit code matches expectation.
  if (result.summary.overall === "pass") process.exit(0);
  if (result.summary.overall === "fail") process.exit(1);
  process.exit(2);
}

main();
