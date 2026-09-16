// Unit tests for the PURE Call Lists board helpers.
// Run: npx tsx tests/unit/callListBoard.test.ts

import assert from "node:assert/strict";
import {
  resultDisplay,
  isCalledOutcome,
  deriveColumnMetrics,
  isPackagePdfReady,
  pickLatestPackage,
  type PackageLike,
} from "../../shared/engagement/callListBoard";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ─── resultDisplay ───────────────────────────────────────────────────────────
check("resultDisplay: canonical outcomes → friendly labels", () => {
  assert.deepEqual(resultDisplay(null), { label: "Not Called", tone: "muted" });
  assert.deepEqual(resultDisplay(""), { label: "Not Called", tone: "muted" });
  assert.equal(resultDisplay("reached").label, "Reached");
  assert.equal(resultDisplay("scheduled").label, "Scheduled");
  assert.equal(resultDisplay("completed").label, "Scheduled");
  assert.equal(resultDisplay("voicemail").label, "LVM");
  assert.equal(resultDisplay("no_answer").label, "No Answer");
  assert.equal(resultDisplay("callback").label, "Callback");
  assert.equal(resultDisplay("refused_dnc").label, "Refused");
  assert.equal(resultDisplay("declined").label, "Refused");
  assert.equal(resultDisplay("REACHED").tone, "positive"); // case-insensitive
});
check("resultDisplay: unknown outcome → title-cased fallback", () => {
  assert.deepEqual(resultDisplay("busy_signal"), { label: "Busy Signal", tone: "neutral" });
});
check("isCalledOutcome: only non-empty counts", () => {
  assert.equal(isCalledOutcome(null), false);
  assert.equal(isCalledOutcome(""), false);
  assert.equal(isCalledOutcome("no_answer"), true);
});

// ─── deriveColumnMetrics ─────────────────────────────────────────────────────
check("deriveColumnMetrics: called/remaining/rollover/handoff", () => {
  const rows = [
    { lastCallOutcome: "reached", isCarryover: false, isHandoff: false },
    { lastCallOutcome: "voicemail", isCarryover: true, isHandoff: false },
    { lastCallOutcome: null, isCarryover: true, isHandoff: true },
    { lastCallOutcome: null, isCarryover: false, isHandoff: false },
  ];
  const m = deriveColumnMetrics(rows);
  assert.deepEqual(m, { total: 4, called: 2, remaining: 2, rollover: 2, handoff: 1 });
});
check("deriveColumnMetrics: historical completed counts as called", () => {
  const m = deriveColumnMetrics([
    { lastCallOutcome: null, completed: true },
    { lastCallOutcome: null, completed: false },
  ]);
  assert.equal(m.called, 1);
  assert.equal(m.remaining, 1);
});
check("deriveColumnMetrics: empty", () => {
  assert.deepEqual(deriveColumnMetrics([]), { total: 0, called: 0, remaining: 0, rollover: 0, handoff: 0 });
});

// ─── isPackagePdfReady ───────────────────────────────────────────────────────
check("isPackagePdfReady: only ready + available", () => {
  assert.equal(isPackagePdfReady({ generationStatus: "ready", pdfAvailable: true }), true);
  assert.equal(isPackagePdfReady({ generationStatus: "ready", pdfAvailable: false }), false);
  assert.equal(isPackagePdfReady({ generationStatus: "failed", pdfAvailable: true }), false);
  assert.equal(isPackagePdfReady({ generationStatus: "pending", pdfAvailable: false }), false);
  assert.equal(isPackagePdfReady(null), false);
});

// ─── pickLatestPackage ───────────────────────────────────────────────────────
function pkg(o: Partial<PackageLike> & { id: number; teamMemberId: number; serviceDate: string; createdAt: string }): PackageLike {
  return { generationStatus: "ready", pdfAvailable: true, ...o };
}
check("pickLatestPackage: latest by createdAt wins; count reflects all", () => {
  const packages = [
    pkg({ id: 1, teamMemberId: 7, serviceDate: "2026-09-16", createdAt: "2026-09-16T08:00:00Z" }),
    pkg({ id: 2, teamMemberId: 7, serviceDate: "2026-09-16", createdAt: "2026-09-16T10:00:00Z" }),
    pkg({ id: 3, teamMemberId: 9, serviceDate: "2026-09-16", createdAt: "2026-09-16T09:00:00Z" }),
    pkg({ id: 4, teamMemberId: 7, serviceDate: "2026-09-15", createdAt: "2026-09-15T09:00:00Z" }),
  ];
  const m = pickLatestPackage(packages, 7, "2026-09-16");
  assert.equal(m.latest?.id, 2);
  assert.equal(m.count, 2);
  assert.equal(m.pdfReady, true);
});
check("pickLatestPackage: no match → null/0/false", () => {
  const m = pickLatestPackage([], 7, "2026-09-16");
  assert.deepEqual({ id: m.latest, count: m.count, ready: m.pdfReady }, { id: null, count: 0, ready: false });
});
check("pickLatestPackage: latest not-ready → pdfReady false but still surfaced", () => {
  const packages = [
    pkg({ id: 1, teamMemberId: 7, serviceDate: "2026-09-16", createdAt: "2026-09-16T08:00:00Z" }),
    pkg({ id: 2, teamMemberId: 7, serviceDate: "2026-09-16", createdAt: "2026-09-16T10:00:00Z", generationStatus: "failed", pdfAvailable: false }),
  ];
  const m = pickLatestPackage(packages, 7, "2026-09-16");
  assert.equal(m.latest?.id, 2);
  assert.equal(m.count, 2);
  assert.equal(m.pdfReady, false);
});

console.log(`\ncallListBoard.test.ts — ${passed} assertions passed`);
