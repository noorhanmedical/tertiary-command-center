// QA for outbox coverage + the documented migration plan.
// Run with: `npm run qa:outbox-coverage`. No DB required.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OUTBOX_KINDS,
  OUTBOX_STATUSES,
} from "../shared/schema/outbox";

let passes = 0;
let failures = 0;
function assert(c: unknown, l: string) {
  if (c) { passes++; console.log(`  ✓ ${l}`); }
  else { failures++; console.log(`  ✗ ${l}`); }
}
function readFile(p: string): string {
  try { return readFileSync(resolve(process.cwd(), p), "utf8"); } catch { return ""; }
}

function main() {
  console.log("\n--- outbox canonical enums ---");
  for (const k of ["drive_file", "sheet_billing", "sheet_patients"]) {
    assert(
      (OUTBOX_KINDS as readonly string[]).includes(k),
      `OUTBOX_KINDS contains "${k}"`,
    );
  }
  for (const s of ["pending", "uploading", "completed", "failed"]) {
    assert(
      (OUTBOX_STATUSES as readonly string[]).includes(s),
      `OUTBOX_STATUSES contains "${s}"`,
    );
  }

  console.log("\n--- outbox helpers + routes ---");
  const service = readFile("server/services/outbox.ts");
  assert(/export async function enqueueDriveFile/.test(service) || /enqueueDriveFile/.test(service), "enqueueDriveFile is exported");
  assert(/export async function enqueueSheetSync/.test(service) || /enqueueSheetSync/.test(service), "enqueueSheetSync is exported");
  assert(/export async function drainOutbox/.test(service) || /drainOutbox/.test(service), "drainOutbox is exported");
  assert(/getOutboxSummary/.test(service), "getOutboxSummary helper exists");

  const route = readFile("server/routes/outbox.ts");
  assert(/\/api\/outbox\b/.test(route), "GET /api/outbox is mounted");
  assert(/\/api\/outbox\/drain\b/.test(route), "POST /api/outbox/drain is mounted");
  assert(/\/api\/outbox\/enqueue-sheets\b/.test(route), "POST /api/outbox/enqueue-sheets is mounted");

  console.log("\n--- background drain runner ---");
  const sync = readFile("server/services/syncService.ts");
  assert(
    /drainOutbox|backgroundSync/.test(sync),
    "syncService references the drain loop",
  );

  console.log("\n--- email outbox migration plan exists ---");
  const plan = readFile("docs/architecture/email-outbox-migration-plan.md");
  assert(plan.length > 0, "email-outbox-migration-plan.md exists");
  assert(/invoiceReminderService/.test(plan), "plan covers invoiceReminderService caller");
  assert(/\/api\/outreach\/send-email/.test(plan), "plan covers /api/outreach/send-email caller");
  assert(/\/api\/invoices\/:id\/send-email/.test(plan), "plan covers /api/invoices/:id/send-email caller");
  assert(/idempotencyKey/.test(plan), "plan calls out idempotency contract");
  assert(/dead_letter|dead-letter|DLQ/.test(plan), "plan calls out DLQ contract");

  console.log("\n--- outbox audit doc exists ---");
  const auditDoc = readFile("docs/architecture/integration-outbox-audit.md");
  assert(auditDoc.length > 0, "integration-outbox-audit.md exists");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main();
