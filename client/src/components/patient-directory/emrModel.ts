// Projects the raw Patient EHR query results into the EMR chart shape
// (client/src/types/emr.ts). No backend changes: every field is read from an
// existing table/endpoint. Categories without a live source (labs, imaging,
// vitals, encounters, ad campaigns) resolve to empty arrays so the chart
// renders clean API-ready empty states.

import {
  type EmrChart, type EmrDiagnosis, type EmrMedication, type EmrCall,
  type EmrCaseStatus, deriveCooldownState, deriveAdAutomation,
  COOLDOWN_STATE_LABELS, type EmrQualifyingTest, type EmrBillingCheckItem,
  type EmrContactability, type EmrOverview, type EmrReports, type CooldownState,
} from "@/types/emr";
import { testBucket, uniqueQualifyingTests, type DirectoryProfile } from "./profileTypes";

export type RawExecutionCase = {
  id?: number;
  selectedServices?: string[] | null;
  engagementBucket?: string | null;
  qualificationStatus?: string | null;
  lifecycleStatus?: string | null;
  engagementStatus?: string | null;
  assignedRole?: string | null;
  priorityScore?: number | null;
  nextActionAt?: string | null;
  callAttemptCount?: number | null;
  lastAttemptAt?: string | null;
  lastCallOutcome?: string | null;
  unableToReachAt?: string | null;
};

export type RawCooldownRecord = {
  serviceType?: string | null;
  priorServiceDate?: string | null;
  cooldownStartDate?: string | null;
  cooldownEndDate?: string | null;
  cooldownStatus?: string | null;
  overrideStatus?: string | null;
  note?: string | null;
};

export type RawInsuranceReview = {
  insuranceName?: string | null;
  insuranceType?: string | null;
  priorityClass?: string | null;
  eligibilityStatus?: string | null;
  approvalStatus?: string | null;
  note?: string | null;
  reviewedAt?: string | null;
};

export type RawAppointment = {
  id?: number;
  testType?: string | null;
  facility?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  status?: string | null;
};

export type RawCall = {
  id?: number | string;
  outcome?: string | null;
  notes?: string | null;
  callbackAt?: string | null;
  attemptNumber?: number | null;
  durationSeconds?: number | null;
  startedAt?: string | null;
  createdAt?: string | null;
};

export type RawDocument = {
  id?: number;
  title?: string | null;
  filename?: string | null;
  kind?: string | null;
  version?: number | null;
  createdAt?: string | null;
  downloadUrl?: string | null;
};

export type RawBillingRow = {
  id?: number;
  service?: string | null;
  facility?: string | null;
  dateOfService?: string | null;
  mrn?: string | null;
  billingStatus?: string | null;
};

export type RawScreeningDetail = {
  reasoning?: Record<string, any> | null;
  adminApprovalStatus?: string | null;
  adminApprovalNote?: string | null;
} | null;

