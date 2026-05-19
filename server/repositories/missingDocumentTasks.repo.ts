import { and, eq, ilike, ne } from "drizzle-orm";
import { db } from "../db";
import { plexusTasks } from "@shared/schema/plexus";

// Helper for converting blocking-document-readiness gaps into Plexus
// tasks. Side-effect helpers are idempotent: ensure-* never creates a
// duplicate when an open task with the same title pattern already
// exists for the same patient screening id; resolve-* closes the open
// task for that doc type when the readiness flips to satisfied.
//
// Status values mirror the in-repo convention (`open` for active,
// `done` / `closed` for terminal — see plexus.repo.ts).

export const MISSING_DOC_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  "billing_document",
] as const;
export type MissingDocType = (typeof MISSING_DOC_TYPES)[number];

const DOC_LABEL: Record<MissingDocType, string> = {
  informed_consent: "Consent",
  screening_form: "Screening Form",
  report: "Report",
  order_note: "Order Note",
  post_procedure_note: "Procedure Note",
  billing_document: "Billing Document",
};

function titleForMissingDoc(docType: MissingDocType, patientName: string | null) {
  const who = patientName?.trim() ? patientName.trim() : "Patient";
  return `Missing ${DOC_LABEL[docType]} for ${who}`;
}

export type EnsureMissingDocTaskInput = {
  documentType: MissingDocType;
  patientScreeningId?: number | null;
  patientName?: string | null;
  serviceType?: string | null;
  facility?: string | null;
  batchId?: number | null;
  urgency?: "none" | "low" | "normal" | "high" | "urgent";
  description?: string | null;
};

// Idempotent: returns existing open task if one already exists for
// (patientScreeningId, documentType) — keyed by patientScreeningId +
// title prefix `Missing <Label>` so we don't duplicate when the
// caller fires repeatedly.
export async function ensureMissingDocumentTask(input: EnsureMissingDocTaskInput) {
  if (input.patientScreeningId == null) return null;
  const titlePrefix = `Missing ${DOC_LABEL[input.documentType]}`;
  const [existing] = await db
    .select()
    .from(plexusTasks)
    .where(
      and(
        eq(plexusTasks.patientScreeningId, input.patientScreeningId),
        ilike(plexusTasks.title, `${titlePrefix}%`),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(plexusTasks)
    .values({
      title: titleForMissingDoc(input.documentType, input.patientName ?? null),
      description:
        input.description ??
        `Auto-created from document readiness. ${DOC_LABEL[input.documentType]} is currently missing for ${
          input.serviceType ?? "this procedure"
        }${input.facility ? ` at ${input.facility}` : ""}.`,
      taskType: "missing_document",
      urgency: input.urgency ?? "normal",
      status: "open",
      patientScreeningId: input.patientScreeningId,
      batchId: input.batchId ?? null,
    })
    .returning();
  return created ?? null;
}

export type ResolveMissingDocTaskInput = {
  documentType: MissingDocType;
  patientScreeningId?: number | null;
  resolverUserId?: string | null;
};

// Closes the matching open missing-document task when readiness flips
// to satisfied. No-op if no matching open task exists.
export async function resolveMissingDocumentTask(input: ResolveMissingDocTaskInput) {
  if (input.patientScreeningId == null) return null;
  const titlePrefix = `Missing ${DOC_LABEL[input.documentType]}`;
  const [existing] = await db
    .select()
    .from(plexusTasks)
    .where(
      and(
        eq(plexusTasks.patientScreeningId, input.patientScreeningId),
        ilike(plexusTasks.title, `${titlePrefix}%`),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
      ),
    )
    .limit(1);
  if (!existing) return null;
  const [updated] = await db
    .update(plexusTasks)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(plexusTasks.id, existing.id))
    .returning();
  return updated ?? null;
}
