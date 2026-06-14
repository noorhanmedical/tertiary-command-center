// QA — Phase 4 PR 4.5 invoice delivery runtime.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/invoiceDelivery.ts",
  "migrations/0037_phase4_invoice_delivery_events.sql",
  "server/services/billing/invoiceDeliveryService.ts",
  "server/routes/invoiceDelivery.ts",
  "client/src/lib/invoiceDeliveryApi.ts",
  "client/src/pages/invoice-delivery.tsx",
  "docs/architecture/phase-4-invoice-delivery-runtime.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const service = fs.readFileSync(path.join(root, "server/services/billing/invoiceDeliveryService.ts"), "utf8");
const REQUIRED_EXPORTS = ["resolveRecipientsFromSnapshot", "queueDelivery", "sendEmailDelivery", "sendReminderDelivery"];
for (const e of REQUIRED_EXPORTS) {
  if (!service.includes(`export async function ${e}`) && !service.includes(`export function ${e}`)) {
    failures.push(`delivery service must export ${e}`);
  }
}
// Approval gate.
if (!/approvalStatus !== "approved"/.test(service)) failures.push("delivery service must require approvalStatus = approved");
// Honest blocked states.
if (!/blocked_missing_recipient/.test(service)) failures.push("delivery service must set blocked_missing_recipient");
if (!/blocked.*not_approved/.test(service)) failures.push("delivery service must log blocked with reason not_approved");
// Failed transitions logged.
if (!/deliveryStatus: "failed"/.test(service)) failures.push("delivery service must transition to failed on send error");

const route = fs.readFileSync(path.join(root, "server/routes/invoiceDelivery.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/invoice-delivery-queue"',
  'app.get("/api/invoices/:id/delivery-events"',
  'app.post("/api/invoices/:id/queue-delivery"',
  'app.post("/api/invoices/:id/send-email"',
  'app.post("/api/invoices/:id/send-reminder"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`delivery route must register ${r}`);
}

const page = fs.readFileSync(path.join(root, "client/src/pages/invoice-delivery.tsx"), "utf8");
// Send button only when approved + not already sent.
if (!/r\.approvalStatus === "approved" && r\.deliveryStatus !== "sent"/.test(page)) {
  failures.push("send button must be gated on approvalStatus = approved AND deliveryStatus != sent");
}
// No fake sent toast — the toast fires only inside onSuccess (after the API resolved).
if (!/onSuccess:.*toast\(\{ title: "Sent"/s.test(page)) {
  failures.push("delivery page must fire 'Sent' toast only from onSuccess");
}

if (failures.length > 0) {
  console.error("Phase-4 invoice-delivery-runtime QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 invoice-delivery-runtime QA passed.");
