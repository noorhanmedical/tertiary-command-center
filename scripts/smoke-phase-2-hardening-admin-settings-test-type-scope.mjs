// Smoke — Phase 2 hardening item 5: admin_settings test-type scope.
//
// Mirrors the precedence helper in JS so we can verify the
// most-specific-wins order without a DB.
//
// Run: node scripts/smoke-phase-2-hardening-admin-settings-test-type-scope.mjs

// Tuple: (facility, user, testType, value) — represents the rows
// the DB might have. The mock matches the new precedence:
//   1. (facility, user, testType)
//   2. (facility, null, testType)
//   3. (null, user, testType)
//   4. (null, null, testType)
//   5. (facility, user, null)
//   6. (facility, null, null)
//   7. (null, user, null)
//   8. (null, null, null)

function resolve(rows, scope) {
  const f = scope.facilityId ?? null;
  const u = scope.userId ?? null;
  const t = scope.testType ?? null;
  const order = [];
  if (t !== null) {
    order.push([f, u, t]);
    order.push([f, null, t]);
    order.push([null, u, t]);
    order.push([null, null, t]);
  }
  order.push([f, u, null]);
  order.push([f, null, null]);
  order.push([null, u, null]);
  order.push([null, null, null]);
  for (const [fx, ux, tx] of order) {
    const hit = rows.find((r) => r[0] === fx && r[1] === ux && r[2] === tx);
    if (hit) return hit[3];
  }
  return null;
}

const fails = [];
function expect(label, actual, expected) {
  if (actual !== expected) fails.push(`${label} — actual=${actual} expected=${expected}`);
  else console.log(`PASS  ${label}`);
}

// Mock rows that mimic admin_settings entries.
const rows = [
  ["SHV", "u1", "brainwave", "v-shv-u1-brainwave"],
  ["SHV", null, "brainwave", "v-shv-brainwave"],
  [null, "u1", "brainwave", "v-u1-brainwave"],
  [null, null, "brainwave", "v-global-brainwave"],
  ["SHV", "u1", null, "v-shv-u1"],
  ["SHV", null, null, "v-shv"],
  [null, "u1", null, "v-u1"],
  [null, null, null, "v-global"],
];

expect(
  "1. (facility, user, testType) wins",
  resolve(rows, { facilityId: "SHV", userId: "u1", testType: "brainwave" }),
  "v-shv-u1-brainwave",
);

expect(
  "2. test scope: (facility, null, test) when no (facility,user,test) row",
  resolve(rows.filter((r) => !(r[0] === "SHV" && r[1] === "u1" && r[2] === "brainwave")),
    { facilityId: "SHV", userId: "u1", testType: "brainwave" }),
  "v-shv-brainwave",
);

expect(
  "3. test scope: (null, user, test) when no facility-test row",
  resolve(rows.filter((r) => r[2] === "brainwave" && r[0] === null && r[1] === "u1"),
    { facilityId: "SHV", userId: "u1", testType: "brainwave" }),
  "v-u1-brainwave",
);

expect(
  "4. test scope: global-test row last",
  resolve([rows.find((r) => r[0] === null && r[1] === null && r[2] === "brainwave")],
    { facilityId: "SHV", userId: "u1", testType: "brainwave" }),
  "v-global-brainwave",
);

expect(
  "5. test scope misses → falls back to non-test (facility,user)",
  resolve(rows.filter((r) => r[2] === null),
    { facilityId: "SHV", userId: "u1", testType: "brainwave" }),
  "v-shv-u1",
);

expect(
  "6. no testType in scope → behaves exactly like PR 2.1",
  resolve(rows, { facilityId: "SHV", userId: "u1" }),
  "v-shv-u1",
);

expect(
  "7. testType missing rows entirely → falls all the way to global",
  resolve(rows.filter((r) => r[2] === null && r[0] === null && r[1] === null),
    { facilityId: "SHV", userId: "u1", testType: "doppler" }),
  "v-global",
);

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: admin_settings test-type precedence honors the contract.");
