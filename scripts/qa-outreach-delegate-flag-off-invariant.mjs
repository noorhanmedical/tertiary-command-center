// QA: outreach delegate flag-OFF invariant (Batch B8).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }

// §1 — Flag accessor defaults OFF.
{
  const FLAG = "server/services/callResult/recordCallResultOutreachDelegateFlag.ts";
  requireFile(FLAG);
  const src = read(FLAG) ?? "";
  for (const n of ["USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE", 'v === "1"', 'v === "true"', 'v === "yes"']) {
    if (!src.includes(n)) failures.push(`${FLAG}: missing "${n}"`);
  }
  if (/return true/.test(src)) failures.push(`${FLAG}: must not return true unconditionally`);
}

// §2 — Route has the legacy branch intact + guarded delegation.
{
  const ROUTE = "server/routes/outreach.ts";
  requireFile(ROUTE);
  const src = read(ROUTE) ?? "";
  for (const n of [
    "Legacy code path",
    "call = await storage.createOutreachCallAtomic",
    "res.status(201).json(call)",
  ]) {
    if (!src.includes(n)) failures.push(`${ROUTE}: legacy code path needle "${n}" missing`);
  }
  if (!/if\s*\(\s*isRecordCallResultOutreachDelegateEnabled\(\)\s*&&/.test(src)) {
    failures.push(`${ROUTE}: delegation branch must be guarded by isRecordCallResultOutreachDelegateEnabled()`);
  }
}

// §3 — No client/src branches on the env var or accessor.
{
  const ROOTS = [path.join(root, "client/src")];
  function walk(dir, results) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, results); continue; }
      if (!/\.(ts|tsx|mts|cts|js|jsx)$/.test(e.name)) continue;
      results.push(abs);
    }
  }
  const files = [];
  for (const r of ROOTS) walk(r, files);
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE") || src.includes("isRecordCallResultOutreachDelegateEnabled")) {
      failures.push(`${path.relative(root, abs)} references the outreach delegate flag — UI must not branch on it`);
    }
  }
}

// §4 — No Plexus IQ / Admin Review file branches on the accessor.
{
  for (const dir of ["server/services/plexusIq", "server/routes/admin.ts"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      function walk(d) {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const a = path.join(d, e.name);
          if (e.isDirectory()) { walk(a); continue; }
          if (!/\.(ts|mts|cts)$/.test(e.name)) continue;
          const rel = path.relative(root, a);
          const src = fs.readFileSync(a, "utf8");
          if (src.includes("isRecordCallResultOutreachDelegateEnabled")) {
            failures.push(`${rel} references the outreach delegate accessor — Plexus IQ / Admin Review must remain neutral`);
          }
        }
      }
      walk(abs);
    } else {
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("isRecordCallResultOutreachDelegateEnabled")) {
        failures.push(`${dir} references the outreach delegate accessor — Admin Review must remain neutral`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Outreach delegate flag-OFF invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegate flag-OFF invariant QA passed.");
