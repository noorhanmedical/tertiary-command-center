// QA: ancillary order/note tracking contract (Batch F4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/ancillary-order-note-tracking-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "order / note tracking contract",
  "Document kinds in scope",
  "`order_note`",
  "`post_procedure_note`",
  "documents.surface=ancillary",
  "State pieces tracked per kind",
  "`documents.createdAt`",
  "Read-model surface (F2)",
  "REQUIRED_KINDS",
  "Boundaries",
  "Tracking does NOT decide billing readiness",
  "Signing is F5/F6",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// F2 read-model still pins all three required kinds.
{
  const svc = read("server/services/ancillary/ancillaryReadModel.ts") ?? "";
  for (const k of ["report", "order_note", "post_procedure_note"]) {
    if (!svc.includes(`"${k}"`)) failures.push(`F2 scaffold missing required kind "${k}"`);
  }
  if (!svc.includes("REQUIRED_KINDS")) failures.push("F2 scaffold missing REQUIRED_KINDS export");
}

if (failures.length > 0) {
  console.error("Ancillary order/note tracking contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Ancillary order/note tracking contract QA passed.");
