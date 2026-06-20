import type { PatientScreening } from "@shared/schema";
import { auditPacketPatient, isAnalysisFailureOnly } from "@/lib/packetQa";

// ────────────────────────────────────────────────────────────────────
// Plexus IQ clean operating list — canonical row STATUS + FLAGS model.
//
// Plexus IQ owns intake → qualification → review → admin approval →
// handoff to Engagement. It must surface NONE of the downstream
// journey lifecycle. A row therefore carries exactly one of six
// statuses, all derived from existing persisted fields (no new
// columns):
//
//   pending_qualification  — imported, not yet qualified
//   qualification_running  — an analysis job is processing this batch/patient
//   ready_for_review       — qualified, awaiting admin sign-off
//   admin_approved         — adminApprovalStatus === "approved"
//   sent_to_engagement     — commitStatus !== "Draft"
//   failed                 — analysis failed / needs fix
//
// Everything else that needs operator attention (missing info, cooldown
// verification, stale evidence, packet blockers) is a FLAG, never a
// status. Flags decorate the row but never change its status.
// ────────────────────────────────────────────────────────────────────

export type PlexusIqStatus =
  | "pending_qualification"
  | "qualification_running"
  | "ready_for_review"
  | "admin_approved"
  | "sent_to_engagement"
  | "failed";

export type PlexusIqStatusMeta = {
  status: PlexusIqStatus;
  label: string;
  /** Tailwind classes for the pill. */
  pillClass: string;
  /** True while a job is actively processing (drives the spinner). */
  running: boolean;
};

const STATUS_LABELS: Record<PlexusIqStatus, string> = {
  pending_qualification: "Pending Qualification",
  qualification_running: "Qualification Running",
  ready_for_review: "Ready for Review",
  admin_approved: "Admin Approved",
  sent_to_engagement: "Sent to Engagement",
  failed: "Failed / Needs Fix",
};

const STATUS_PILL: Record<PlexusIqStatus, string> = {
  pending_qualification: "bg-slate-100 text-slate-700 border-slate-200",
  qualification_running: "bg-sky-50 text-sky-800 border-sky-200",
  ready_for_review: "bg-violet-50 text-violet-800 border-violet-200",
  admin_approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  sent_to_engagement: "bg-teal-50 text-teal-800 border-teal-200",
  failed: "bg-rose-50 text-rose-800 border-rose-200",
};

function normalizeApproval(value: unknown): string {
  if (value === "approved" || value === "needs_info" || value === "rejected") return value;
  return "pending";
}

/**
 * Derive the single canonical Plexus IQ status for a patient row.
 *
 * Precedence (highest first):
 *   sent → approved → running → failed → ready → pending
 *
 * `isRunning` is passed by the caller from live analysis-job state
 * (per-batch `analyzingBatchId`, per-patient `analyzingPatients`, and
 * active clinical-import qualification jobs).
 */
export function computePlexusIqStatus(
  patient: Pick<
    PatientScreening,
    "status" | "commitStatus" | "adminApprovalStatus" | "qualifyingTests" | "reasoning"
  >,
  opts: { isRunning?: boolean } = {},
): PlexusIqStatusMeta {
  const isSent = (patient.commitStatus ?? "Draft") !== "Draft";
  const approval = normalizeApproval(patient.adminApprovalStatus);
  const generated = patient.status === "completed";
  const failed =
    patient.status === "failed" || isAnalysisFailureOnly(patient.reasoning);

  let status: PlexusIqStatus;
  if (isSent) status = "sent_to_engagement";
  else if (approval === "approved") status = "admin_approved";
  else if (opts.isRunning) status = "qualification_running";
  else if (failed) status = "failed";
  else if (generated) status = "ready_for_review";
  else status = "pending_qualification";

  return {
    status,
    label: STATUS_LABELS[status],
    pillClass: STATUS_PILL[status],
    running: status === "qualification_running",
  };
}

// ────────────────────────────────────────────────────────────────────
// Flags — "Needs Attention" items. These NEVER alter the row status.
// ────────────────────────────────────────────────────────────────────

export type PlexusIqFlagKind =
  | "missing_demographics"
  | "missing_clinical"
  | "prior_testing_unclear"
  | "cooldown_review"
  | "evidence_changed"
  | "packet_blocker";

export type PlexusIqFlag = {
  kind: PlexusIqFlagKind;
  label: string;
  detail: string;
};

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function hasCooldownEntries(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

/**
 * Compute the attention flags for a patient row. Pure + derived from
 * persisted fields only, so the same flags render consistently in the
 * list and in review.
 */
export function computePlexusIqFlags(patient: PatientScreening): PlexusIqFlag[] {
  const flags: PlexusIqFlag[] = [];

  const missingDemo: string[] = [];
  if (isBlank(patient.dob)) missingDemo.push("DOB");
  if (isBlank(patient.phoneNumber)) missingDemo.push("Phone");
  if (isBlank(patient.insurance)) missingDemo.push("Insurance");
  if (missingDemo.length > 0) {
    flags.push({
      kind: "missing_demographics",
      label: "Missing demographics",
      detail: missingDemo.join(", "),
    });
  }

  const missingClinical: string[] = [];
  if (isBlank(patient.diagnoses)) missingClinical.push("Dx");
  if (isBlank(patient.history)) missingClinical.push("Hx");
  if (isBlank(patient.medications)) missingClinical.push("Rx");
  if (missingClinical.length > 0) {
    flags.push({
      kind: "missing_clinical",
      label: "Missing clinical info",
      detail: missingClinical.join(", "),
    });
  }

  if (isBlank(patient.previousTests) && !patient.noPreviousTests) {
    flags.push({
      kind: "prior_testing_unclear",
      label: "Prior testing unclear",
      detail: "No previous tests recorded and 'no previous tests' not confirmed",
    });
  }

  if (hasCooldownEntries(patient.cooldownTests)) {
    flags.push({
      kind: "cooldown_review",
      label: "Cooldown verification",
      detail: "One or more tests may be inside a re-eligibility window",
    });
  }

  // Packet QA: stale evidence (regeneration required) + any other
  // blocker that would make a packet dishonest. Demographic blockers
  // are already covered above, so only surface the non-demographic
  // packet blockers here.
  const audit = auditPacketPatient(patient, "plexus");
  const stale = audit.blockers.some((b) => b.kind === "stale_admin_review");
  if (stale) {
    flags.push({
      kind: "evidence_changed",
      label: "Evidence changed — regeneration required",
      detail: "Assigned evidence changed since last generation. Regenerate before approving.",
    });
  }
  const otherPacketBlockers = audit.blockers.filter(
    (b) =>
      b.kind !== "stale_admin_review" &&
      b.kind !== "missing_dob" &&
      b.kind !== "missing_name" &&
      b.kind !== "missing_facility",
  );
  if (otherPacketBlockers.length > 0) {
    flags.push({
      kind: "packet_blocker",
      label: "Packet blocker",
      detail: otherPacketBlockers.map((b) => b.message).join("; "),
    });
  }

  return flags;
}
