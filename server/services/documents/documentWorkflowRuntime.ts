// documentWorkflowRuntime — Phase 2 PR 2.9.
//
// Centralizes the small steps the document workflow performs after
// a file is uploaded for a case:
//   1. Patient + service_type + document_type tuple identified.
//   2. Readiness row upserted via the canonical route helper.
//   3. Journey event appended (document_completed).
//   4. Billing readiness re-evaluated by the existing aggregator
//      (no change to that logic; PR 2.9 only orchestrates).
//
// This service is intentionally thin. It does NOT introduce a new
// writer for documents — the canonical writer remains
// /api/portal/uploads + /api/case-document-readiness/complete. PR 2.9
// wraps them into a single ergonomic call for the ACS panel.

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";

export type EvaluateAttachmentArgs = {
  executionCaseId: number;
  patientScreeningId: number | null;
  serviceType: string;
  documentType: string;
};

export type AttachmentEvaluation = {
  exists: boolean;
  presentStatuses: string[];
  /** When true, this attachment counts toward billing-readiness. */
  blocksBilling: boolean;
};

const PRESENT_STATUSES = new Set([
  "completed", "complete", "uploaded", "generated", "approved",
  "signed", "verified", "present",
]);

export async function evaluatePatientTestAttachment(
  args: EvaluateAttachmentArgs,
): Promise<AttachmentEvaluation> {
  const conditions = [
    eq(caseDocumentReadiness.serviceType, args.serviceType),
    eq(caseDocumentReadiness.documentType, args.documentType),
  ];
  if (args.patientScreeningId != null) {
    conditions.push(eq(caseDocumentReadiness.patientScreeningId, args.patientScreeningId));
  } else {
    conditions.push(eq(caseDocumentReadiness.executionCaseId, args.executionCaseId));
  }
  const rows = await db.select().from(caseDocumentReadiness).where(and(...conditions));
  if (rows.length === 0) {
    return { exists: false, presentStatuses: [], blocksBilling: false };
  }
  const presentStatuses = rows
    .filter((r) => PRESENT_STATUSES.has((r.documentStatus ?? "").toLowerCase()))
    .map((r) => r.documentStatus);
  const blocksBilling = rows.some((r) => r.blocksBilling);
  return { exists: true, presentStatuses, blocksBilling };
}
