// QA: outreach-only canonical outcome extension design (Batch F).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const DOC = "docs/architecture/call-result-outreach-only-outcome-extension.md";
requireFile(DOC);
requireText(DOC, [
  "Current outreach-only outcomes",
  "Path A",
  "Path B",
  "Side effects for each",
  "Terminal behavior",
  "appointmentStatus mapping",
  "Assignment completion behavior",
  "Journey Event expectation",
  "Ali decision required",
  "Recommendation",
  "`completed`",
  "`dnc`",
  "`do_not_contact`",
  "`deceased`",
  "`cancelled`",
  "`wants_more_info`",
  "`language_barrier`",
  "`mailbox_full`",
  "`hung_up`",
  "`disconnected`",
  "`busy`",
  "`reached`",
  "`refused_dnc`",
  "`moved`",
  "`not_interested`",
  "`will_think_about_it`",
  "Plexus IQ",
  "Hard-stops",
]);

// Pin: canonical fixture has NOT been extended yet.
{
  const FIX = "tests/fixtures/callResultCanonicalization.fixture.ts";
  const src = read(FIX) ?? "";
  for (const outreachOnlyOutcome of [
    "completed",
    "dnc",
    "do_not_contact",
    "deceased",
    "cancelled",
    "wants_more_info",
    "language_barrier",
    "mailbox_full",
  ]) {
    if (src.includes(`"${outreachOnlyOutcome}"`)) {
      failures.push(`${FIX}: outreach-only outcome "${outreachOnlyOutcome}" present — Batch F is design-only`);
    }
  }
}

if (failures.length > 0) {
  console.error("Outreach-only outcome extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach-only outcome extension QA passed.");
