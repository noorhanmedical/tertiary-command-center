// EMR type layer for the premium Patient EHR chart.
//
import type { AncillaryAppointmentProjection } from "@shared/types/canonicalAppointment";
//
// These interfaces describe the 15 API-ready data categories the EMR
// chart renders. Every field is optional/nullable so the chart never
// crashes on missing data — sections that have no live source render a
// clean empty state instead of hiding.
//
// No backend changes are required: today's chart projects these shapes
// from existing tables (patient_screenings, patient_execution_cases,
// cooldown_records, insurance_eligibility_reviews, ancillary_appointments,
// documents, billing). Categories that are not yet wired to a source
// (labs, imaging, vitals, encounters, ad-automation) carry the same
// interface so future API work can populate them without UI churn.

// ── 1. Demographics ─────────────────────────────────────────────────────
export interface EmrDemographics {
  name?: string | null;
  mrn?: string | null;
  dob?: string | null;
  age?: number | null;
  gender?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  address?: string | null;
  clinic?: string | null;
  provider?: string | null;
  language?: string | null;
}

// ── 2. Insurance & Eligibility ──────────────────────────────────────────
export interface EmrInsurancePlan {
  insuranceName?: string | null;
  insuranceType?: string | null;
  priorityClass?: string | null;
  eligibilityStatus?: string | null;
  approvalStatus?: string | null;
  note?: string | null;
  reviewedAt?: string | null;
}

export interface EmrInsurance {
  primary?: string | null;
  plans?: EmrInsurancePlan[] | null;
}

// ── 3. Providers ────────────────────────────────────────────────────────
export interface EmrProvider {
  name?: string | null;
  role?: string | null;
  facility?: string | null;
}

// ── 4. Diagnoses / Problem List ─────────────────────────────────────────
export interface EmrDiagnosis {
  description?: string | null;
  icd10?: string | null;
  status?: string | null;
}

// ── 5. Medications ──────────────────────────────────────────────────────
export interface EmrMedication {
  name?: string | null;
  dose?: string | null;
  frequency?: string | null;
}

// ── 6. Allergies ────────────────────────────────────────────────────────
export interface EmrAllergy {
  substance?: string | null;
  reaction?: string | null;
  severity?: string | null;
}

// ── 7. Labs ─────────────────────────────────────────────────────────────
export interface EmrLab {
  name?: string | null;
  value?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  collectedAt?: string | null;
  flag?: "normal" | "high" | "low" | "critical" | null;
}

// ── 8. Imaging ──────────────────────────────────────────────────────────
export interface EmrImaging {
  study?: string | null;
  modality?: string | null;
  performedAt?: string | null;
  status?: string | null;
  impression?: string | null;
}

// ── 9. Vitals ───────────────────────────────────────────────────────────
export interface EmrVital {
  label?: string | null;
  value?: string | null;
  unit?: string | null;
  measuredAt?: string | null;
}

// ── 10. Encounters / Notes ──────────────────────────────────────────────
export interface EmrEncounter {
  title?: string | null;
  kind?: string | null;
  occurredAt?: string | null;
  provider?: string | null;
  summary?: string | null;
}

// ── 11. Documents ───────────────────────────────────────────────────────
export interface EmrDocument {
  id?: number | string | null;
  title?: string | null;
  kind?: string | null;
  version?: number | null;
  createdAt?: string | null;
  url?: string | null;
}

// ── 12. Calls & Communication ───────────────────────────────────────────
export interface EmrCall {
  id?: number | string | null;
  outcome?: string | null;
  notes?: string | null;
  callbackAt?: string | null;
  attemptNumber?: number | null;
  durationSeconds?: number | null;
  occurredAt?: string | null;
}

export interface EmrCommunicationSummary {
  callAttemptCount?: number | null;
  lastCallOutcome?: string | null;
  lastAttemptAt?: string | null;
  nextActionAt?: string | null;
  calls?: EmrCall[] | null;
}

// ── 13. Scheduling ──────────────────────────────────────────────────────
export interface EmrAppointment {
  id?: number | string | null;
  testType?: string | null;
  facility?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  status?: string | null;
  technician?: string | null;
  notes?: string | null;
}