export interface EmrModelInputs {
  profile: DirectoryProfile;
  patientScreeningId: number | null;
  executionCases?: RawExecutionCase[];
  cooldownRecords?: RawCooldownRecord[];
  insuranceReviews?: RawInsuranceReview[];
  appointments?: RawAppointment[];
  calls?: RawCall[];
  documents?: RawDocument[];
  billing?: RawBillingRow[];
  screeningDetail?: RawScreeningDetail;
  provider?: string | null;
  reportBatchId?: number | null;
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildEmrChart(input: EmrModelInputs): EmrChart {
  const { profile } = input;
  const id = profile.identity;
  const executionCaseRows = (input.executionCases ?? []).filter(Boolean);
  const ec = executionCaseRows[0] ?? null;
  const cooldownRecords = input.cooldownRecords ?? [];
  const insuranceReviews = input.insuranceReviews ?? [];
  const appointments = input.appointments ?? [];
  const calls = input.calls ?? [];
  const documents = input.documents ?? [];
  const billing = input.billing ?? [];

  // ── Demographics ──────────────────────────────────────────────────────
  const mrn = billing.find((b) => b.mrn && b.mrn.trim())?.mrn ?? null;
  const demographics = {
    name: id.name,
    mrn,
    dob: id.dob,
    age: id.age,
    gender: id.gender,
    phoneNumber: id.phoneNumber,
    clinic: id.clinic,
    provider: input.provider ?? null,
  };

  // ── Insurance & eligibility ───────────────────────────────────────────
  const insurance = {
    primary: id.insurance,
    plans: insuranceReviews.map((r) => ({
      insuranceName: r.insuranceName,
      insuranceType: r.insuranceType,
      priorityClass: r.priorityClass,
      eligibilityStatus: r.eligibilityStatus,
      approvalStatus: r.approvalStatus,
      note: r.note,
      reviewedAt: r.reviewedAt,
    })),
  };

  // ── Diagnoses / problem list & medications (from clinical free-text) ───
  const diagnoses: EmrDiagnosis[] = splitList(profile.clinical.diagnoses).map((d) => ({
    description: d,
  }));
  const medications: EmrMedication[] = splitList(profile.clinical.medications).map((m) => ({
    name: m,
  }));

  // ── Communication ─────────────────────────────────────────────────────
  const emrCalls: EmrCall[] = calls.map((c) => ({
    id: c.id,
    outcome: c.outcome,
    notes: c.notes,
    callbackAt: c.callbackAt,
    attemptNumber: c.attemptNumber,
    durationSeconds: c.durationSeconds,
    occurredAt: c.startedAt || c.createdAt || c.callbackAt || null,
  }));
  const communication = {
    callAttemptCount: ec?.callAttemptCount ?? (calls.length || null),
    lastCallOutcome: ec?.lastCallOutcome ?? calls[0]?.outcome ?? null,
    lastAttemptAt: ec?.lastAttemptAt ?? calls[0]?.startedAt ?? null,
    nextActionAt: ec?.nextActionAt ?? null,
    calls: emrCalls,
  };

  // ── Scheduling ────────────────────────────────────────────────────────
  const scheduling = appointments.map((a) => ({
    id: a.id,
    testType: a.testType,
    facility: a.facility,
    scheduledDate: a.scheduledDate,
    scheduledTime: a.scheduledTime,
    status: a.status,
  }));

  // ── Cooldown & outreach eligibility ───────────────────────────────────
  const activeCooldownRecord = cooldownRecords.find(
    (c) => (c.cooldownStatus ?? "").toLowerCase() === "active",
  );
  const overridePending = cooldownRecords.some(
    (c) => (c.overrideStatus ?? "").toLowerCase() === "pending",
  );
  const cooldownState = deriveCooldownState({
    lastCallOutcome: communication.lastCallOutcome,
    lastAttemptAt: communication.lastAttemptAt,
    nextActionAt: communication.nextActionAt,
    overridePending,
    hasActiveCooldownRecord: !!activeCooldownRecord || profile.cooldowns.some((c) => !c.cleared),
    cooldownEndDate:
      activeCooldownRecord?.cooldownEndDate ??
      profile.cooldowns.filter((c) => !c.cleared).sort((a, b) => a.daysUntilClear - b.daysUntilClear)[0]?.clearsAt ??
      null,
    hasAnyPriorTest: profile.testHistory.length > 0,
  });

  const cooldown = {
    state: cooldownState,
    stateLabel: COOLDOWN_STATE_LABELS[cooldownState],
    lastCallOutcome: communication.lastCallOutcome,
    lastAttemptAt: communication.lastAttemptAt,
    nextActionAt: communication.nextActionAt,
    records: cooldownRecords.map((c) => ({
      serviceType: c.serviceType,
      priorServiceDate: c.priorServiceDate,
      cooldownStartDate: c.cooldownStartDate,
      cooldownEndDate: c.cooldownEndDate,
      cooldownStatus: c.cooldownStatus,
      overrideStatus: c.overrideStatus,
      note: c.note,
    })),
    testCooldowns: profile.cooldowns.map((c) => ({
      testName: c.testName,
      lastDate: c.lastDate,
      insuranceType: c.insuranceType,
      cooldownMonths: c.cooldownMonths,
      clearsAt: c.clearsAt,
      daysUntilClear: c.daysUntilClear,
      cleared: c.cleared,
    })),
  };

  // ── Ad automation (derived from cooldown state) ───────────────────────
  const adAutomation = deriveAdAutomation(cooldownState);

  // ── Plexus IQ ─────────────────────────────────────────────────────────
  const reasoning = input.screeningDetail?.reasoning ?? null;
  const qualifying = uniqueQualifyingTests(profile.screenings);
  const qualifyingTests: EmrQualifyingTest[] = qualifying.map((t) => {
    const r = reasoning?.[t];
    const obj = r && typeof r === "object" ? r : null;
    return {
      testName: t,
      bucket: testBucket(t),
      clinicianUnderstanding: obj?.clinician_understanding ?? (typeof r === "string" ? r : null),
      patientTalkingPoints: obj?.patient_talking_points ?? null,
      confidence: obj?.confidence ?? null,
    };
  });
  const plexusIq = {
    qualifyingTests,
    supportingDiagnoses: diagnoses.map((d) => d.description!).filter(Boolean),
    adminApprovalStatus: input.screeningDetail?.adminApprovalStatus ?? null,
    adminApprovalNote: input.screeningDetail?.adminApprovalNote ?? null,
  };

  // ── Active execution cases (all rows for this patient) ─────────────────
  const executionCases = executionCaseRows.map((c) => ({
    id: c.id,
    targetTests: c.selectedServices ?? null,
    engagementBucket: c.engagementBucket,
    qualificationStatus: c.qualificationStatus,
    lifecycleStatus: c.lifecycleStatus,
    engagementStatus: c.engagementStatus,
    assignedRole: c.assignedRole,
    priorityScore: c.priorityScore,
    nextActionAt: c.nextActionAt,
    callAttemptCount: c.callAttemptCount,
    lastCallOutcome: c.lastCallOutcome,
  }));

  // ── Billing readiness ─────────────────────────────────────────────────
  const hasInsurance = !!id.insurance;
  const hasDob = !!id.dob;
  const hasDiagnoses = diagnoses.length > 0;
  const hasMrn = !!mrn;
  const eligibilityApproved = insuranceReviews.some(
    (r) => (r.approvalStatus ?? "").toLowerCase() === "approved" ||
      (r.eligibilityStatus ?? "").toLowerCase() === "preferred" ||
      (r.eligibilityStatus ?? "").toLowerCase() === "allowed",
  );
  const billingItems: EmrBillingCheckItem[] = [
    { label: "Patient demographics on file", ready: hasDob, detail: hasDob ? null : "DOB missing" },
    { label: "Insurance captured", ready: hasInsurance, detail: hasInsurance ? id.insurance : "No insurance on file" },
    { label: "Eligibility confirmed", ready: eligibilityApproved, detail: eligibilityApproved ? null : "No approved eligibility review" },
    { label: "Diagnoses documented", ready: hasDiagnoses, detail: hasDiagnoses ? `${diagnoses.length} on problem list` : "No diagnoses recorded" },
    { label: "MRN linked", ready: hasMrn, detail: hasMrn ? mrn : "Not yet linked to a billing record" },
  ];
  const billingReadiness = {
    items: billingItems,
    records: billing.map((b) => ({
      id: b.id,
      service: b.service,
      facility: b.facility,
      dateOfService: b.dateOfService,
      billingStatus: b.billingStatus,
    })),
  };

  // ── Case status (header chip) ─────────────────────────────────────────
  const caseStatus: EmrCaseStatus = deriveCaseStatus(profile, ec);

  // ── Clinician PDF + Plexus PDF report links ───────────────────────────
  // PDFs are produced client-side from the shared schedule view; the portal
  // links into /schedule/:batchId anchors. Available only when this patient
  // belongs to a generated schedule (batchId present).
  const reportBatchId = input.reportBatchId ?? null;
  const reports: EmrReports = {
    clinicianPdf: reportBatchId != null
      ? { available: true, url: `/schedule/${reportBatchId}#clinician-pdf`, detail: "Generated from the schedule" }
      : { available: false, url: null, detail: "Generated once this patient is on a schedule" },
    plexusPdf: reportBatchId != null
      ? { available: true, url: `/schedule/${reportBatchId}#plexus-pdf`, detail: "Generated from the schedule" }
      : { available: false, url: null, detail: "Generated once this patient is on a schedule" },
  };

  // ── Overview (at-a-glance care summary) ───────────────────────────────
  const contactability = deriveContactability(cooldownState);
  const tiedTest =
    ec?.selectedServices?.[0] ?? qualifyingTests[0]?.testName ?? null;
  const tiedReasoning = tiedTest
    ? qualifyingTests.find((t) => t.testName === tiedTest)?.clinicianUnderstanding ?? null
    : null;
  const proof =
    tiedReasoning ??
    (plexusIq.supportingDiagnoses && plexusIq.supportingDiagnoses.length > 0
      ? plexusIq.supportingDiagnoses.slice(0, 3).join(", ")
      : null);
  const whyCall =
    qualifyingTests.length > 0
      ? `Qualifies for ${qualifyingTests.length} ancillary test${qualifyingTests.length === 1 ? "" : "s"}`
      : ec?.engagementStatus || ec?.engagementBucket
        ? `Active outreach: ${ec?.engagementStatus || ec?.engagementBucket}`
        : "No active qualification on file";
  const scheduledAppt = scheduling.find(
    (a) => (a.status ?? "").toLowerCase() === "scheduled",
  );
  const nextAction = communication.nextActionAt
    ? `Follow up ${communication.nextActionAt.slice(0, 10)}${ec?.assignedRole ? ` (${ec.assignedRole})` : ""}`
    : scheduledAppt
      ? `Appointment booked${scheduledAppt.scheduledDate ? ` ${scheduledAppt.scheduledDate}` : ""}`
      : contactability.canContact
        ? tiedTest
          ? `Call to schedule ${tiedTest}`
          : "Call to confirm interest"
        : adAutomation.suppressionReason ?? "No direct outreach action";
  const billingReadyCount = billingItems.filter((b) => b.ready).length;
  const overview: EmrOverview = {
    whyCall,
    contactability,
    tiedTest,
    proof,
    nextAction,
    recentCalls: emrCalls.slice(0, 3),
    billingReadyCount,
    billingTotalCount: billingItems.length,
  };

  return {
    patientScreeningId: input.patientScreeningId,
    demographics,
    insurance,
    providers: [],
    diagnoses,
    medications,
    allergies: [],
    labs: [],
    imaging: [],
    vitals: [],
    encounters: [],
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title || d.filename || (d.id != null ? `Document #${d.id}` : "Document"),
      kind: d.kind,
      version: d.version,
      createdAt: d.createdAt,
      url: d.downloadUrl,
    })),
    communication,
    scheduling,
    cooldown,
    adAutomation,
    billing: billingReadiness,
    plexusIq,
    executionCases,
    caseStatus,
    overview,
    reports,
  };
}

