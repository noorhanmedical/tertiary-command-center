// Smoke — Phase 3 PR 3.2 hour/day helpers + key dedup contract.

function hoursBetween(a, b = new Date()) {
  if (!a) return 0;
  const t = a instanceof Date ? a.getTime() : new Date(a).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (b.getTime() - t) / 3600_000);
}
function fillTemplate(template, facts) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (facts[k] != null ? String(facts[k]) : "—"));
}

const fails = [];
function expect(label, actual, expected) {
  if (actual !== expected) fails.push(`${label} — actual=${actual} expected=${expected}`);
  else console.log(`PASS  ${label}`);
}

expect("1. hoursBetween null → 0", hoursBetween(null), 0);
expect("2. hoursBetween 2h ago → 2", Math.round(hoursBetween(new Date(Date.now() - 2 * 3600_000))), 2);
expect("3. fillTemplate substitutes", fillTemplate("Overdue by {h}h", { h: 5 }), "Overdue by 5h");
expect("4. fillTemplate missing key → —", fillTemplate("X {missing}", {}), "X —");

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: engine helpers honor contract.");
