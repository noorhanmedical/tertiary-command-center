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
  type EmrServiceEpisode, type EmrPriorTest, type EmrLab, JOURNEY_STAGES,
} from "@/types/emr";
import { testBucket, uniqueQualifyingTests, type DirectoryProfile } from "./profileTypes";
import type { AncillaryAppointmentProjection } from "@shared/types/canonicalAppointment";

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
  // Canonical communication fields (from /api/patients/:id/communications).
  staffName?: string | null;
  staffRole?: string | null;
  channel?: string | null;
  direction?: string | null;
  nextAction?: string | null;
  serviceType?: string | null;
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
  /** The single screening row's qualifying tests — the SAME set the Atlas
   *  renders. Preferred over the cross-screening union so EHR and Atlas agree. */
  qualifyingTests?: string[] | null;
  /** Canonical contact fields from the screening row (demographics source). */
  email?: string | null;
  gender?: string | null;
  phoneNumber?: string | null;
  age?: number | null;
} | null;

/** Canonical per-service ancillary case (from /api/patients/:id/admin-review). */
export type RawAncillaryCase = {
  ancillaryCaseId: number;
  serviceType: string;
  adminReviewStatus: string;
  qualificationStatus: string;
  lifecycleStatus: string;
  episodeSequence?: number | null;
};
/** Canonical order/procedure note (from /api/procedure-notes). */
export type RawCanonicalNote = {
  serviceType: string;
  noteType: string;
  signatureStatus?: string | null;
  generationStatus?: string | null;
};
/** Canonical prior test episode (from /api/patients/:id/prior-tests). */
export type RawPriorTest = {
  testName?: string | null;
  serviceType?: string | null;
  dateOfService: string;
  resultSummary?: string | null;
  reportAvailable?: boolean | null;
  procedureNoteId?: number | null;
  payer?: string | null;
  insuranceType?: string | null;
};

/** Canonical clinical reference domains from
 *  GET /api/patients/:screeningId/clinical-data. Rows are the raw DB shape
 *  (camelCase); buildEmrChart projects them into the Emr* chart types. */
