// QA: Team Portal canonical call-result write switch plan (Batch E8).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/team-portal-canonical-call-result-write-switch-plan.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "canonical call-result write switch plan",
  "Today (post-E4)",
  "E9 target",
  "Switch-flip plan",
  "VITE_USE_LEGACY_DISPOSITION_WRITE",
  "engagementCallResultEndpoint",
  "Invariants the switch MUST preserve",
  "legacy outcome grid renders unchanged",
  "Rollback criteria",
  "Out of scope for E9",
  "Plexus IQ",
  "Admin Review",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// E8 is docs+QA only — the new kill-switch flag must NOT exist in code yet.
{
  const ROOTS = ["server", "client", "shared"];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("VITE_USE_LEGACY_DISPOSITION_WRITE")) {
        failures.push(`E8 is docs+QA only: ${rel} already references VITE_USE_LEGACY_DISPOSITION_WRITE`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

// The endpoint helper that E9 will pin against still exists.
{
  const helper = read("client/src/lib/engagementCanonicalCallResultsUiFlag.ts");
  if (helper === null) failures.push("Missing engagementCanonicalCallResultsUiFlag.ts helper");
  else if (!helper.includes("engagementCallResultEndpoint")) failures.push("engagementCallResultEndpoint export missing");
}

// DispositionSheet still posts to legacy endpoint today — E8 must not
// have prematurely flipped the write path.
{
  const dispo = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  if (!dispo.includes('"/api/outreach/calls"')) {
    failures.push("DispositionSheet should still POST /api/outreach/calls today — E8 is docs-only");
  }
}

if (failures.length > 0) {
  console.error("Team Portal canonical call-result write switch plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal canonical call-result write switch plan QA passed.");
