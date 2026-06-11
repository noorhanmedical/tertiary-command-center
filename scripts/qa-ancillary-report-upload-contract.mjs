// QA: ancillary report upload contract (Batch F3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/ancillary-report-upload-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Ancillary report upload contract",
  "Storage target",
  "document_blobs",
  "documents.surface=ancillary",
  "kind=report",
  "content-addressed via `sha256`",
  "Allowed MIME types",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "415 Unsupported Media Type",
  "Size limits",
  "25 MiB",
  "POST /api/ancillary/reports",
  "USE_ANCILLARY_REPORT_UPLOAD",
  "What ingress MUST NOT do",
  "Sign the report",
  "Admin Review territory",
  "PDF behavior is protected",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Schema layer the contract pins is still present.
{
  const docs = read("shared/schema/documents.ts") ?? "";
  if (!docs.includes('pgTable("document_blobs"')) failures.push("shared/schema/documents.ts missing document_blobs table");
  if (!docs.includes('pgTable("documents"')) failures.push("shared/schema/documents.ts missing documents table");
}

// F3 is docs+QA only — no route file may yet wire POST /api/ancillary/reports.
{
  const ROUTES = path.join(root, "server/routes");
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes('"/api/ancillary/reports"')) {
        failures.push(`F3 is docs+QA only: ${rel} already wires POST /api/ancillary/reports`);
      }
    }
  }
  walk(ROUTES);
}

if (failures.length > 0) {
  console.error("Ancillary report upload contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Ancillary report upload contract QA passed.");