export type RawClinicalData = {
  providers?: Array<{ name?: string | null; role?: string | null; facility?: string | null }> | null;
  allergies?: Array<{ substance?: string | null; reaction?: string | null; severity?: string | null }> | null;
  labs?: Array<{ panel?: string | null; name?: string | null; value?: string | null; unit?: string | null; referenceRange?: string | null; collectedAt?: string | null; flag?: string | null }> | null;
  imaging?: Array<{ study?: string | null; modality?: string | null; performedAt?: string | null; status?: string | null; impression?: string | null; source?: string | null; reportAvailable?: boolean | null; reportDocumentReferenceId?: number | null; serviceType?: string | null }> | null;
  vitals?: Array<{ label?: string | null; value?: string | null; unit?: string | null; measuredAt?: string | null }> | null;
  encounters?: Array<{ title?: string | null; kind?: string | null; occurredAt?: string | null; provider?: string | null; summary?: string | null; noteBody?: string | null; category?: string | null; tags?: string[] | null }> | null;
  encounterTotal?: number | null;
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
  /** Phase 2D — canonical per-service appointment projection (flag ON). */
  canonicalAppointmentByService?: Record<string, AncillaryAppointmentProjection> | null;
  /** Phase 11 — canonical clinical reference domains (providers/allergies/
   *  labs/imaging/vitals/encounters) from the clinical-data endpoint. */
  clinicalData?: RawClinicalData;
  /** Canonical per-service ancillary cases — the authoritative service state
   *  the Ancillary Journey / Overview / Admin Review all derive from. */
  ancillaryCases?: RawAncillaryCase[];
  /** Canonical order/procedure notes — drive order/procedure signature state. */
  canonicalNotes?: RawCanonicalNote[];
  /** Canonical prior test episodes — drive per-service "Previous Tests". */
  priorTests?: RawPriorTest[];
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Map a stage name to its {stage, stageIndex} pair against JOURNEY_STAGES. */
function stageAt(name: (typeof JOURNEY_STAGES)[number]): { stage: (typeof JOURNEY_STAGES)[number]; stageIndex: number } {
  return { stage: name, stageIndex: JOURNEY_STAGES.indexOf(name) };
}

/**
 * Build the single per-service episode projection consumed by BOTH the
 * Ancillary Journey and the Overview "Current Tests" panel. Base derivation
 * from canonical/available signals (appointment projection, legacy scheduling,
 * admin approval, engagement, cooldown history). The demo patient overrides
 * this with richer per-service episodes; real patients get this coarse-but-
 * consistent derivation. One derivation → Overview and Journey never disagree.
 */
function buildServiceEpisodes(args: {
  qualifyingTests: EmrQualifyingTest[];
  approvalStatus: string | null | undefined;
  engagementActive: boolean;
  scheduling: Array<{ testType?: string | null; scheduledDate?: string | null; scheduledTime?: string | null; facility?: string | null; status?: string | null }>;
  canonicalByService?: Record<string, AncillaryAppointmentProjection> | null;
  testCooldowns: Array<{ testName?: string | null; lastDate?: string | null; insuranceType?: string | null }>;
  nextActionAt?: string | null;
  owner?: string | null;
}): EmrServiceEpisode[] {
  const approved = (args.approvalStatus ?? "").toLowerCase() === "approved";
  return args.qualifyingTests.map((t) => {
    const key = t.testName.toLowerCase().split(" ")[0];
    const canonAppt = args.canonicalByService?.[t.testName]?.activeAppointment ?? null;
    const legacyAppt = args.scheduling.find(
      (a) => (a.testType ?? "").toLowerCase().includes(key),
    );
    const apptStatus = (canonAppt?.status ?? legacyAppt?.status ?? "").toLowerCase();

    let s = stageAt("Qualified");
    if (apptStatus === "completed") s = stageAt("Report");
    else if (apptStatus === "scheduled") s = stageAt("Scheduled");
    else if (approved && args.engagementActive) s = stageAt("Outreach");
    else if (approved) s = stageAt("Approved");

    const priorTests: EmrPriorTest[] = args.testCooldowns
      .filter((c) => (c.testName ?? "").toLowerCase() === t.testName.toLowerCase())
      .map((c) => ({
        dateOfService: c.lastDate ?? "",
        serviceName: t.testName,
        payer: c.insuranceType ?? null,
        resultSummary: null,
        reportAvailable: false,
        procedureNoteAvailable: false,
      }))
      .filter((p) => p.dateOfService)
      .sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));

    const nextAction = apptStatus === "scheduled"
      ? "Complete pre-test screening"
      : approved
        ? "Continue outreach"
        : "Awaiting admin approval";

    return {
      serviceKey: t.testName,
      serviceName: t.testName,
      caseId: null,
      bucket: t.bucket,
      stage: s.stage,
      stageIndex: s.stageIndex,
      nextAction,
      owner: args.owner ?? null,
      appointment: (canonAppt || legacyAppt)
        ? {
            date: (canonAppt?.startsAt ?? legacyAppt?.scheduledDate) ?? null,
            time: legacyAppt?.scheduledTime ?? null,
            facility: (canonAppt?.facilityId ?? legacyAppt?.facility) ?? null,
            status: apptStatus || null,
          }
        : null,
      // Legacy (no canonical ancillary case / no order note): approval alone
      // does NOT mean the order was signed — reflect "Pending" so Billing
      // readiness never reports a signature that doesn't exist.
      orderStatus: approved ? "Pending" : null,
      screeningStatus: apptStatus === "scheduled" ? "Pending" : null,
      reportStatus: apptStatus === "completed" ? "Uploaded" : null,
      procedureNoteStatus: null,
      episodeStartedAt: null,
      priorTests,
      reasoning: t,
    };
  });
}

/**
 * Canonical per-service episode projection. Derives each service's lifecycle
 * STAGE from the authoritative canonical signals — ancillary case
 * (admin_review_status / qualification / lifecycle), order/procedure note
 * signature, and appointment status — NOT from any hand-authored demo data.
 * This is the single projection the Ancillary Journey, Overview, Scheduling,
 * Billing, Re-engagement, Ancillary Cases, and Admin Review all resolve
 * against, so an Admin Review decision propagates to every section on refetch.
 */
