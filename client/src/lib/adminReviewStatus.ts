import type { PatientScreening } from "@shared/schema";

// Centralized definition of "ready for admin review" used by
// PatientCard (to lavender the card + show the primary Admin Review
// button) and AdminReviewDialog (to title the modal).
//
// "Ready for admin review" means the patient is a real candidate to
// approve and ship — qualification has been generated, all
// engagement-required fields are present, and an admin hasn't acted
// yet (status is pending or needs_info). Approved + rejected patients
// are not "ready" — they're already decided.
//
// Send to Engagement still requires `adminApprovalStatus === "approved"`
// regardless of this helper; this helper drives the *UI affordance*
// for the admin action, not the canonical send gate.

export type AdminApprovalStatus = "pending" | "approved" | "needs_info" | "rejected";

export type AdminReviewStatus =
  | "incomplete"          // Missing required fields or no qualification — admin can't review yet.
  | "ready_for_review"    // Lavender state: pending/needs_info + everything in place.
  | "approved"            // adminApprovalStatus === "approved"
  | "rejected"            // adminApprovalStatus === "rejected"
  | "needs_info";         // adminApprovalStatus === "needs_info" + everything in place

export type AdminReviewMissing =
  | "name"
  | "DOB"
  | "phone"
  | "facility"
  | "qualification";

export type AdminReviewResult = {
  status: AdminReviewStatus;
  approval: AdminApprovalStatus;
  missing: AdminReviewMissing[];
  hasQualification: boolean;
  isPatientSent: boolean;
  readyForAdminReview: boolean;
};

function normalizeApproval(value: unknown): AdminApprovalStatus {
  if (value === "approved" || value === "needs_info" || value === "rejected") return value;
  return "pending";
}

export function computeAdminReview(
  patient: Pick<
    PatientScreening,
    "name" | "dob" | "phoneNumber" | "facility" | "qualifyingTests" | "commitStatus"
  > & { adminApprovalStatus?: string | null },
): AdminReviewResult {
  const approval = normalizeApproval(patient.adminApprovalStatus);

  const missing: AdminReviewMissing[] = [];
  if (!patient.name?.trim()) missing.push("name");
  if (!patient.dob?.trim()) missing.push("DOB");
  if (!patient.phoneNumber?.trim()) missing.push("phone");
  if (!patient.facility?.trim()) missing.push("facility");
  const tests = Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests : [];
  const hasQualification = tests.length > 0;
  if (!hasQualification) missing.push("qualification");

  const isPatientSent = (patient.commitStatus ?? "Draft") !== "Draft";
  const everythingInPlace = missing.length === 0;

  let status: AdminReviewStatus;
  if (approval === "approved") status = "approved";
  else if (approval === "rejected") status = "rejected";
  else if (!everythingInPlace) status = "incomplete";
  else if (approval === "needs_info") status = "needs_info";
  else status = "ready_for_review";

  const readyForAdminReview =
    everythingInPlace &&
    !isPatientSent &&
    (approval === "pending" || approval === "needs_info");

  return {
    status,
    approval,
    missing,
    hasQualification,
    isPatientSent,
    readyForAdminReview,
  };
}
