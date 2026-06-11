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

// Authorized importers of the rollback flag.
// Batch E9 wires the flag into DispositionSheet; no other source file
// may reference it. Update this allowlist alongside each new
// authorized batch.
{
  const ALLOWED = new Set([
    "client/src/components/outreach/DispositionSheet.tsx",
  ]);
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
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("VITE_USE_LEGACY_DISPOSITION_WRITE")) {
        failures.push(`Unauthorized reference: ${rel} references VITE_USE_LEGACY_DISPOSITION_WRITE`);
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

// DispositionSheet still references the legacy endpoint string (kept
// behind the rollback flag in E9 and beyond). If the string vanishes
// from the file, either the rollback path was removed prematurely or
// the file was restructured — flag it.
{
  const dispo = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  if (!dispo.includes('"/api/outreach/calls"')) {
    failures.push("DispositionSheet must still reference /api/outreach/calls (rollback path)");
  }
}

if (failures.length > 0) {
  console.error("Team Portal canonical call-result write switch plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal canonical call-result write switch plan QA passed.");
