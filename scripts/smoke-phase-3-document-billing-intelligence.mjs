#!/usr/bin/env node
// Smoke — Phase 3 PR 3.6.

import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const engine = read("server/services/exceptionIntelligence/exceptionSnapshotEngine.ts");
const expectedRegister = [
  /detectMissingDocument\(c,\s*"report",\s*"report_missing"\)/,
  /detectMissingDocument\(c,\s*"order_note",\s*"order_note_missing"\)/,
  /detectMissingDocument\(c,\s*"procedure_note",\s*"procedure_note_missing"\)/,
  /detectBillingReadinessBlocked\b/,
  /detectInvoiceBatchStale\b/,
  /detectInvoiceDraftStale\b/,
  /detectMissingInvoiceRecipient\b/,
  /detectHighBalanceAging\b/,
];
for (const r of expectedRegister) {
  if (!r.test(engine)) fail(`detector not registered in evaluateExceptions: ${r}`);
}

const rules = read("server/services/exceptionIntelligence/recommendationRules.ts");
if (!/missingDocumentRule\("report"\)/.test(rules)) fail("rules: report_missing wiring not found");
if (!/missingDocumentRule\("order_note"\)/.test(rules)) fail("rules: order_note_missing wiring not found");
if (!/missingDocumentRule\("procedure_note"\)/.test(rules)) fail("rules: procedure_note_missing wiring not found");

if (failures.length) {
  console.error("[smoke-phase-3-document-billing-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-document-billing-intelligence] PASS");
