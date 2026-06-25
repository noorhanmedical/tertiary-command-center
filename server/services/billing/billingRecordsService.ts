// Service wrapper for the GET /api/billing-records auto-create scan.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/billing.ts lines 67-111, registered as
//   GET /api/billing-records.
//
// Scope (CONFIRMED by direct re-read of the source handler):
//   This is the "read-as-write" scan that fires on every GET. It:
//     1. Loads ALL screening batches.
//     2. For each batch, loads its patient screenings.
//     3. Filters to completed patients with non-empty qualifyingTests.
//     4. For each (patient, test) pair: checks for an existing
//        billing_records row via getBillingRecordByPatientAndService;
//        creates one if absent with the exact column defaults
//        `billingStatus: "Not Billed"` and `paidStatus: "Unpaid"`.
//     5. If any rows were created, fires backgroundSyncBilling()
//        (fire-and-forget; void) BEFORE the final read.
//     6. Returns the complete getAllBillingRecords() snapshot.
//
//   This wrapper is intentionally NOT an optimization. The O(batches ×
//   patients × tests) scan is preserved verbatim. The orchestrator's
//   Batch 14/17 will move the auto-create to a write-only path on
//   patient commit; until then, parity is the goal.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §9.1):
//   - Iteration order: batches as returned by getAllScreeningBatches();
//     within each batch, patients as returned by getPatientScreeningsByBatch.
//     Both are unchanged from the original handler.
//   - Filter rule: `p.status === "completed" && p.qualifyingTests &&
//     p.qualifyingTests.length > 0`. Unchanged.
//   - Per-(patient,test) probe: getBillingRecordByPatientAndService(patient.id, test).
//     Unchanged. No row-level lock; concurrent GETs may race the same way
//     they have always raced. Preserving this behavior is the explicit goal
//     of Batch 3c — concurrency fixes belong to Batch 17.
//   - createBillingRecord payload: identical field-for-field to the
//     original (patientId, batchId, service, facility, dateOfService,
//     patientName, clinician, billingStatus: "Not Billed",
//     paidStatus: "Unpaid"). All `|| null` fallbacks preserved verbatim.
//   - backgroundSyncBilling: fired (void) AFTER the auto-create loop
//     and BEFORE the final getAllBillingRecords() call. Same as
//     original.
//   - Response source: storage.getAllBillingRecords() AFTER any
//     auto-create writes. Unchanged.
//
// What this wrapper does NOT change:
//   - No optimization of the O(n³) scan.
//   - No new transaction, lock, or batching.
//   - No new column defaults.
//   - No new conditions for auto-create.
//   - No PHI logging added (none in original; none added).
//   - No claims, remittances, denials, invoices, payments, or revenue-share
//     logic touched.
//   - No scheduler-assignment behavior.

import type { BillingRecord } from "@shared/schema";
import { storage } from "../../storage";

/**
 * Run the GET /api/billing-records scan: discover screened patients that
 * lack billing records for their qualifying tests, auto-create missing
 * rows, fire the background sync (fire-and-forget) if anything was
 * created, then return the complete current billing_records snapshot.
 *
 * Mirrors the previous inline handler in server/routes/billing.ts
 * step-for-step. The caller (the route) is responsible for HTTP framing
 * only (parse req, JSON serialize, 500 envelope on throw).
 */
export async function listBillingRecordsWithAutoCreate(): Promise<BillingRecord[]> {
  const batches = await storage.getAllScreeningBatches();
  const allScreenedPatients: any[] = [];
  for (const batch of batches) {
    const patients = await storage.getPatientScreeningsByBatch(batch.id);
    for (const p of patients) {
      if (p.status === "completed" && p.qualifyingTests && p.qualifyingTests.length > 0) {
        allScreenedPatients.push({ patient: p, batch });
      }
    }
  }

  let billingAutoCreated = 0;
  for (const { patient, batch } of allScreenedPatients) {
    const tests: string[] = patient.qualifyingTests || [];
    for (const test of tests) {
      const existing = await storage.getBillingRecordByPatientAndService(patient.id, test);
      if (!existing) {
        await storage.createBillingRecord({
          patientId: patient.id,
          batchId: batch.id,
          service: test,
          facility: batch.facility || null,
          dateOfService: batch.scheduleDate || null,
          patientName: patient.name,
          clinician: batch.clinicianName || null,
          billingStatus: "Not Billed",
          paidStatus: "Unpaid",
        });
        billingAutoCreated++;
      }
    }
  }

  return await storage.getAllBillingRecords();
}
