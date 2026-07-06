// Clinician Portal shared types + static config.
//
// All patient/claim/order/note data is now fetched live via
// `usePortalData()` (GET /api/clinician-portal). This module only holds:
//   - Service-line config (colors, price reference, line bucketing)
//   - The TypeScript interfaces describing the live payload shapes
//   - A couple of empty arrays kept as empty-state fallbacks for surfaces
//     the backend does not yet source (linked documents, audit trail).

export type ServiceLine = "BrainWave" | "VitalWave" | "Ultrasound";

export const SERVICE_COLORS: Record<ServiceLine, string> = {
  BrainWave: "#8B5CF6",
  VitalWave: "#E2574F",
  Ultrasound: "#2E9E6A",
};

// Full test name → service-line bucket (color group).
export const SERVICE_LINE_OF: Record<string, ServiceLine> = {
  BrainWave: "BrainWave",
  VitalWave: "VitalWave",
  "Bilateral Carotid Duplex (93880)": "Ultrasound",
  "Echocardiogram TTE (93306)": "Ultrasound",
  "Renal Artery Doppler (93975)": "Ultrasound",
  "Lower Extremity Arterial Doppler (93925)": "Ultrasound",
  "Abdominal Aortic Aneurysm Duplex (93978)": "Ultrasound",
  "Lower Extremity Venous Duplex (93971)": "Ultrasound",
};

export function serviceLineOf(testName: string): ServiceLine {
  return SERVICE_LINE_OF[testName] ?? "Ultrasound";
}

export const TESTS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
] as const;

export const SERVICE_UNIT_PRICE: Record<string, number> = {
  BrainWave: 420,
  VitalWave: 380,
  "Bilateral Carotid Duplex (93880)": 295,
  "Echocardiogram TTE (93306)": 510,
  "Renal Artery Doppler (93975)": 340,
  "Lower Extremity Arterial Doppler (93925)": 310,
  "Abdominal Aortic Aneurysm Duplex (93978)": 285,
  "Lower Extremity Venous Duplex (93971)": 300,
};

// ---- Claims (submitted) -------------------------------------------------
export type ClaimStatus = "Submitted" | "Pending" | "In Review" | "Paid";

export interface Claim {
  id: string;
  patientName: string;
  mrn: string;
  service: string;
  payer: string;
  dos: string; // date of service
  submittedDate: string;
  amount: number;
  status: ClaimStatus;
  provider: string;
  paidAmount: number;
  paidDate: string;
  balanceRemaining: number;
  timeline: { label: string; date: string }[];
}

// ---- Payer mix ----------------------------------------------------------
export interface PayerRow {
  payer: string;
  claims: number;
  billed: number;
  paid: number;
  share: number; // % of paid
}

// ---- Invoices (Plexus split) -------------------------------------------
export interface Invoice {
  id: string;
  period: string;
  studies: number;
  gross: number;
  clinicSplit: number;
  plexusSplit: number;
  status: "Open" | "Sent" | "Paid";
  issuedDate: string;
  lines: { service: string; count: number; amount: number }[];
}

// ---- AR snapshot --------------------------------------------------------
export interface ARBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface ARRow {
  bucket: string;
  patientName: string;
  mrn: string;
  service: string;
  payer: string;
  amount: number;
  dos: string;
}

// ---- Finance rollups ----------------------------------------------------
export interface KpiValue {
  value: number;
  delta: number;
}

export interface FinanceKpis {
  claimsSubmittedMtd: KpiValue;
  claimsPaidMtd: KpiValue;
  ancillaryRevenueMtd: KpiValue;
  pendingSubmittedClaims: KpiValue;
  clinicNet: KpiValue;
  paymentsPosted: KpiValue;
}

export interface MetricRow {
  metric: string;
  value: number;
}

export interface ServiceLineRevenue {
  line: ServiceLine;
  revenue: number;
  studies: number;
}

export interface ProviderFinancial {
  provider: string;
  studies: number;
  billed: number;
  paid: number;
  net: number;
}

// ---- Pipeline (shared by Finance & Engagement) -------------------------
export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  value: number;
}

// ---- Orders -------------------------------------------------------------
export type OrderStatus = "Pending Review" | "Approved" | "Completed Study";

export interface Order {
  id: string;
  patientName: string;
  mrn: string;
  age: number;
  gender: "M" | "F";
  service: string;
  source: "Plexus Qualification" | "Clinician Order" | "Imaging Central";
  status: OrderStatus;
  orderedDate: string;
}

// ---- Notes --------------------------------------------------------------
export type NoteStatus = "Draft" | "Needs Signature" | "Signed";

export interface EncounterNote {
  id: string;
  patientName: string;
  mrn: string;
  age: number;
  gender: "M" | "F";
  service: string;
  orderId?: string;
  encounterDate: string;
  author: string;
  status: NoteStatus;
  vitals: Record<string, string>;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  version: number;
}

// ---- Documents (empty-state fallback — not yet backend-sourced) ---------
export interface LinkedDocument {
  id: string;
  patientName: string;
  type: string;
  service: string;
  status: "Final" | "Signed" | "On File";
  date: string;
  signedBy?: string;
}

export const DOCUMENTS: LinkedDocument[] = [];

// ---- Audit events (seed empty — populated optimistically client-side) ---
export interface AuditEvent {
  id: string;
  recordId: string; // note or order id
  type: string;
  actor: string;
  timestamp: string;
}

export const AUDIT_EVENTS: AuditEvent[] = [];

// ---- Qualifications -----------------------------------------------------
export interface Qualification {
  id: string;
  patientName: string;
  mrn: string;
  services: string[];
  source: "Visit" | "Outreach";
  status: "Completed" | "In Review";
  nextStep: string;
  reason: string;
  completedAt: string;
}

// ---- Call tasks ---------------------------------------------------------
export type CallStatus = "Not Started" | "Attempted" | "Reached" | "Scheduled" | "Do Not Contact";
export type CallOutcome = "No Answer" | "Left Voicemail" | "Reached — Interested" | "Reached — Callback" | "Scheduled" | "Declined" | "—";
export type CallPriority = "High" | "Medium" | "Low";

export interface CallTask {
  id: string;
  patientName: string;
  mrn: string;
  age: number;
  gender: "M" | "F";
  phone: string;
  services: string[];
  priority: CallPriority;
  assignedTo: string;
  status: CallStatus;
  lastOutcome: CallOutcome;
  nextStep: string;
  reason: string;
  lastAppointment: string;
  history: { label: string; outcome: string; date: string }[];
}

// ---- Engagement activity feed ------------------------------------------
export interface EngagementActivity {
  id: string;
  time: string;
  actor: string;
  action: string;
  patientName?: string;
}

// ---- Live schedule ------------------------------------------------------
export interface ScheduleItem {
  id: string;
  time: string;
  patientName: string;
  mrn: string;
  service: string;
  technician: string;
  status: "Scheduled" | "Checked In" | "In Progress" | "Completed";
  source: "Plexus Qualification" | "Clinician Order" | "Imaging Central";
}

// ---- Escalations --------------------------------------------------------
export interface Escalation {
  id: string;
  patientName: string;
  mrn: string;
  reason: string;
  service: string;
  assignedTo: string;
  ageDays: number;
}

// ---- Engagement KPIs ----------------------------------------------------
export interface EngagementKpis {
  activeCallList: number;
  qualificationsToday: number;
  callsCompletedToday: number;
  patientsReached: number;
  scheduledToday: number;
  pendingCallbacks: number;
  escalations: number;
}
