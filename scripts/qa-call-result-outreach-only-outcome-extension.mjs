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

// Batch F of adapter blockers run was design-only. Batch B2 of Phase 1
// has since implemented the 5 unambiguous terminal outreach-only
// outcomes (completed, dnc, do_not_contact, deceased, cancelled).
// The ambiguous callback-style ones (wants_more_info / language_barrier
// / mailbox_full) remain absent — Path B fallback per the doc.
{
  const FIX = "tests/fixtures/callResultCanonicalization.fixture.ts";
  const src = read(FIX) ?? "";
  // Implemented outcomes MUST now be present.
  for (const implemented of ["completed", "dnc", "do_not_contact", "deceased", "cancelled"]) {
    if (!src.includes(`"${implemented}"`)) {
      failures.push(`${FIX}: terminal outreach outcome "${implemented}" missing — Batch B2 implementation required`);
    }
  }
  // Ambiguous outcomes MUST remain absent (still Path B until Ali OKs).
  for (const ambiguous of ["wants_more_info", "language_barrier", "mailbox_full"]) {
    if (src.includes(`"${ambiguous}"`)) {
      failures.push(`${FIX}: ambiguous outcome "${ambiguous}" must remain Path B fallback (Ali not yet approved)`);
    }
  }
}

if (failures.length > 0) {
  console.error("Outreach-only outcome extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach-only outcome extension QA passed.");