function buildCanonicalServiceEpisodes(args: {
  cases: RawAncillaryCase[];
  qualifyingTests: EmrQualifyingTest[];
  notes: RawCanonicalNote[];
  priorTests: RawPriorTest[];
  scheduling: Array<{ testType?: string | null; scheduledDate?: string | null; scheduledTime?: string | null; facility?: string | null; status?: string | null }>;
  canonicalByService?: Record<string, AncillaryAppointmentProjection> | null;
  owner?: string | null;
}): EmrServiceEpisode[] {
  const reasoningByName = new Map(args.qualifyingTests.map((t) => [t.testName.toLowerCase(), t]));
  const bucketFor = (name: string): EmrQualifyingTest["bucket"] =>
    reasoningByName.get(name.toLowerCase())?.bucket ?? testBucket(name);

  return args.cases.map((c) => {
    const svc = c.serviceType;
    const key = svc.toLowerCase().split(" ")[0];
    const svcNotes = args.notes.filter((n) => (n.serviceType ?? "").toLowerCase() === svc.toLowerCase());
    const orderNote = svcNotes.find((n) => n.noteType === "order_note");
    const procNote = svcNotes.find((n) => n.noteType === "post_procedure_note");
    const procedureSigned = (procNote?.signatureStatus ?? "").toLowerCase() === "signed";
    const orderSig = orderNote?.signatureStatus ?? null;

    const canonAppt = args.canonicalByService?.[svc]?.activeAppointment ?? null;
    const legacyAppt = args.scheduling.find((a) => (a.testType ?? "").toLowerCase().includes(key));
    const apptStatus = (canonAppt?.status ?? legacyAppt?.status ?? "").toLowerCase();

    const admin = (c.adminReviewStatus ?? "pending").toLowerCase();
    const lifecycle = (c.lifecycleStatus ?? "new").toLowerCase();

    // ── Stage derivation (highest applicable wins) ──
    let s = stageAt("Qualified");
    let nextAction = "Awaiting admin review";
    if (lifecycle === "closed" || lifecycle === "archived") {
      s = stageAt("Billing"); nextAction = "Submit claim";
    } else if (admin === "rejected") {
      s = stageAt("Qualified"); nextAction = "Admin rejected — not proceeding";
    } else if (admin === "needs_info") {
      s = stageAt("Qualified"); nextAction = "Awaiting additional information";
    } else if (admin === "approved") {
      if (procedureSigned) { s = stageAt("Procedure"); nextAction = "Generate billing"; }
      else if (apptStatus === "completed") { s = stageAt("Report"); nextAction = "Await report / procedure note"; }
      else if (apptStatus === "scheduled") { s = stageAt("Scheduled"); nextAction = "Complete pre-test screening"; }
      else if ((orderSig ?? "").toLowerCase() === "signed") { s = stageAt("Signed"); nextAction = "Schedule appointment"; }
      else if (orderSig) { s = stageAt("Order"); nextAction = "Sign order"; }
      else { s = stageAt("Approved"); nextAction = "Draft order"; }
    } else {
      // pending
      s = stageAt("Qualified"); nextAction = "Awaiting admin review";
    }

    const priorTests: EmrPriorTest[] = args.priorTests
      .filter((p) => ((p.serviceType ?? p.testName) ?? "").toLowerCase() === svc.toLowerCase())
      .map((p) => ({
        dateOfService: p.dateOfService,
        serviceName: svc,
        payer: p.payer ?? p.insuranceType ?? null,
        resultSummary: p.resultSummary ?? null,
        reportAvailable: !!p.reportAvailable,
        procedureNoteAvailable: p.procedureNoteId != null,
      }))
      .filter((p) => p.dateOfService)
      .sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));

    const orderStatusLabel = orderSig
      ? (orderSig === "signed" ? "Signed" : orderSig === "ready_to_sign" ? "Ready to sign" : orderSig === "needs_signature" ? "Needs signature" : orderSig)
      : (admin === "approved" ? "Pending" : null);

    return {
      serviceKey: svc,
      serviceName: svc,
      caseId: c.ancillaryCaseId,
      bucket: bucketFor(svc),
      stage: s.stage,
      stageIndex: s.stageIndex,
      nextAction,
      owner: args.owner ?? null,
      appointment: (canonAppt || legacyAppt)
        ? {
            date: (canonAppt?.startsAt ?? legacyAppt?.scheduledDate) ?? null,
            time: legacyAppt?.scheduledTime ?? null,
            facility: (canonAppt?.facilityId ?? legacyAppt?.facility) ?? null,
            status: apptStatus || null,
          }
        : null,
      orderStatus: orderStatusLabel,
      screeningStatus: apptStatus === "scheduled" ? "Pending" : null,
      reportStatus: apptStatus === "completed" || procedureSigned ? "Final" : null,
      procedureNoteStatus: procedureSigned ? "Signed" : null,
      episodeStartedAt: null,
      priorTests,
      reasoning: reasoningByName.get(svc.toLowerCase()) ?? null,
    };
  });
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
  const sd = input.screeningDetail;
  const demographics = {
    name: id.name,
    mrn,
    dob: id.dob,
    age: id.age ?? sd?.age ?? null,
    gender: id.gender ?? sd?.gender ?? null,
    phoneNumber: id.phoneNumber ?? sd?.phoneNumber ?? null,
    email: sd?.email ?? null,
    address: null,
    clinic: id.clinic,
    provider: input.provider ?? null,
    language: null,
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
    teamMember: c.staffName ?? null,
    role: c.staffRole ?? null,
    channel: c.channel ?? null,
    direction: c.direction ?? null,
    nextAction: c.nextAction ?? null,
    serviceType: c.serviceType ?? null,
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
  // Prefer the SAME single screening row the Atlas renders (screeningDetail),
  // falling back to the cross-screening union only when that row is empty — so
  // the EHR service set and both Atlases agree (no multi-screening divergence).
  const detailTests = input.screeningDetail?.qualifyingTests;
  const qualifying = (detailTests && detailTests.length > 0)
    ? Array.from(new Set(detailTests))
    : uniqueQualifyingTests(profile.screenings);
  const qualifyingTests: EmrQualifyingTest[] = qualifying.map((t) => {
    const r = reasoning?.[t];
    const obj = r && typeof r === "object" ? r : null;
    return {
      testName: t,
      bucket: testBucket(t),
      clinicianUnderstanding: obj?.clinician_understanding ?? (typeof r === "string" ? r : null),
      patientTalkingPoints: obj?.patient_talking_points ?? null,
      confidence: obj?.confidence ?? null,
      qualifyingFactors: Array.isArray(obj?.qualifying_factors) ? obj.qualifying_factors : null,
      icd10Codes: Array.isArray(obj?.icd10_codes) ? obj.icd10_codes : null,
      pearls: Array.isArray(obj?.pearls) ? obj.pearls : null,
      approvalRequired: typeof obj?.approvalRequired === "boolean" ? obj.approvalRequired : null,
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

  // ── Clinician Atlas + Plexus Atlas ────────────────────────────────────────
  // Atlases are generated on demand from the canonical Plexus IQ output
  // (patient_screenings.reasoning + qualifyingTests) and opened per patient by
  // patientScreeningId — NOT from dead /schedule deep-links. The Clinician
  // Atlas is available for every patient with a screening; the Plexus Atlas
  // needs at least one qualifying test (its body is empty otherwise).
  const hasScreening = input.patientScreeningId != null;
  const hasQualifying = qualifyingTests.length > 0;
  const reports: EmrReports = {
    clinicianPdf: {
      available: hasScreening,
      url: null,
      detail: hasScreening ? "Generated from Plexus IQ · click to view" : "Available once Plexus IQ runs",
    },
    plexusPdf: {
      available: hasScreening && hasQualifying,
      url: null,
      detail: hasScreening && hasQualifying ? "Generated from Plexus IQ · click to view" : "Available once services qualify",
    },
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

  // ── Per-service episodes (single source for Journey + Overview + Admin
  //    Review + Scheduling + Billing + Re-engagement + Ancillary Cases). When
  //    canonical ancillary cases exist we derive the authoritative stage from
  //    them (so Admin Review decisions propagate everywhere); otherwise we fall
  //    back to the coarse signal-derived projection for legacy patients.
  const canonicalCases = input.ancillaryCases ?? [];
  const serviceEpisodes = canonicalCases.length > 0
    ? buildCanonicalServiceEpisodes({
        cases: canonicalCases,
        qualifyingTests,
        notes: input.canonicalNotes ?? [],
        priorTests: input.priorTests ?? [],
        scheduling,
        canonicalByService: input.canonicalAppointmentByService ?? null,
        owner: ec?.assignedRole ?? null,
      })
    : buildServiceEpisodes({
        qualifyingTests,
        approvalStatus: plexusIq.adminApprovalStatus,
        engagementActive: !!(ec?.engagementStatus || ec?.engagementBucket),
        scheduling,
        canonicalByService: input.canonicalAppointmentByService ?? null,
        testCooldowns: cooldown.testCooldowns ?? [],
        nextActionAt: communication.nextActionAt,
        owner: ec?.assignedRole ?? null,
      });

  // ── Canonical clinical reference domains ──────────────────────────────
  // Real DB-backed rows from GET /api/patients/:screeningId/clinical-data.
  // Sections with no rows resolve to [] and render clean empty states.
  const cd = input.clinicalData ?? null;
  const clinicalProviders: EmrChart["providers"] = (cd?.providers ?? []).map((p) => ({
    name: p.name ?? null, role: p.role ?? null, facility: p.facility ?? null,
  }));
  const clinicalAllergies: EmrChart["allergies"] = (cd?.allergies ?? []).map((a) => ({
    substance: a.substance ?? null, reaction: a.reaction ?? null, severity: a.severity ?? null,
  }));
  const labFlag = (f: string | null | undefined): EmrLab["flag"] =>
    f === "high" || f === "low" || f === "critical" || f === "normal" ? f : null;
  const clinicalLabs: EmrChart["labs"] = (cd?.labs ?? []).map((l) => ({
    panel: l.panel ?? null, name: l.name ?? null, value: l.value ?? null, unit: l.unit ?? null,
    referenceRange: l.referenceRange ?? null, collectedAt: l.collectedAt ?? null,
    flag: labFlag(l.flag),
  }));
  const clinicalImaging: EmrChart["imaging"] = (cd?.imaging ?? []).map((im) => ({
    study: im.study ?? null, modality: im.modality ?? null, performedAt: im.performedAt ?? null,
    status: im.status ?? null, impression: im.impression ?? null, source: im.source ?? null,
    reportAvailable: im.reportAvailable ?? null,
  }));
  const clinicalVitals: EmrChart["vitals"] = (cd?.vitals ?? []).map((v) => ({
    label: v.label ?? null, value: v.value ?? null, unit: v.unit ?? null, measuredAt: v.measuredAt ?? null,
  }));
  const clinicalEncounters: EmrChart["encounters"] = (cd?.encounters ?? []).map((e) => ({
    title: e.title ?? null, kind: e.kind ?? null, occurredAt: e.occurredAt ?? null,
    provider: e.provider ?? null, summary: e.summary ?? null, noteBody: e.noteBody ?? null,
    category: e.category ?? null, tags: e.tags ?? null,
  }));

  const chart: EmrChart = {
    patientScreeningId: input.patientScreeningId,
    plexusId: profile.plexusId ?? null,
    canonicalAppointmentByService: input.canonicalAppointmentByService ?? null,
    demographics,
    insurance,
    providers: clinicalProviders,
    diagnoses,
    medications,
    allergies: clinicalAllergies,
    labs: clinicalLabs,
    imaging: clinicalImaging,
    vitals: clinicalVitals,
    encounters: clinicalEncounters,
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
    serviceEpisodes,
    executionCases,
    caseStatus,
    overview,
    reports,
  };

  // Every section is projected from canonical DB rows (screening reasoning,
  // clinical-data domains, insurance reviews, ancillary appointments, comms).
  // No patient is ever synthesized client-side — TestGuy travels the same
  // code paths as any patient via seeded canonical data.
  return chart;
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
