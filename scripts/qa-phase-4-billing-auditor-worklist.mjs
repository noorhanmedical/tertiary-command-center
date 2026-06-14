// QA — Phase 4 PR 4.7 billing auditor worklist.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "server/services/billing/billingAuditorWorklistService.ts",
  "server/routes/billingAuditor.ts",
  "client/src/lib/billingAuditorApi.ts",
  "client/src/pages/billing-auditor.tsx",
  "docs/architecture/phase-4-billing-auditor-worklist.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const service = fs.readFileSync(path.join(root, "server/services/billing/billingAuditorWorklistService.ts"), "utf8");
const REQUIRED_QUEUES = [
  "ready_to_invoice", "blocked_missing_report", "blocked_missing_order_note",
  "blocked_missing_procedure_note", "physician_signature_pending",
  "missing_price", "missing_recipient", "invoice_draft_needs_review",
  "invoice_approved_ready_to_send", "invoice_delivery_failed",
  "payment_overdue", "denial_open", "reminder_due",
];
for (const q of REQUIRED_QUEUES) {
  if (!service.includes(`"${q}"`)) failures.push(`WORKLIST_QUEUE_IDS must include "${q}"`);
}
if (!service.includes("export async function getWorklistSummary")) failures.push("service must export getWorklistSummary");
if (!service.includes("export async function getWorklistItems")) failures.push("service must export getWorklistItems");

// Service must not write.
if (/db\.insert|db\.update|db\.delete/.test(service)) {
  failures.push("worklist service must be read-only (no db.insert/update/delete)");
}

const route = fs.readFileSync(path.join(root, "server/routes/billingAuditor.ts"), "utf8");
if (!route.includes('app.get("/api/billing-auditor/summary"')) failures.push("route must register summary endpoint");
if (!route.includes('app.get("/api/billing-auditor/worklist"')) failures.push("route must register worklist endpoint");
if (!route.includes("requireAdminOrBiller")) failures.push("worklist routes must be admin/biller-gated");

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/billing/auditor")) failures.push("App.tsx must register /billing/auditor");

if (failures.length > 0) {
  console.error("Phase-4 billing-auditor-worklist QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 billing-auditor-worklist QA passed.");
