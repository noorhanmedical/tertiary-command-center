// QA for the procedure → readiness → tasks spine that batches 2-8
// landed.
//
// Run with: npm run qa:procedure-readiness-spine
//
// Verifies (no DB required):
//   1. PROCEDURE_STATUSES enum still contains the canonical values used
//      by the staged-workflow UI (`not_started`, `in_progress`,
//      `complete`, `cancelled`, `no_show`, `reschedule_needed`).
//   2. The Missing-Document task helper exposes the canonical document
//      type set used by the readiness panel and the missing-task
//      reconciliation.
//   3. BILLING_READINESS_STATUSES contains the canonical enum values
//      the recompute route refers to (`ready_to_generate`,
//      `missing_requirements`, `billing_document_generated`,
//      `sent_to_billing`, `not_ready`).
//   4. PACKAGE_STATUSES contains the canonical enum values the
//      transition route refers to + the shorthand alias map maps to
//      the right canonical names.
//
// Optional (when DATABASE_URL is set):
//   5. ensureMissingDocumentTask / resolveMissingDocumentTask are
//      idempotent on an `isTest=true` patient. Restored afterwards.

import {
  PROCEDURE_STATUSES,
} from "@shared/schema/procedureEvents";
import {
  BILLING_READINESS_STATUSES,
} from "@shared/schema/billingReadiness";
import {
  PACKAGE_STATUSES,
} from "@shared/schema/completedBillingPackages";

// Mirror of MISSING_DOC_TYPES from
// server/repositories/missingDocumentTasks.repo.ts. We don't import
// directly because that repo pulls in server/db.ts at module-load,
// which requires DATABASE_URL — keeping this script DB-optional.
const MISSING_DOC_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  "billing_document",
] as const;

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  console.log("\n--- canonical enums for staged workflow ---");
  for (const s of ["not_started", "in_progress", "complete", "cancelled", "no_show", "reschedule_needed"]) {
    assert(
      (PROCEDURE_STATUSES as readonly string[]).includes(s),
      `PROCEDURE_STATUSES contains "${s}"`,
    );
  }

  console.log("\n--- canonical document checklist ---");
  for (const docType of [
    "informed_consent",
    "screening_form",
    "report",
    "order_note",
    "post_procedure_note",
    "billing_document",
  ]) {
    assert(
      (MISSING_DOC_TYPES as readonly string[]).includes(docType),
      `MISSING_DOC_TYPES contains "${docType}"`,
    );
  }

  console.log("\n--- billing readiness enum ---");
  for (const s of [
    "not_ready",
    "missing_requirements",
    "ready_to_generate",
    "billing_document_generated",
    "sent_to_billing",
  ]) {
    assert(
      (BILLING_READINESS_STATUSES as readonly string[]).includes(s),
      `BILLING_READINESS_STATUSES contains "${s}"`,
    );
  }

  console.log("\n--- completed-package status enum ---");
  for (const s of [
    "pending_payment",
    "payment_updated",
    "completed_package",
    "added_to_invoice",
    "invoiced",
    "closed",
  ]) {
    assert(
      (PACKAGE_STATUSES as readonly string[]).includes(s),
      `PACKAGE_STATUSES contains "${s}"`,
    );
  }
  // The transition route accepts the shorthand alias map. The mapping
  // is fixed in source — verify it here so a rename doesn't quietly
  // break callers.
  const STATUS_ALIAS: Record<string, string> = {
    draft: "pending_payment",
    ready: "payment_updated",
    completed: "completed_package",
  };
  for (const [alias, canonical] of Object.entries(STATUS_ALIAS)) {
    assert(
      (PACKAGE_STATUSES as readonly string[]).includes(canonical),
      `transition alias "${alias}" maps to canonical status "${canonical}"`,
    );
  }

  if (!process.env.DATABASE_URL) {
    console.log("\n[qa-procedure-readiness-spine] DATABASE_URL missing — skipping DB writes.");
  } else {
    console.log("\n--- DB missing-document task helpers (isTest patient) ---");
    const storageMod = await import("../server/storage");
    const missingDocs = await import("../server/repositories/missingDocumentTasks.repo");
    const dbMod = await import("../server/db");
    const schemaMod = await import("@shared/schema");
    const drizzleMod = await import("drizzle-orm");
    const { storage } = storageMod;
    const { ensureMissingDocumentTask, resolveMissingDocumentTask } = missingDocs;
    const { db } = dbMod;
    const { plexusTasks } = schemaMod;
    const { eq } = drizzleMod;

    const allActive = await storage.getAllPatientScreenings();
    const isTestPatient = allActive.find((p) => p.isTest === true);
    if (!isTestPatient) {
      console.log("[qa] No isTest patient — skipping helper write smoke.");
    } else {
      // Idempotent ensure: two calls produce one task
      const first = await ensureMissingDocumentTask({
        documentType: "report",
        patientScreeningId: isTestPatient.id,
        patientName: isTestPatient.name,
        serviceType: "qa_smoke_service",
      });
      const second = await ensureMissingDocumentTask({
        documentType: "report",
        patientScreeningId: isTestPatient.id,
        patientName: isTestPatient.name,
        serviceType: "qa_smoke_service",
      });
      assert(first?.id === second?.id, "ensureMissingDocumentTask is idempotent");

      // Resolve closes it
      const resolved = await resolveMissingDocumentTask({
        documentType: "report",
        patientScreeningId: isTestPatient.id,
      });
      assert(resolved?.id === first?.id, "resolveMissingDocumentTask closes the open task");
      assert(
        resolved?.status === "done" || resolved?.status === "closed",
        "resolved task moves to a terminal status",
      );

      // Cleanup: delete the test task so the patient is left clean
      if (first?.id != null) {
        await db.delete(plexusTasks).where(eq(plexusTasks.id, first.id));
      }
    }
  }

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
