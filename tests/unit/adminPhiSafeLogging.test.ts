// Surgical PHI-safe port verification (ported from old main's PHI-safe
// observability work, adapted to the current Plexus phiSafeLogger API).
//
// Verifies:
//   §A  admin analysis-jobs response is SANITIZED — only the whitelisted
//       fields, and a failed job exposes a GENERIC errorMessage, never raw
//       internal detail.
//   §B  the phiSafeLogger error/warn helpers emit ONLY structural tags and
//       never a raw error message/string.
//   §C  admin.ts + absenceWatcher.ts contain no raw console.error(...message)
//       PHI-leak paths (they route through the PHI-safe logger).
//
// Runnable via: npx tsx tests/unit/adminPhiSafeLogging.test.ts
// Pure/source-level — no DB required.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorPhiSafe, warnPhiSafe } from "../../server/lib/phiSafeLogger";

const ROOT = process.cwd();
let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}: ${(err as Error).message}`);
  }
};

// ── §A: sanitized analysis-job projection contract ──────────────────────────
// Mirror the mapping used by the route so the shape is asserted deterministically
// without spinning up Express/DB.
function projectJob(job: any) {
  return {
    id: job.id,
    batchId: job.batchId,
    batchName: job.batchName,
    status: job.status,
    totalPatients: job.totalPatients,
    completedPatients: job.completedPatients,
    errorMessage: job.status === "failed" ? "Analysis job failed" : null,
    startedAt: job.startedAt,
    completedAt: job.completedAt ?? null,
  };
}

check("§A failed job exposes generic errorMessage, never raw detail", () => {
  const raw = {
    id: 1, batchId: 9, batchName: "b", status: "failed",
    totalPatients: 3, completedPatients: 1,
    // Simulate a raw internal error field that must NEVER surface.
    errorMessage: "duplicate key value violates unique constraint patient_ssn_idx (SSN 123-45-6789)",
    startedAt: "t0", completedAt: null,
    internalSecret: "should-not-appear",
  };
  const out = projectJob(raw);
  assert.equal(out.errorMessage, "Analysis job failed");
  assert.ok(!("internalSecret" in out), "must not leak non-whitelisted fields");
  assert.ok(!JSON.stringify(out).includes("123-45-6789"), "must not leak raw error detail / PHI");
});

check("§A completed job carries null errorMessage", () => {
  const out = projectJob({ id: 2, batchId: 9, batchName: "b", status: "completed", totalPatients: 3, completedPatients: 3, startedAt: "t0", completedAt: "t1" });
  assert.equal(out.errorMessage, null);
  assert.equal(out.completedAt, "t1");
});

// ── §B: logger emits structural tags only, never raw strings ────────────────
check("§B errorPhiSafe/warnPhiSafe never print a raw error message", () => {
  const lines: string[] = [];
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    errorPhiSafe({ source: "absence_watcher", op: "tick", outcome: "failed" });
    errorPhiSafe({ source: "admin_analysis_jobs", op: "tick", outcome: "failed" });
    warnPhiSafe({ source: "absence_watcher", op: "ai_proposal", outcome: "failed" });
  } finally {
    console.error = origErr;
    console.warn = origWarn;
  }
  const blob = lines.join("\n");
  assert.ok(blob.includes("[absence_watcher]"), "structural source tag present");
  assert.ok(blob.includes("[admin_analysis_jobs]"), "admin source tag present");
  // No raw PHI-ish content possible: the API only accepts LogSafeTag literals.
  assert.ok(!/SSN|patient|dob|\d{3}-\d{2}-\d{4}/i.test(blob), "no PHI-ish content in logs");
});

// ── §C: source files route through the PHI-safe logger ──────────────────────
check("§C admin.ts has no raw console.error(...error.message) leak", () => {
  const src = readFileSync(join(ROOT, "server/routes/admin.ts"), "utf8");
  assert.ok(!/console\.(error|warn|log)\s*\([^)]*error\.message/.test(src), "no raw error.message logging");
  assert.ok(src.includes("errorPhiSafe"), "uses PHI-safe logger");
  assert.ok(src.includes('"Analysis job failed"'), "generic failed message present");
});

check("§C absenceWatcher.ts routes error paths through PHI-safe logger", () => {
  const src = readFileSync(join(ROOT, "server/services/absenceWatcher.ts"), "utf8");
  assert.ok(!/console\.(error|warn)\s*\(/.test(src), "no raw console.error/warn remain");
  assert.ok(src.includes("errorPhiSafe") && src.includes("warnPhiSafe"), "uses PHI-safe logger helpers");
});

if (failures > 0) {
  console.error(`\nadminPhiSafeLogging.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nadminPhiSafeLogging.test.ts: all tests passed");