// ── 14. Cooldown & Outreach Eligibility ─────────────────────────────────
export const COOLDOWN_STATES = [
  "clear",
  "active",
  "soft",
  "hard",
  "recently_contacted",
  "callback_scheduled",
  "declined",
  "do_not_contact",
  "ad_only_eligible",
  "re_eligible",
  "manual_review_required",
] as const;
export type CooldownState = (typeof COOLDOWN_STATES)[number];

export interface EmrCooldownRecord {
  serviceType?: string | null;
  priorServiceDate?: string | null;
  cooldownStartDate?: string | null;
  cooldownEndDate?: string | null;
  cooldownStatus?: string | null;
  overrideStatus?: string | null;
  note?: string | null;
}

export interface EmrCooldown {
  state?: CooldownState | null;
  stateLabel?: string | null;
  lastCallOutcome?: string | null;
  lastAttemptAt?: string | null;
  nextActionAt?: string | null;
  records?: EmrCooldownRecord[] | null;
  testCooldowns?: Array<{
    testName?: string | null;
    lastDate?: string | null;
    insuranceType?: string | null;
    cooldownMonths?: number | null;
    clearsAt?: string | null;
    daysUntilClear?: number | null;
    cleared?: boolean | null;
  }> | null;
}

// ── 15. Ad Automation ───────────────────────────────────────────────────
export type AdChannelStatus = "eligible" | "suppressed" | "caution";

export interface EmrAdChannel {
  channel: "phone" | "sms" | "email" | "passive_ads";
  status: AdChannelStatus;
  reason?: string | null;
}

export interface EmrAdAutomation {
  channels?: EmrAdChannel[] | null;
  suppressionReason?: string | null;
  reEngagementEligible?: boolean | null;
  hasActiveCampaign?: boolean | null;
}

// ── Billing readiness ───────────────────────────────────────────────────
export interface EmrBillingCheckItem {
  label: string;
  ready: boolean;
  detail?: string | null;
}

export interface EmrBillingReadiness {
  items?: EmrBillingCheckItem[] | null;
  records?: Array<{
    id?: number | string | null;
    service?: string | null;
    facility?: string | null;
    dateOfService?: string | null;
    billingStatus?: string | null;
  }> | null;
}

// ── Plexus IQ ───────────────────────────────────────────────────────────
export interface EmrQualifyingTest {
  testName: string;
  bucket: "brainwave" | "vitalwave" | "ultrasound";
  clinicianUnderstanding?: string | null;
  patientTalkingPoints?: string | null;
  confidence?: string | null;
}

export interface EmrPlexusIq {
  qualifyingTests?: EmrQualifyingTest[] | null;
  supportingDiagnoses?: string[] | null;
  adminApprovalStatus?: string | null;
  adminApprovalNote?: string | null;
}

// ── Active execution cases ──────────────────────────────────────────────
export interface EmrExecutionCase {
  id?: number | null;
  targetTests?: string[] | null;
  engagementBucket?: string | null;
  qualificationStatus?: string | null;
  lifecycleStatus?: string | null;
  engagementStatus?: string | null;
  assignedRole?: string | null;
  priorityScore?: number | null;
  nextActionAt?: string | null;
  callAttemptCount?: number | null;
  lastCallOutcome?: string | null;
}

// ── Case status (header) ────────────────────────────────────────────────
export interface EmrCaseStatus {
  label?: string | null;
  tone?: "green" | "amber" | "red" | "slate" | "blue";
}

// ── Clinician / Plexus report PDFs ──────────────────────────────────────
export interface EmrReportLink {
  available: boolean;
  url?: string | null;
  detail?: string | null;
}
export interface EmrReports {
  clinicianPdf: EmrReportLink;
  plexusPdf: EmrReportLink;
}

// ── Overview (at-a-glance care summary) ─────────────────────────────────
export interface EmrContactability {
  canContact: boolean;
  label: string;
  tone: "green" | "amber" | "red" | "slate" | "blue";
}
export interface EmrOverview {
  whyCall: string;
  contactability: EmrContactability;
  tiedTest?: string | null;
  proof?: string | null;
  nextAction?: string | null;
  recentCalls?: EmrCall[] | null;
  billingReadyCount: number;
  billingTotalCount: number;
}

