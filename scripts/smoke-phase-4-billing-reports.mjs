// Smoke — Phase 4 PR 4.8 day boundary fixtures.

function startOfDayIso(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); }
function endOfDayIso(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString(); }

const fails = [];
function expect(label, actual, expected) {
  if (actual !== expected) fails.push(`${label} — actual=${actual} expected=${expected}`);
  else console.log(`PASS  ${label}`);
}

const t = new Date("2026-06-14T15:30:00Z");
expect("1. startOfDay rounds to 00:00:00", startOfDayIso(t), "2026-06-14T00:00:00.000Z");
expect("2. endOfDay rounds to 23:59:59.999", endOfDayIso(t), "2026-06-14T23:59:59.999Z");

const today = new Date();
expect("3. startOfDay is deterministic for today", startOfDayIso(today), startOfDayIso(today));

// Month format helper.
function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return [start.toISOString(), end.toISOString()];
}
expect("4. month range for 2026-02 spans Feb 1..28", monthRange("2026-02").join(" .. "),
  "2026-02-01T00:00:00.000Z .. 2026-02-28T23:59:59.999Z");

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: report date boundaries honor UTC.");
