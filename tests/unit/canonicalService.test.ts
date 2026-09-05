// Canonical service identity / alias normalization guards.
//
//   npx tsx tests/unit/canonicalService.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCanonicalServiceType,
  isCanonicalServiceType,
  CANONICAL_SERVICE_TYPES,
} from "../../shared/canonicalService";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

// ── The drift that caused a duplicate case ──
test("Lower Extremity Venous Doppler resolves to the canonical Duplex identity", () => {
  assert.equal(resolveCanonicalServiceType("Lower Extremity Venous Doppler"), "Lower Extremity Venous Duplex");
  assert.equal(resolveCanonicalServiceType("Lower Extremity Venous Duplex"), "Lower Extremity Venous Duplex");
  assert.equal(resolveCanonicalServiceType("LE Venous Doppler"), "Lower Extremity Venous Duplex");
  assert.equal(resolveCanonicalServiceType("LE Venous Duplex"), "Lower Extremity Venous Duplex");
});

test("all four LE venous aliases collapse to ONE canonical identity", () => {
  const variants = [
    "Lower Extremity Venous Doppler",
    "Lower Extremity Venous Duplex",
    "LE Venous Doppler",
    "LE Venous Duplex",
  ];
  const resolved = new Set(variants.map(resolveCanonicalServiceType));
  assert.equal(resolved.size, 1, `expected 1 canonical identity, got ${[...resolved].join(", ")}`);
});

// ── Other services normalize too ──
test("registry display_name variants resolve to internal_code", () => {
  assert.equal(resolveCanonicalServiceType("Complete Transthoracic Echocardiogram"), "Echocardiogram TTE");
  assert.equal(resolveCanonicalServiceType("Renal Artery Duplex — Complete"), "Renal Artery Doppler");
  assert.equal(resolveCanonicalServiceType("Lower Extremity Arterial Duplex — Complete Bilateral"), "Lower Extremity Arterial Doppler");
});

test("case / whitespace / dash variants normalize", () => {
  assert.equal(resolveCanonicalServiceType("  brainwave  "), "BrainWave");
  assert.equal(resolveCanonicalServiceType("VITAL WAVE"), "VitalWave");
  assert.equal(resolveCanonicalServiceType("carotid duplex"), "Bilateral Carotid Duplex");
  assert.equal(resolveCanonicalServiceType("renal artery duplex - complete"), "Renal Artery Doppler");
});

test("canonical identities resolve to themselves (idempotent)", () => {
  for (const s of CANONICAL_SERVICE_TYPES) {
    assert.equal(resolveCanonicalServiceType(s), s, `${s} must be idempotent`);
    assert.equal(resolveCanonicalServiceType(resolveCanonicalServiceType(s)), s, `${s} double-resolve idempotent`);
  }
});

// ── No fuzzy matching / no silent drop ──
test("unknown service passes through trimmed, not silently mapped", () => {
  assert.equal(resolveCanonicalServiceType("Totally Unknown Study"), "Totally Unknown Study");
  assert.equal(resolveCanonicalServiceType("  Weird  Service  "), "Weird Service");
  assert.equal(isCanonicalServiceType("Totally Unknown Study"), false);
});

test("empty / null returns empty (never throws)", () => {
  assert.equal(resolveCanonicalServiceType(""), "");
  assert.equal(resolveCanonicalServiceType(null), "");
  assert.equal(resolveCanonicalServiceType(undefined), "");
});

test("isCanonicalServiceType true for known aliases and canonical keys", () => {
  assert.equal(isCanonicalServiceType("LE Venous Doppler"), true);
  assert.equal(isCanonicalServiceType("Bilateral Carotid Duplex"), true);
  assert.equal(isCanonicalServiceType("Echocardiogram TTE"), true);
});

// ── Lockstep with the registry migration (0058 internal_code set) ──
test("canonical keys match ancillary_service_registry internal_code (migration 0058)", () => {
  const sql = readFileSync(join(process.cwd(), "migrations/0058_add_ancillary_service_registry.sql"), "utf8");
  for (const code of CANONICAL_SERVICE_TYPES) {
    assert.ok(sql.includes(`('${code}',`), `internal_code '${code}' must exist in registry seed 0058`);
  }
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Canonical service identity QA passed.");
