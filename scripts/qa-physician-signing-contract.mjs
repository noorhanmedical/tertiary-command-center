// QA: physician signing contract (Batch F5).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/physician-signing-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Physician signing contract",
  "Documents that require signing",
  "`post_procedure_note`",
  "`report`",
  "`order_note`",
  "`informed_consent`",
  "Signing-state machine",
  "unsigned",
  "pending",
  "signed",
  "declined",
  "revoked",
  "Allowed transitions",
  "What signing MUST NOT do",
  "Mutate the PDF bytes",
  "Mutate qualification reasoning",
  "USE_ANCILLARY_SIGNING_SERVICE",
  "Default OFF",
  "Boundaries",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Physician signing contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Physician signing contract QA passed.");
