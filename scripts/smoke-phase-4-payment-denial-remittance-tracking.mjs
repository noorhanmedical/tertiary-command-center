// Smoke — Phase 4 PR 4.6 totals recomputation fixtures.

function recompute({ charges, initialPaid, payments, adjustments, legacyStatus }) {
  let totalPaid = initialPaid;
  for (const p of payments) totalPaid += p;
  let totalAdjusted = 0;
  for (const a of adjustments) totalAdjusted += a;
  const totalBalance = Number((charges - totalPaid - totalAdjusted).toFixed(2));
  const status = (() => {
    if (totalBalance <= 0) return "Paid";
    if (totalPaid > 0 || totalAdjusted > 0) return "Partially Paid";
    return legacyStatus;
  })();
  return { totalPaid, totalAdjusted, totalBalance, status };
}

const fails = [];
function expect(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fails.push(`${label} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  else console.log(`PASS  ${label}`);
}

expect("1. full payment → Paid + zero balance",
  recompute({ charges: 100, initialPaid: 0, payments: [100], adjustments: [], legacyStatus: "Sent" }),
  { totalPaid: 100, totalAdjusted: 0, totalBalance: 0, status: "Paid" });

expect("2. partial payment → Partially Paid",
  recompute({ charges: 100, initialPaid: 0, payments: [40], adjustments: [], legacyStatus: "Sent" }),
  { totalPaid: 40, totalAdjusted: 0, totalBalance: 60, status: "Partially Paid" });

expect("3. write-off covers balance → Paid",
  recompute({ charges: 100, initialPaid: 0, payments: [], adjustments: [100], legacyStatus: "Sent" }),
  { totalPaid: 0, totalAdjusted: 100, totalBalance: 0, status: "Paid" });

expect("4. no payments AND no adjustments → legacy status preserved",
  recompute({ charges: 100, initialPaid: 0, payments: [], adjustments: [], legacyStatus: "Sent" }),
  { totalPaid: 0, totalAdjusted: 0, totalBalance: 100, status: "Sent" });

expect("5. initialPaid is included",
  recompute({ charges: 100, initialPaid: 25, payments: [25], adjustments: [], legacyStatus: "Sent" }),
  { totalPaid: 50, totalAdjusted: 0, totalBalance: 50, status: "Partially Paid" });

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: financial recompute fixtures honor the contract.");
