// Enterprise demo tile — shared TypeScript domain types.
//
// PR #294 added four enterprise-facing demo surfaces:
//   - Mission Control      (executive monitoring)
//   - Imaging Central      (imaging execution, ultrasound focus)
//   - Clinic Analytics     (clinic due diligence + revenue opportunity)
//   - Clinic Onboarding    (implementation + go-live readiness)
//
// All four are CURRENTLY DEMO-ONLY. Their data is mocked in the sibling
// `<feature>DemoData.ts` files. These types describe the shape the
// production API responses will eventually conform to, so the demo and
// the eventual backend can share a single type contract.
//
// When wiring real APIs:
//   1. Define the route response in `shared/contracts/<feature>.ts`.
//   2. Re-export the response types here (or replace these with
//      `import type { … } from "@shared/contracts/<feature>"`).
//   3. Each page swaps its `*DemoData` import for a TanStack Query hook
//      under `client/src/hooks/api/<feature>.ts`.
//   4. Delete the corresponding `*DemoData.ts` file.

import type { LucideIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────
// Mission Control
// ─────────────────────────────────────────────────────────────────────────

export type LaneStatus =
  | "Watch"
  | "Blocked"
  | "Ready"
  | "In Progress"
  | "Complete";

export type Priority = "Urgent" | "High" | "Medium" | "Low";

export type Severity = "Critical" | "High" | "Medium" | "Low";

export type QueueKey =
  | "prescreen"
  | "ready-to-call"
  | "follow-up"
  | "callbacks"
  | "pending-ancillary"
  | "no-report"
  | "re-eligible"
  | "declined"
  | "billing-ready"
  | "blocked";

export interface MissionControlLaneRow {
  id: string;
  patient: string;
  patientId: string;
  clinic: string;
  service: string;
  ancillary: string;
  lane: QueueKey;
  laneLabel: string;
  status: LaneStatus;
  owner: string;
  team: string;
  lastAction: string;
  nextAction: string;
  blocker: string | null;
  dueDate: string;
  priority: Priority;
  timeline: { time: string; event: string }[];
  documents: string[];
  callResult: string;
  imagingStatus: string;
  billingReadiness: string;
}

export interface MissionControlQueueDef {
  key: QueueKey;
  label: string;
  Icon: LucideIcon;
  trend: number; // signed percent
  tone: string; // tailwind classes for the icon chip
}

export interface MissionControlQueueTile extends MissionControlQueueDef {
  count: number;
}

export interface MissionControlAlert {
  id: string;
  title: string;
  detail: string;
  clinic: string;
  severity: Severity;
  Icon: LucideIcon;
}

export interface MissionControlSectionMetric {
  label: string;
  value: string;
}

export interface MissionControlSectionRow {
  label: string;
  value: string;
  status: LaneStatus;
}

export interface MissionControlSection {
  id: string;
  title: string;
  Icon: LucideIcon;
  metrics: MissionControlSectionMetric[];
  rows: MissionControlSectionRow[];
}

export interface MissionControlKpi {
  label: string;
  value: string;
  Icon: LucideIcon;
  tone: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Imaging Central
// ─────────────────────────────────────────────────────────────────────────

export type ImagingStatus =
  | "Assigned"
  | "In Field"
  | "Uploaded"
  | "Needs Review"
  | "Completed"
  | "No Show"
  | "Reschedule Needed"
  | "Cancelled";

export type CoverageStatus = "Confirmed" | "Pending" | "Gap";

export type YesNo = "Yes" | "No";

export type UltrasoundType =
  | "Carotid Duplex"
  | "Echocardiogram TTE"
  | "Renal Artery Doppler"
  | "LE Arterial Doppler"
  | "AAA Duplex"
  | "LE Venous Duplex";

export interface ImagingTask {
  id: string;
  patientName: string;
  patientMrn: string;
  patientDob: string;
  clinic: string;
  imagingType: "Ultrasound";
  ultrasoundType: UltrasoundType;
  technician: string;
  appointment: string;
  appointmentIso: string;
  coverage: CoverageStatus;
  status: ImagingStatus;
  uploadStatus: "Uploaded" | "Pending" | "Not Started";
  qcStatus: "Passed" | "In Review" | "Not Started" | "Flagged";
  procedureNoteStatus: "Complete" | "Draft" | "Not Started";
  billingReadiness: "Ready" | "Blocked" | "Pending";
  lastUpdated: string;
  nextAction: string;
  notes: string;
  timeline: { time: string; label: string }[];
}

export interface ImagingCoverageRow {
  id: string;
  clinic: string;
  technician: string;
  imagingType: "Ultrasound";
  ultrasoundType: UltrasoundType;
  date: string;
  timeWindow: string;
  coverage: CoverageStatus;
  assignedCount: number;
  completedCount: number;
}

export interface ImagingTechnician {
  id: string;
  name: string;
  assignedClinics: string[];
  shift: string;
  phone: string;
  online: boolean;
  capacityToday: { booked: number; max: number };
  currentAssignment: string;
  completionRate: number;
}

export interface ImagingReadinessRow {
  id: string;
  patientName: string;
  clinic: string;
  study: UltrasoundType;
  imagingType: "Ultrasound";
  reportUploaded: YesNo;
  procedureComplete: YesNo;
  billingReady: YesNo;
  missing: string;
  nextAction: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Clinic Analytics
// ─────────────────────────────────────────────────────────────────────────

export type ClinicAnalyticsRecommendation =
  | "Approve"
  | "Approve with caution"
  | "Needs remediation"
  | "Do not onboard";

export type ClinicAnalyticsRiskLevel = "Low" | "Moderate" | "Elevated" | "High";

export type ClinicAnalyticsTrend = "up" | "down" | "flat";

export type ClinicAnalyticsMedicationCategory =
  | "Antihypertensives"
  | "Antidiabetics"
  | "Neurological"
  | "Pain Management"
  | "Psychiatric"
  | "Cardiovascular";

export type ClinicAnalyticsIcdCategory =
  | "Neurological"
  | "Cardiovascular"
  | "Metabolic"
  | "Mental Health";

export type ClinicAnalyticsCptCategory =
  | "BrainWave"
  | "VitalWave"
  | "Ultrasound"
  | "EKG"
  | "PGX/CGX";

export interface ClinicAnalyticsMedicationRow {
  id: string;
  name: string;
  drugClass: string;
  category: ClinicAnalyticsMedicationCategory;
  monthlyScripts: number;
  trend: ClinicAnalyticsTrend;
  ancillaryRelevance: string;
  revenueSignal: "High" | "Medium" | "Low";
}

export interface ClinicAnalyticsIcdRow {
  id: string;
  code: string;
  description: string;
  category: ClinicAnalyticsIcdCategory;
  frequency: number;
  revenueOpportunity: number;
  qualifyingAncillaries: string[];
  trend: ClinicAnalyticsTrend;
}

export interface ClinicAnalyticsCptRow {
  id: string;
  code: string;
  description: string;
  service: string;
  category: ClinicAnalyticsCptCategory;
  fee: number;
  monthlyFrequency: number;
  payerAcceptance: number;
  relatedAncillary: string;
}

export interface ClinicAnalyticsPayorMix {
  medicare: number;
  ppo: number;
  medicaid: number;
  cash: number;
  commercial: number;
  highValueAncillary: boolean;
  riskNotes: string;
}

export interface ClinicAnalyticsFinancialHealth {
  monthlyRevenue: number;
  ancillaryOpportunity: number;
  arDays: number;
  collectionRate: number;
  denialRate: number;
  billingReadinessScore: number;
  financialRisk: ClinicAnalyticsRiskLevel;
}

export interface ClinicAnalyticsDemographics {
  totalPatients: number;
  averageAge: number;
  medicareEligiblePct: number;
  chronicDiseasePct: number;
  commonDiagnoses: string[];
  highRiskCount: number;
}

export interface ClinicAnalyticsCapacity {
  providers: number;
  examRooms: number;
  dailyVolume: number;
  staffCount: number;
  ancillaryCapacityScore: number;
  supports: { brainWave: boolean; vitalWave: boolean; ultrasound: boolean };
  implementationComplexity: "Low" | "Medium" | "High";
}

export interface ClinicAnalyticsTeamAssessment {
  totalStaff: number;
  officeManager: string;
  medicalAssistants: number;
  billingContact: string;
  turnoverRate: number;
  trainingNeedScore: number;
  operationalMaturityScore: number;
}

export interface ClinicAnalyticsCreditworthiness {
  score: number;
  operationalRisk: ClinicAnalyticsRiskLevel;
  financialRisk: ClinicAnalyticsRiskLevel;
  complianceRisk: ClinicAnalyticsRiskLevel;
  staffingRisk: ClinicAnalyticsRiskLevel;
  recommendation: ClinicAnalyticsRecommendation;
}

export interface ClinicAnalyticsAiSummary {
  strengths: string[];
  concerns: string[];
  revenueOpportunities: string[];
  suggestedAncillaries: string[];
  implementationRisks: string[];
  finalRecommendation: string;
}

export interface ClinicAnalyticsRevenueCalc {
  medicationImpact: number;
  icdImpact: number;
  cptImpact: number;
  totalOpportunity: number;
  plexusSharePct: number;
  clinicSharePct: number;
}

export interface ClinicProfile {
  id: string;
  name: string;
  location: string;
  status: "Active" | "Prospect" | "In Review";
  providers: number;
  examRooms: number;
  dailyVolume: number;
  totalPatients: number;
  emr: string;
  specialty: string;
  mainContact: string;
  phone: string;
  goLiveDate: string;
  activeAncillaryServices: string[];
  opportunityScore: number;
  payorMix: ClinicAnalyticsPayorMix;
  financial: ClinicAnalyticsFinancialHealth;
  demographics: ClinicAnalyticsDemographics;
  capacity: ClinicAnalyticsCapacity;
  team: ClinicAnalyticsTeamAssessment;
  credit: ClinicAnalyticsCreditworthiness;
  ai: ClinicAnalyticsAiSummary;
  revenue: ClinicAnalyticsRevenueCalc;
  medications: ClinicAnalyticsMedicationRow[];
  icdCodes: ClinicAnalyticsIcdRow[];
  cptCodes: ClinicAnalyticsCptRow[];
}

// ─────────────────────────────────────────────────────────────────────────
// Clinic Onboarding
// ─────────────────────────────────────────────────────────────────────────

export type OnboardingStatus = "Not Started" | "In Progress" | "Completed";

export type OnboardingPhase = "Sales" | "Implementation";

export interface OnboardingMaturityScore {
  score: 0 | 1 | 2 | 3;
  label: string;
}

export interface OnboardingChecklistItem {
  id: string;
  sectionId: number;
  label: string;
  status: OnboardingStatus;
  maturity: OnboardingMaturityScore;
  phase: OnboardingPhase;
  owner: string;
  dueDate: string;
  notes: string;
  blocked: boolean;
  lastUpdated: string;
}

export interface OnboardingSection {
  id: number;
  name: string;
  phase: OnboardingPhase;
  items: string[];
}

export interface OnboardingClinic {
  id: string;
  name: string;
  location: string;
  status: string;
  ownerContact: string;
  goLiveTarget: string;
  phase: string;
  maturityScore: number;
  blockers: number;
  seed: number;
}