function deriveContactability(state: CooldownState): EmrContactability {
  switch (state) {
    case "do_not_contact":
      return { canContact: false, label: "Do not contact", tone: "red" };
    case "declined":
      return { canContact: false, label: "Declined outreach", tone: "red" };
    case "hard":
      return { canContact: false, label: "Direct outreach blocked (hard cooldown)", tone: "red" };
    case "ad_only_eligible":
      return { canContact: false, label: "Ads only — no direct outreach", tone: "amber" };
    case "manual_review_required":
      return { canContact: false, label: "Pending manual review", tone: "slate" };
    case "callback_scheduled":
      return { canContact: true, label: "Callback scheduled", tone: "blue" };
    case "active":
    case "soft":
    case "recently_contacted":
      return { canContact: true, label: "Contact with caution", tone: "amber" };
    case "re_eligible":
    case "clear":
    default:
      return { canContact: true, label: "OK to contact", tone: "green" };
  }
}

function deriveCaseStatus(profile: DirectoryProfile, ec: RawExecutionCase | null): EmrCaseStatus {
  const scheduled = profile.screenings.some(
    (s) => (s.appointmentStatus || "").toLowerCase() === "scheduled",
  );
  if (scheduled) return { label: "Scheduled", tone: "blue" };

  const lifecycle = (ec?.lifecycleStatus || "").toLowerCase();
  if (lifecycle.includes("complete") || lifecycle.includes("closed")) {
    return { label: "Case closed", tone: "slate" };
  }
  const engagement = (ec?.engagementStatus || ec?.engagementBucket || "").toLowerCase();
  if (engagement) {
    return { label: ec?.engagementStatus || ec?.engagementBucket || "Active case", tone: "amber" };
  }
  const activeCooldowns = profile.cooldowns.filter((c) => !c.cleared).length;
  if (activeCooldowns > 0) return { label: "On cooldown", tone: "amber" };
  return { label: "Eligible", tone: "green" };
}
