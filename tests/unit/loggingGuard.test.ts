// PHI-safe logging lint-guard (regression prevention).
//
// A full repo-wide sweep of ~758 legacy console/error sites is a large
// incremental effort. This guard prevents REGRESSIONS on the files that have
// already been hardened (the highest-risk PHI routes) — any newly-introduced
// client-facing raw `error.message` leak in these files fails CI. As more files
// are hardened, add them to GUARDED_FILES.
//
// Run: npx tsx tests/unit/loggingGuard.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${(e as Error).message}`);
  }
};

// Files already hardened — must stay free of client-facing raw error leaks.
const GUARDED_FILES = [
  "server/routes/patientDatabase.ts",
  "server/routes/plexusEhrAddPatient.ts",
  "server/routes/patients.ts",
  "server/routes/clinicalData.ts",
  "server/routes/admin.ts",
  "server/services/absenceWatcher.ts",
  "server/services/aiClient.ts",
  "server/middleware/errorHandler.ts",
  "server/middleware/tenantResourceGuards.ts",
  "server/routes/billingDocuments.ts",
  "server/routes/documentReadiness.ts",
  "server/routes/portalCaseReadiness.ts",
];

// Client-facing leak: returning a raw error message/stack in an HTTP response.
const CLIENT_LEAK =
  /res\.[a-zA-Z]*\(?\)?[.\s]*json\(\s*\{[^}]*error:\s*[^}]*\b(err|error|e)\.(message|stack)\b/;

for (const rel of GUARDED_FILES) {
  check(`no client-facing raw error leak in ${rel}`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    // strip comments to avoid false positives
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const m = code.match(CLIENT_LEAK);
    assert.equal(m, null, m ? `found client leak: ${m[0].slice(0, 80)}` : "");
  });
}

// The PHI-safe logger + safe error handler exist and are used.
check("phiSafeLogger + hardened errorHandler present", () => {
  assert.ok(readFileSync(join(ROOT, "server/lib/phiSafeLogger.ts"), "utf8").includes("errorPhiSafe"));
  const eh = readFileSync(join(ROOT, "server/middleware/errorHandler.ts"), "utf8");
  assert.ok(eh.includes("classifyLogSafeError") && eh.includes("request_id"), "safe error handler wired");
});

if (failures > 0) {
  console.error(`\nloggingGuard.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`\nloggingGuard.test.ts: all tests passed`);
