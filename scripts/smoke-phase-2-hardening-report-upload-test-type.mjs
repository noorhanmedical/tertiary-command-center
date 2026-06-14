// Smoke — Phase 2 hardening item 3: resolveActiveTestType fixtures.
//
// Run: node scripts/smoke-phase-2-hardening-report-upload-test-type.mjs

function resolveActiveTestType(data) {
  const dr = data.documentReadiness ?? [];
  const fromReadiness = dr.find((r) => (r.serviceType ?? "").trim().length > 0);
  if (fromReadiness?.serviceType) return fromReadiness.serviceType;
  const qt = data.clinicalProfile?.qualifyingTests ?? [];
  if (qt.length > 0 && qt[0].trim().length > 0) return qt[0];
  return null;
}

const fails = [];
function expect(label, actual, expected) {
  if (actual !== expected) fails.push(`${label} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  else console.log(`PASS  ${label}`);
}

expect(
  "1. documentReadiness wins over qualifyingTests",
  resolveActiveTestType({
    documentReadiness: [{ serviceType: "brainwave" }],
    clinicalProfile: { qualifyingTests: ["echo"] },
  }),
  "brainwave",
);

expect(
  "2. empty documentReadiness → falls to qualifyingTests",
  resolveActiveTestType({
    documentReadiness: [],
    clinicalProfile: { qualifyingTests: ["doppler"] },
  }),
  "doppler",
);

expect(
  "3. all empty → null (honest pending)",
  resolveActiveTestType({ documentReadiness: [], clinicalProfile: { qualifyingTests: [] } }),
  null,
);

expect(
  "4. blank serviceType skipped",
  resolveActiveTestType({
    documentReadiness: [{ serviceType: "" }, { serviceType: "carotid" }],
    clinicalProfile: {},
  }),
  "carotid",
);

expect(
  "5. undefined fields → null",
  resolveActiveTestType({}),
  null,
);

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: resolveActiveTestType honors the resolution order.");
