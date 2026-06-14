// patientTestAttachmentService — Phase 2 PR 2.9.
//
// Pure helper: given a patient + test + document type, decide what
// the next state should be after a successful upload. The ACS panel
// + future inline upload UIs call this to render a deterministic
// "what happens next" hint BEFORE the operator clicks upload.
//
// No DB access here. The caller passes the document type and the
// existing readiness rows; this service decides the next-state
// label.

export type AttachmentDocumentType =
  | "informed_consent"
  | "screening_form"
  | "report"
  | "order_note"
  | "post_procedure_note"
  | "physician_signed_order"
  | "billing_document";

export type NextAttachmentState = {
  /** The status that will be written when the upload completes. */
  nextDocumentStatus: string;
  /** Whether this attachment will satisfy a billing-required slot. */
  satisfiesBillingRequirement: boolean;
  /** Human-readable label for the UI. */
  label: string;
};

const NEXT_STATE_BY_TYPE: Record<AttachmentDocumentType, NextAttachmentState> = {
  informed_consent: {
    nextDocumentStatus: "completed",
    satisfiesBillingRequirement: true,
    label: "Consent will be marked as completed.",
  },
  screening_form: {
    nextDocumentStatus: "completed",
    satisfiesBillingRequirement: true,
    label: "Screening form will be marked as completed.",
  },
  report: {
    nextDocumentStatus: "uploaded",
    satisfiesBillingRequirement: true,
    label: "Report will be marked as uploaded.",
  },
  order_note: {
    nextDocumentStatus: "generated",
    satisfiesBillingRequirement: true,
    label: "Order note will be saved + marked as generated.",
  },
  post_procedure_note: {
    nextDocumentStatus: "generated",
    satisfiesBillingRequirement: true,
    label: "Procedure note will be saved + marked as generated.",
  },
  physician_signed_order: {
    nextDocumentStatus: "uploaded",
    satisfiesBillingRequirement: false,
    label: "Signed order will be uploaded. Physician signing workflow remains Phase 6.",
  },
  billing_document: {
    nextDocumentStatus: "uploaded",
    satisfiesBillingRequirement: true,
    label: "Billing document will be marked as uploaded.",
  },
};

export function getNextAttachmentState(
  documentType: AttachmentDocumentType,
): NextAttachmentState {
  return NEXT_STATE_BY_TYPE[documentType];
}