// ── Top-level chart projection ──────────────────────────────────────────
export interface EmrChart {
  patientScreeningId?: number | null;
  demographics: EmrDemographics;
  insurance: EmrInsurance;
  providers?: EmrProvider[] | null;
  diagnoses?: EmrDiagnosis[] | null;
  medications?: EmrMedication[] | null;
  allergies?: EmrAllergy[] | null;
  labs?: EmrLab[] | null;
  imaging?: EmrImaging[] | null;
  vitals?: EmrVital[] | null;
  encounters?: EmrEncounter[] | null;
  documents?: EmrDocument[] | null;
  communication: EmrCommunicationSummary;
  scheduling?: EmrAppointment[] | null;
  /**
   * Phase 2D — canonical per-service appointment projection for this
   * patient's ancillary cases. Present only when
   * FEATURE_CANONICAL_APPOINTMENT is ON; the scheduling section renders
   * from this (canonical truth) instead of the legacy `scheduling` list.
   */
  canonicalAppointmentByService?: Record<string, AncillaryAppointmentProjection> | null;
  cooldown: EmrCooldown;
  adAutomation: EmrAdAutomation;
  billing: EmrBillingReadiness;
  plexusIq: EmrPlexusIq;
  executionCases?: EmrExecutionCase[] | null;
  caseStatus: EmrCaseStatus;
  overview: EmrOverview;
  reports: EmrReports;
}

// ── Cooldown-state derivation ───────────────────────────────────────────
// There is no single "cooldown state" column; the state is derived from
// cooldown_records + the execution case's last call outcome / next action.
// This keeps the chart honest about what the data implies without
// inventing a new persisted field.

export const COOLDOWN_STATE_LABELS: Record<CooldownState, string> = {
  clear: "Clear",
  active: "Cooldown active",
  soft: "Soft cooldown",
  hard: "Hard cooldown",
  recently_contacted: "Recently contacted",
  callback_scheduled: "Callback scheduled",
  declined: "Declined",
  do_not_contact: "Do not contact",
  ad_only_eligible: "Ad-only eligible",
  re_eligible: "Re-eligible",
  manual_review_required: "Manual review required",
};

export const COOLDOWN_STATE_TONES: Record<CooldownState, "green" | "amber" | "red" | "slate" | "blue"> = {
  clear: "green",
  re_eligible: "green",
  active: "amber",
  soft: "amber",
  recently_contacted: "amber",
  callback_scheduled: "blue",
  ad_only_eligible: "blue",
  hard: "red",
  declined: "red",
  do_not_contact: "red",
  manual_review_required: "slate",
};

