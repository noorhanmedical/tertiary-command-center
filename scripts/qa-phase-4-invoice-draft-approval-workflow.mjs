// QA — Phase 4 PR 4.4 invoice draft + approval workflow.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "migrations/0036_phase4_invoice_approval_workflow.sql",
  "server/services/billing/invoiceDraftService.ts",
  "server/services/billing/invoiceApprovalService.ts",
  "server/routes/invoiceApproval.ts",
  "client/src/lib/invoiceApprovalApi.ts",
  "client/src/pages/invoice-review.tsx",
  "docs/architecture/phase-4-invoice-draft-approval-workflow.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/invoices.ts"), "utf8");
const REQUIRED_COLS = [
  "approvalStatus", "approvedByUserId", "approvedAt", "voidedAt", "voidReason",
  "policySnapshot", "recipientSnapshot", "deliveryStatus", "dueDate", "paymentTerms",
  "invoiceBatchId",
];
for (const c of REQUIRED_COLS) {
  if (!schema.includes(c)) failures.push(`invoices schema must declare column ${c}`);
}
// Legacy status unchanged.
if (!schema.includes("INVOICE_STATUSES")) failures.push("legacy INVOICE_STATUSES must remain");
if (!schema.includes("INVOICE_APPROVAL_STATUSES")) failures.push("INVOICE_APPROVAL_STATUSES must exist");
if (!schema.includes("INVOICE_DELIVERY_STATUSES")) failures.push("INVOICE_DELIVERY_STATUSES must exist");

const approval = fs.readFileSync(path.join(root, "server/services/billing/invoiceApprovalService.ts"), "utf8");
if (!approval.includes("VALID_TRANSITIONS")) failures.push("approval service must define VALID_TRANSITIONS");
if (!/void.*requires a reason/.test(approval)) failures.push("approval void must require a reason");
if (!/approvedByUserId\s*=\s*input\.actorUserId/.test(approval) && !/approvedByUserId:\s*input\.actorUserId/.test(approval)) {
  failures.push("approve must record actor user id");
}

const draft = fs.readFileSync(path.join(root, "server/services/billing/invoiceDraftService.ts"), "utf8");
if (!draft.includes("createDraftsFromBatch")) failures.push("draft service must export createDraftsFromBatch");
// must not double-draft
if (!/already_drafted|invoice_drafts_created/.test(draft)) failures.push("draft service must guard against double-drafting");
// must copy snapshots to invoice
if (!/policySnapshot:\s*policy/.test(draft) || !/recipientSnapshot:\s*batch\.recipientSnapshot/.test(draft)) {
  failures.push("draft service must capture policy + recipient snapshots onto the invoice");
}

const route = fs.readFileSync(path.join(root, "server/routes/invoiceApproval.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.post("/api/invoice-batches/:id/create-drafts"',
  'app.post("/api/invoices/:id/submit-for-review"',
  'app.post("/api/invoices/:id/approve"',
  'app.post("/api/invoices/:id/void"',
  'app.post("/api/invoices/:id/revise"',
  'app.get("/api/invoices/:id/audit"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`approval route must register ${r}`);
}

const page = fs.readFileSync(path.join(root, "client/src/pages/invoice-review.tsx"), "utf8");
if (!page.includes("postCreateDraftsFromBatch")) failures.push("review page must call postCreateDraftsFromBatch");
if (!page.includes("invoice-void-reason")) failures.push("review page must require typed void reason");

if (failures.length > 0) {
  console.error("Phase-4 invoice-draft-approval-workflow QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 invoice-draft-approval-workflow QA passed.");
