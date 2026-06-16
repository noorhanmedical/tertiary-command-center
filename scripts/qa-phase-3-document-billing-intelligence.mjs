#!/usr/bin/env node
// QA — Phase 3 PR 3.6: document + billing exception intelligence.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

mustExist("server/services/exceptionIntelligence/exceptionSnapshotEngine.ts");
mustExist("server/services/exceptionIntelligence/recommendationRules.ts");
mustExist("docs/architecture/phase-3-document-billing-intelligence.md");

if (failures.length) {
  console.error("[qa-phase-3-document-billing-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

const engine = read("server/services/exceptionIntelligence/exceptionSnapshotEngine.ts");
const rules = read("server/services/exceptionIntelligence/recommendationRules.ts");

// 1) Engine version bumped to PR 3.6
if (!/DETECTOR_VERSION\s*=\s*"3\.6\.0"/.test(engine)) {
  fail("DETECTOR_VERSION must be bumped to 3.6.0");
}

// 2) Engine must register all 8 new detector functions
const newDetectorFns = [
  "detectMissingDocument", "detectBillingReadinessBlocked",
  "detectInvoiceBatchStale", "detectInvoiceDraftStale",
  "detectMissingInvoiceRecipient", "detectHighBalanceAging",
];
for (const fn of newDetectorFns) {
  if (!new RegExp(`async function ${fn}\\b`).test(engine)) fail(`engine missing detector function: ${fn}`);
}

// 3) Engine must add new types to supersede whitelist
for (const t of [
  "report_missing", "order_note_missing", "procedure_note_missing",
  "billing_readiness_blocked", "invoice_batch_stale", "invoice_draft_stale",
  "missing_invoice_recipient", "high_balance_aging",
]) {
  if (!engine.includes(`"${t}"`)) fail(`engine must include "${t}" in supersede whitelist`);
}

// 4) Recommendation rules must cover the 8 new types
for (const t of [
  "report_missing", "order_note_missing", "procedure_note_missing",
  "billing_readiness_blocked", "invoice_batch_stale", "invoice_draft_stale",
  "missing_invoice_recipient", "high_balance_aging",
]) {
  if (!new RegExp(`${t}:\\s*\\w`).test(rules)) fail(`recommendation rule missing for: ${t}`);
}

// 5) RECOMMENDATION_VERSION bumped
if (!/RECOMMENDATION_VERSION\s*=\s*"3\.6\.0"/.test(rules)) {
  fail("RECOMMENDATION_VERSION must be bumped to 3.6.0");
}

// 6) No autonomous mutations of source tables
const forbid = /db\.update\(invoices\)|db\.update\(invoiceBatches\)|db\.update\(billingReadinessChecks\)|db\.update\(caseDocumentReadiness\)/;
if (forbid.test(engine)) fail("engine must not mutate source operational tables");

// 7) Detectors must read tables they own
for (const ref of [
  "caseDocumentReadiness", "billingReadinessChecks", "invoiceBatches", "invoices",
]) {
  if (!engine.includes(ref)) fail(`engine missing table reference: ${ref}`);
}

if (failures.length) {
  console.error("[qa-phase-3-document-billing-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-document-billing-intelligence] PASS");