const DNC_OUTCOMES = new Set(["refused_dnc", "dnc", "do_not_contact"]);
const DECLINED_OUTCOMES = new Set(["declined", "refused", "not_interested"]);
const RECENT_CONTACT_DAYS = 7;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function isFuture(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

export interface CooldownDerivationInput {
  doNotContact?: boolean | null;
  lastCallOutcome?: string | null;
  lastAttemptAt?: string | null;
  nextActionAt?: string | null;
  overridePending?: boolean | null;
  hasActiveCooldownRecord?: boolean | null;
  cooldownEndDate?: string | null;
  hasAnyPriorTest?: boolean | null;
}

/** Derive the canonical cooldown state from existing signals. */
export function deriveCooldownState(input: CooldownDerivationInput): CooldownState {
  const outcome = (input.lastCallOutcome ?? "").toLowerCase();

  if (input.doNotContact || DNC_OUTCOMES.has(outcome)) return "do_not_contact";
  if (DECLINED_OUTCOMES.has(outcome)) return "declined";
  if (input.overridePending) return "manual_review_required";
  if (isFuture(input.nextActionAt)) return "callback_scheduled";

  if (input.hasActiveCooldownRecord) {
    // Long remaining windows read as a "hard" cooldown; shorter as "soft".
    const remaining = daysSince(input.cooldownEndDate);
    const daysLeft = remaining == null ? null : -remaining;
    if (daysLeft != null && daysLeft > 60) return "hard";
    if (daysLeft != null && daysLeft > 0) return "soft";
    return "active";
  }

  const since = daysSince(input.lastAttemptAt);
  if (since != null && since <= RECENT_CONTACT_DAYS) return "recently_contacted";

  // A patient who previously had a cooldown but is now clear reads as
  // re-eligible; a brand-new patient with no history reads as clear.
  if (input.hasAnyPriorTest) return "re_eligible";
  return "clear";
}

/** Derive ad-automation channel eligibility from the cooldown state. */
export function deriveAdAutomation(state: CooldownState): EmrAdAutomation {
  const all = (status: AdChannelStatus, reason?: string): EmrAdChannel[] => [
    { channel: "phone", status, reason },
    { channel: "sms", status, reason },
    { channel: "email", status, reason },
    { channel: "passive_ads", status, reason },
  ];

  switch (state) {
    case "do_not_contact":
      return {
        channels: all("suppressed", "Patient is marked do-not-contact"),
        suppressionReason: "Do-not-contact flag is set across all channels.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "declined":
      return {
        channels: [
          { channel: "phone", status: "suppressed", reason: "Patient declined outreach" },
          { channel: "sms", status: "suppressed", reason: "Patient declined outreach" },
          { channel: "email", status: "caution", reason: "Email only after a cooling-off period" },
          { channel: "passive_ads", status: "eligible", reason: "Passive ads remain allowed" },
        ],
        suppressionReason: "Patient declined direct outreach.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "hard":
      return {
        channels: [
          { channel: "phone", status: "suppressed", reason: "Hard cooldown in effect" },
          { channel: "sms", status: "suppressed", reason: "Hard cooldown in effect" },
          { channel: "email", status: "suppressed", reason: "Hard cooldown in effect" },
          { channel: "passive_ads", status: "eligible", reason: "Ad-only nurture allowed" },
        ],
        suppressionReason: "Active hard cooldown — direct channels suppressed.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "active":
    case "soft":
      return {
        channels: [
          { channel: "phone", status: "caution", reason: "Cooldown active — confirm eligibility first" },
          { channel: "sms", status: "caution", reason: "Cooldown active — confirm eligibility first" },
          { channel: "email", status: "eligible" },
          { channel: "passive_ads", status: "eligible" },
        ],
        suppressionReason: "Soft cooldown — direct outreach requires confirmation.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "ad_only_eligible":
      return {
        channels: [
          { channel: "phone", status: "suppressed", reason: "Direct channels paused" },
          { channel: "sms", status: "suppressed", reason: "Direct channels paused" },
          { channel: "email", status: "suppressed", reason: "Direct channels paused" },
          { channel: "passive_ads", status: "eligible", reason: "Passive ad nurture only" },
        ],
        suppressionReason: "Direct outreach paused — passive ads only.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "recently_contacted":
      return {
        channels: [
          { channel: "phone", status: "caution", reason: "Contacted within the last week" },
          { channel: "sms", status: "caution", reason: "Contacted within the last week" },
          { channel: "email", status: "eligible" },
          { channel: "passive_ads", status: "eligible" },
        ],
        suppressionReason: "Recently contacted — avoid stacking direct touches.",
        reEngagementEligible: true,
        hasActiveCampaign: false,
      };
    case "callback_scheduled":
      return {
        channels: [
          { channel: "phone", status: "eligible", reason: "Callback is scheduled" },
          { channel: "sms", status: "eligible" },
          { channel: "email", status: "eligible" },
          { channel: "passive_ads", status: "eligible" },
        ],
        suppressionReason: null,
        reEngagementEligible: true,
        hasActiveCampaign: false,
      };
    case "manual_review_required":
      return {
        channels: all("caution", "Pending manual review"),
        suppressionReason: "An override is pending review before automation resumes.",
        reEngagementEligible: false,
        hasActiveCampaign: false,
      };
    case "re_eligible":
    case "clear":
    default:
      return {
        channels: all("eligible"),
        suppressionReason: null,
        reEngagementEligible: true,
        hasActiveCampaign: false,
      };
  }
}
