// Centralized synthetic data for the Clinician Portal command center.
// All data here is mock/demo only — no backend endpoints are used.
// Cross-tile consistency: the same patients (name + MRN) and service lines
// appear across Finance, Orders & Notes, and Plexus Engagement.

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

export interface MockPatient {
  id: string;
  name: string;
  mrn: string;
  dob: string;
  age: number;
  gender: "M" | "F";
  phone: string;
  payer: string;
  insuranceType: "PPO" | "Medicare" | "HMO";
}

export const PATIENTS: MockPatient[] = [
  { id: "p1", name: "Eleanor Briggs", mrn: "TFP-10421", dob: "1951-03-14", age: 75, gender: "F", phone: "(281) 555-0142", payer: "Medicare", insuranceType: "Medicare" },
  { id: "p2", name: "Marcus Holloway", mrn: "TFP-10422", dob: "1958-11-02", age: 67, gender: "M", phone: "(281) 555-0188", payer: "Aetna PPO", insuranceType: "PPO" },
  { id: "p3", name: "Sofia Ramirez", mrn: "TFP-10423", dob: "1962-06-21", age: 63, gender: "F", phone: "(832) 555-0117", payer: "Blue Cross PPO", insuranceType: "PPO" },
  { id: "p4", name: "James Whitfield", mrn: "TFP-10424", dob: "1949-09-30", age: 76, gender: "M", phone: "(281) 555-0203", payer: "Medicare", insuranceType: "Medicare" },
  { id: "p5", name: "Priya Nair", mrn: "TFP-10425", dob: "1965-01-18", age: 61, gender: "F", phone: "(713) 555-0166", payer: "United HMO", insuranceType: "HMO" },
  { id: "p6", name: "Walter Kim", mrn: "TFP-10426", dob: "1955-04-09", age: 71, gender: "M", phone: "(281) 555-0154", payer: "Cigna PPO", insuranceType: "PPO" },
  { id: "p7", name: "Dolores Aguirre", mrn: "TFP-10427", dob: "1947-12-25", age: 78, gender: "F", phone: "(832) 555-0190", payer: "Medicare", insuranceType: "Medicare" },
  { id: "p8", name: "Theodore Brooks", mrn: "TFP-10428", dob: "1960-07-07", age: 65, gender: "M", phone: "(281) 555-0175", payer: "Humana PPO", insuranceType: "PPO" },
  { id: "p9", name: "Grace Sullivan", mrn: "TFP-10429", dob: "1953-02-28", age: 73, gender: "F", phone: "(713) 555-0133", payer: "Medicare", insuranceType: "Medicare" },
  { id: "p10", name: "Hector Delgado", mrn: "TFP-10430", dob: "1968-10-12", age: 57, gender: "M", phone: "(832) 555-0144", payer: "Aetna PPO", insuranceType: "PPO" },
  { id: "p11", name: "Naomi Foster", mrn: "TFP-10431", dob: "1959-05-19", age: 66, gender: "F", phone: "(281) 555-0211", payer: "Blue Cross PPO", insuranceType: "PPO" },
  { id: "p12", name: "Arthur Penrose", mrn: "TFP-10432", dob: "1944-08-03", age: 81, gender: "M", phone: "(713) 555-0122", payer: "Medicare", insuranceType: "Medicare" },
];

export function patientById(id: string): MockPatient | undefined {
  return PATIENTS.find((p) => p.id === id);
}

const TESTS = [
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
  patientId: string;
  service: string;
  payer: string;
  dos: string; // date of service
  submittedDate: string;
  amount: number;
  status: ClaimStatus;
  provider: string;
  timeline: { label: string; date: string }[];
}

const PROVIDERS = ["Dr. J. Taylor", "Dr. M. Okafor", "Dr. L. Chen"];

export const CLAIMS: Claim[] = [
  { id: "CLM-5001", patientId: "p1", service: "Echocardiogram TTE (93306)", payer: "Medicare", dos: "2026-06-02", submittedDate: "2026-06-04", amount: 510, status: "Paid", provider: "Dr. J. Taylor", timeline: [{ label: "Order placed", date: "2026-06-01" }, { label: "Study completed", date: "2026-06-02" }, { label: "Claim submitted", date: "2026-06-04" }, { label: "Payment posted", date: "2026-06-18" }] },
  { id: "CLM-5002", patientId: "p2", service: "BrainWave", payer: "Aetna PPO", dos: "2026-06-05", submittedDate: "2026-06-07", amount: 420, status: "Paid", provider: "Dr. J. Taylor", timeline: [{ label: "Order placed", date: "2026-06-04" }, { label: "Study completed", date: "2026-06-05" }, { label: "Claim submitted", date: "2026-06-07" }, { label: "Payment posted", date: "2026-06-20" }] },
  { id: "CLM-5003", patientId: "p3", service: "VitalWave", payer: "Blue Cross PPO", dos: "2026-06-08", submittedDate: "2026-06-10", amount: 380, status: "Submitted", provider: "Dr. M. Okafor", timeline: [{ label: "Order placed", date: "2026-06-07" }, { label: "Study completed", date: "2026-06-08" }, { label: "Claim submitted", date: "2026-06-10" }] },
  { id: "CLM-5004", patientId: "p4", service: "Bilateral Carotid Duplex (93880)", payer: "Medicare", dos: "2026-06-09", submittedDate: "2026-06-11", amount: 295, status: "In Review", provider: "Dr. L. Chen", timeline: [{ label: "Order placed", date: "2026-06-08" }, { label: "Study completed", date: "2026-06-09" }, { label: "Claim submitted", date: "2026-06-11" }, { label: "Payer review", date: "2026-06-15" }] },
  { id: "CLM-5005", patientId: "p5", service: "Renal Artery Doppler (93975)", payer: "United HMO", dos: "2026-06-10", submittedDate: "2026-06-12", amount: 340, status: "Submitted", provider: "Dr. M. Okafor", timeline: [{ label: "Order placed", date: "2026-06-09" }, { label: "Study completed", date: "2026-06-10" }, { label: "Claim submitted", date: "2026-06-12" }] },
  { id: "CLM-5006", patientId: "p6", service: "BrainWave", payer: "Cigna PPO", dos: "2026-06-11", submittedDate: "2026-06-13", amount: 420, status: "Pending", provider: "Dr. J. Taylor", timeline: [{ label: "Order placed", date: "2026-06-10" }, { label: "Study completed", date: "2026-06-11" }, { label: "Claim submitted", date: "2026-06-13" }] },
  { id: "CLM-5007", patientId: "p7", service: "Echocardiogram TTE (93306)", payer: "Medicare", dos: "2026-06-12", submittedDate: "2026-06-14", amount: 510, status: "Paid", provider: "Dr. L. Chen", timeline: [{ label: "Order placed", date: "2026-06-11" }, { label: "Study completed", date: "2026-06-12" }, { label: "Claim submitted", date: "2026-06-14" }, { label: "Payment posted", date: "2026-06-22" }] },
  { id: "CLM-5008", patientId: "p8", service: "VitalWave", payer: "Humana PPO", dos: "2026-06-13", submittedDate: "2026-06-15", amount: 380, status: "Submitted", provider: "Dr. J. Taylor", timeline: [{ label: "Order placed", date: "2026-06-12" }, { label: "Study completed", date: "2026-06-13" }, { label: "Claim submitted", date: "2026-06-15" }] },
  { id: "CLM-5009", patientId: "p9", service: "Lower Extremity Arterial Doppler (93925)", payer: "Medicare", dos: "2026-06-14", submittedDate: "2026-06-16", amount: 310, status: "In Review", provider: "Dr. M. Okafor", timeline: [{ label: "Order placed", date: "2026-06-13" }, { label: "Study completed", date: "2026-06-14" }, { label: "Claim submitted", date: "2026-06-16" }, { label: "Payer review", date: "2026-06-19" }] },
  { id: "CLM-5010", patientId: "p10", service: "Abdominal Aortic Aneurysm Duplex (93978)", payer: "Aetna PPO", dos: "2026-06-15", submittedDate: "2026-06-17", amount: 285, status: "Paid", provider: "Dr. L. Chen", timeline: [{ label: "Order placed", date: "2026-06-14" }, { label: "Study completed", date: "2026-06-15" }, { label: "Claim submitted", date: "2026-06-17" }, { label: "Payment posted", date: "2026-06-24" }] },
  { id: "CLM-5011", patientId: "p11", service: "Lower Extremity Venous Duplex (93971)", payer: "Blue Cross PPO", dos: "2026-06-16", submittedDate: "2026-06-18", amount: 300, status: "Submitted", provider: "Dr. J. Taylor", timeline: [{ label: "Order placed", date: "2026-06-15" }, { label: "Study completed", date: "2026-06-16" }, { label: "Claim submitted", date: "2026-06-18" }] },
  { id: "CLM-5012", patientId: "p12", service: "BrainWave", payer: "Medicare", dos: "2026-06-17", submittedDate: "2026-06-19", amount: 420, status: "Pending", provider: "Dr. M. Okafor", timeline: [{ label: "Order placed", date: "2026-06-16" }, { label: "Study completed", date: "2026-06-17" }, { label: "Claim submitted", date: "2026-06-19" }] },
];

export const PAID_CLAIMS = CLAIMS.filter((c) => c.status === "Paid").map((c) => ({
  ...c,
  paidDate: c.timeline.find((t) => t.label === "Payment posted")?.date ?? c.submittedDate,
  paidAmount: Math.round(c.amount * 0.92),
}));

// ---- Payer mix ----------------------------------------------------------
export interface PayerRow {
  payer: string;
  claims: number;
  billed: number;
  paid: number;
  share: number; // % of paid
}

export const PAYER_MIX: PayerRow[] = [
  { payer: "Medicare", claims: 38, billed: 18420, paid: 16950, share: 41 },
  { payer: "Blue Cross PPO", claims: 22, billed: 9850, paid: 8900, share: 22 },
  { payer: "Aetna PPO", claims: 17, billed: 7320, paid: 6740, share: 16 },
  { payer: "Cigna PPO", claims: 12, billed: 5180, paid: 4710, share: 11 },
  { payer: "Humana PPO", claims: 8, billed: 3420, paid: 3110, share: 7 },
  { payer: "United HMO", claims: 4, billed: 1640, paid: 1280, share: 3 },
];

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

export const INVOICES: Invoice[] = [
  { id: "INV-2026-06", period: "Jun 2026 (MTD)", studies: 64, gross: 24180, clinicSplit: 16926, plexusSplit: 7254, status: "Open", issuedDate: "2026-06-24", lines: [{ service: "BrainWave", count: 14, amount: 5880 }, { service: "VitalWave", count: 11, amount: 4180 }, { service: "Ultrasound studies", count: 39, amount: 14120 }] },
  { id: "INV-2026-05", period: "May 2026", studies: 88, gross: 33120, clinicSplit: 23184, plexusSplit: 9936, status: "Paid", issuedDate: "2026-06-01", lines: [{ service: "BrainWave", count: 21, amount: 8820 }, { service: "VitalWave", count: 18, amount: 6840 }, { service: "Ultrasound studies", count: 49, amount: 17460 }] },
  { id: "INV-2026-04", period: "Apr 2026", studies: 76, gross: 28640, clinicSplit: 20048, plexusSplit: 8592, status: "Paid", issuedDate: "2026-05-01", lines: [{ service: "BrainWave", count: 18, amount: 7560 }, { service: "VitalWave", count: 15, amount: 5700 }, { service: "Ultrasound studies", count: 43, amount: 15380 }] },
];

// ---- AR snapshot --------------------------------------------------------
export interface ARBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export const AR_BUCKETS: ARBucket[] = [
  { key: "0-30", label: "0–30 days", amount: 9420, count: 14 },
  { key: "31-60", label: "31–60 days", amount: 5280, count: 8 },
  { key: "61-90", label: "61–90 days", amount: 2640, count: 4 },
  { key: "90+", label: "90+ days", amount: 1180, count: 2 },
];

export interface ARRow {
  bucket: string;
  patientId: string;
  service: string;
  payer: string;
  amount: number;
  dos: string;
}

export const AR_ROWS: ARRow[] = [
  { bucket: "0-30", patientId: "p3", service: "VitalWave", payer: "Blue Cross PPO", amount: 380, dos: "2026-06-08" },
  { bucket: "0-30", patientId: "p5", service: "Renal Artery Doppler (93975)", payer: "United HMO", amount: 340, dos: "2026-06-10" },
  { bucket: "0-30", patientId: "p8", service: "VitalWave", payer: "Humana PPO", amount: 380, dos: "2026-06-13" },
  { bucket: "0-30", patientId: "p11", service: "Lower Extremity Venous Duplex (93971)", payer: "Blue Cross PPO", amount: 300, dos: "2026-06-16" },
  { bucket: "31-60", patientId: "p6", service: "BrainWave", payer: "Cigna PPO", amount: 420, dos: "2026-05-12" },
  { bucket: "31-60", patientId: "p12", service: "BrainWave", payer: "Medicare", amount: 420, dos: "2026-05-09" },
  { bucket: "61-90", patientId: "p4", service: "Bilateral Carotid Duplex (93880)", payer: "Medicare", amount: 295, dos: "2026-04-09" },
  { bucket: "90+", patientId: "p9", service: "Lower Extremity Arterial Doppler (93925)", payer: "Medicare", amount: 310, dos: "2026-03-14" },
];

// ---- Finance rollups ----------------------------------------------------
export const FINANCE_KPIS = {
  claimsSubmittedMtd: { value: 64, delta: 12 },
  claimsPaidMtd: { value: 48, delta: 8 },
  ancillaryRevenueMtd: { value: 24180, delta: 15 },
  pendingSubmittedClaims: { value: 16, delta: -3 },
  clinicNet: { value: 16926, delta: 14 },
  paymentsPosted: { value: 21340, delta: 9 },
};

export const SERVICE_LINE_REVENUE = [
  { line: "BrainWave" as ServiceLine, revenue: 5880, studies: 14 },
  { line: "VitalWave" as ServiceLine, revenue: 4180, studies: 11 },
  { line: "Ultrasound" as ServiceLine, revenue: 14120, studies: 39 },
];

export const REVENUE_SUMMARY = [
  { metric: "Gross Charges (MTD)", value: 24180 },
  { metric: "Expected Reimbursement", value: 21340 },
  { metric: "Payments Posted", value: 21340 },
  { metric: "Outstanding A/R", value: 18520 },
  { metric: "Clinic Net (MTD)", value: 16926 },
];

export const PROVIDER_FINANCIALS = [
  { provider: "Dr. J. Taylor", studies: 26, billed: 10120, paid: 8940, net: 6258 },
  { provider: "Dr. M. Okafor", studies: 21, billed: 7840, paid: 6920, net: 4844 },
  { provider: "Dr. L. Chen", studies: 17, billed: 6220, paid: 5480, net: 3836 },
];

export const PRACTICE_OVERVIEW = [
  { metric: "All-Practice Charges (MTD)", value: 142400 },
  { metric: "All-Practice Payments (MTD)", value: 118900 },
  { metric: "Practice A/R", value: 64200 },
  { metric: "Ancillary Share of Net", value: 16926 },
];

// ---- Pipeline (shared by Finance & Engagement) -------------------------
export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  value: number;
}

export const PIPELINE: PipelineStage[] = [
  { key: "qualified", label: "Qualified", count: 142, value: 52340 },
  { key: "called", label: "Called", count: 118, value: 43480 },
  { key: "scheduled", label: "Scheduled", count: 86, value: 31680 },
  { key: "completed", label: "Completed", count: 64, value: 24180 },
  { key: "claim_submitted", label: "Claim Submitted", count: 58, value: 21900 },
  { key: "claim_paid", label: "Claim Paid", count: 48, value: 18140 },
];

// ---- Orders -------------------------------------------------------------
export type OrderStatus = "Pending Review" | "Approved" | "Completed Study";

export interface Order {
  id: string;
  patientId: string;
  service: string;
  source: "Plexus Qualification" | "Clinician Order" | "Imaging Central";
  status: OrderStatus;
  orderedDate: string;
}

export const ORDERS: Order[] = [
  { id: "ORD-7001", patientId: "p3", service: "VitalWave", source: "Plexus Qualification", status: "Pending Review", orderedDate: "2026-06-22" },
  { id: "ORD-7002", patientId: "p5", service: "Renal Artery Doppler (93975)", source: "Plexus Qualification", status: "Pending Review", orderedDate: "2026-06-23" },
  { id: "ORD-7003", patientId: "p8", service: "VitalWave", source: "Clinician Order", status: "Approved", orderedDate: "2026-06-21" },
  { id: "ORD-7004", patientId: "p11", service: "Lower Extremity Venous Duplex (93971)", source: "Imaging Central", status: "Completed Study", orderedDate: "2026-06-16" },
  { id: "ORD-7005", patientId: "p6", service: "BrainWave", source: "Plexus Qualification", status: "Pending Review", orderedDate: "2026-06-23" },
  { id: "ORD-7006", patientId: "p1", service: "Echocardiogram TTE (93306)", source: "Imaging Central", status: "Completed Study", orderedDate: "2026-06-02" },
];

// ---- Notes --------------------------------------------------------------
export type NoteStatus = "Draft" | "Needs Signature" | "Signed";

export interface EncounterNote {
  id: string;
  patientId: string;
  service: string;
  orderId?: string;
  encounterDate: string;
  author: string;
  status: NoteStatus;
  vitals: { bp: string; hr: string; temp: string; spo2: string; weight: string; height: string };
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  version: number;
}

export const NOTES: EncounterNote[] = [
  {
    id: "NOTE-9001", patientId: "p1", service: "Echocardiogram TTE (93306)", orderId: "ORD-7006", encounterDate: "2026-06-02", author: "Dr. J. Taylor", status: "Needs Signature", version: 1,
    vitals: { bp: "138/82", hr: "76", temp: "98.4", spo2: "97%", weight: "164 lb", height: "5'4\"" },
    soap: { subjective: "75F presents for cardiac ancillary evaluation. Reports occasional exertional dyspnea.", objective: "TTE completed. Preserved LV systolic function, EF 58%. No significant valvular abnormality.", assessment: "Preserved ejection fraction. Findings reviewed.", plan: "Continue current cardiac regimen. Reassess in 6 months." },
  },
  {
    id: "NOTE-9002", patientId: "p7", service: "Echocardiogram TTE (93306)", encounterDate: "2026-06-12", author: "Dr. L. Chen", status: "Needs Signature", version: 1,
    vitals: { bp: "142/88", hr: "81", temp: "98.1", spo2: "96%", weight: "151 lb", height: "5'2\"" },
    soap: { subjective: "78F with history of hypertension presents for cardiac study.", objective: "TTE completed. Mild concentric LVH. EF 55%.", assessment: "Mild LVH, preserved function.", plan: "Continue antihypertensive therapy." },
  },
  {
    id: "NOTE-9003", patientId: "p11", service: "Lower Extremity Venous Duplex (93971)", orderId: "ORD-7004", encounterDate: "2026-06-16", author: "Dr. J. Taylor", status: "Needs Signature", version: 1,
    vitals: { bp: "128/78", hr: "72", temp: "98.6", spo2: "98%", weight: "172 lb", height: "5'6\"" },
    soap: { subjective: "66F reports bilateral leg heaviness and visible varicosities.", objective: "Venous duplex completed. Patent deep venous system, no acute thrombus.", assessment: "Venous insufficiency, no acute thrombus.", plan: "Compression therapy, follow-up as needed." },
  },
  {
    id: "NOTE-9004", patientId: "p2", service: "BrainWave", encounterDate: "2026-06-05", author: "Dr. J. Taylor", status: "Draft", version: 1,
    vitals: { bp: "134/80", hr: "70", temp: "98.5", spo2: "98%", weight: "188 lb", height: "5'10\"" },
    soap: { subjective: "67M for neurological ancillary screening. Reports intermittent memory lapses.", objective: "BrainWave study completed. Awaiting full interpretation.", assessment: "Pending review.", plan: "Finalize interpretation and counsel patient." },
  },
  {
    id: "NOTE-9005", patientId: "p10", service: "Abdominal Aortic Aneurysm Duplex (93978)", encounterDate: "2026-06-15", author: "Dr. L. Chen", status: "Draft", version: 1,
    vitals: { bp: "146/90", hr: "78", temp: "98.2", spo2: "97%", weight: "201 lb", height: "5'11\"" },
    soap: { subjective: "57M, smoking history, presents for aortic screening.", objective: "AAA duplex completed. Aortic diameter within normal limits.", assessment: "No aneurysm identified.", plan: "Routine surveillance per guidelines." },
  },
  {
    id: "NOTE-9006", patientId: "p4", service: "Bilateral Carotid Duplex (93880)", encounterDate: "2026-06-09", author: "Dr. M. Okafor", status: "Signed", version: 2,
    vitals: { bp: "150/92", hr: "74", temp: "98.3", spo2: "96%", weight: "179 lb", height: "5'9\"" },
    soap: { subjective: "76M with carotid bruit on exam.", objective: "Carotid duplex completed. <50% stenosis bilaterally.", assessment: "Mild carotid atherosclerosis.", plan: "Optimize medical management, reassess in 12 months." },
  },
];

// ---- Documents ----------------------------------------------------------
export interface LinkedDocument {
  id: string;
  patientId: string;
  type: string;
  service: string;
  status: "Final" | "Signed" | "On File";
  date: string;
  signedBy?: string;
}

export const DOCUMENTS: LinkedDocument[] = [
  { id: "DOC-1", patientId: "p1", type: "Study Report", service: "Echocardiogram TTE (93306)", status: "Final", date: "2026-06-03", signedBy: "Dr. J. Taylor" },
  { id: "DOC-2", patientId: "p1", type: "Informed Consent", service: "Echocardiogram TTE (93306)", status: "Signed", date: "2026-06-02", signedBy: "Patient" },
  { id: "DOC-3", patientId: "p7", type: "Study Report", service: "Echocardiogram TTE (93306)", status: "Final", date: "2026-06-13", signedBy: "Dr. L. Chen" },
  { id: "DOC-4", patientId: "p11", type: "Study Report", service: "Lower Extremity Venous Duplex (93971)", status: "Final", date: "2026-06-17", signedBy: "Dr. J. Taylor" },
  { id: "DOC-5", patientId: "p11", type: "Screening Form", service: "Lower Extremity Venous Duplex (93971)", status: "On File", date: "2026-06-16" },
  { id: "DOC-6", patientId: "p4", type: "Study Report", service: "Bilateral Carotid Duplex (93880)", status: "Signed", date: "2026-06-10", signedBy: "Dr. M. Okafor" },
];

// ---- Audit events -------------------------------------------------------
export interface AuditEvent {
  id: string;
  recordId: string; // note or order id
  type: string;
  actor: string;
  timestamp: string;
}

export const AUDIT_EVENTS: AuditEvent[] = [
  { id: "AUD-1", recordId: "NOTE-9001", type: "Order received", actor: "Plexus Engine", timestamp: "2026-06-01 09:12" },
  { id: "AUD-2", recordId: "NOTE-9001", type: "Study completed", actor: "Imaging Central", timestamp: "2026-06-02 14:35" },
  { id: "AUD-3", recordId: "NOTE-9001", type: "Report finalized", actor: "Dr. J. Taylor", timestamp: "2026-06-03 11:02" },
  { id: "AUD-4", recordId: "NOTE-9001", type: "Note drafted", actor: "Dr. J. Taylor", timestamp: "2026-06-03 11:20" },
  { id: "AUD-5", recordId: "NOTE-9001", type: "Document linked", actor: "System", timestamp: "2026-06-03 11:21" },
  { id: "AUD-6", recordId: "NOTE-9006", type: "Note signed", actor: "Dr. M. Okafor", timestamp: "2026-06-10 08:44" },
  { id: "AUD-7", recordId: "NOTE-9006", type: "Amendment created", actor: "Dr. M. Okafor", timestamp: "2026-06-11 16:10" },
  { id: "AUD-8", recordId: "NOTE-9006", type: "Note re-signed", actor: "Dr. M. Okafor", timestamp: "2026-06-11 16:15" },
];

export const AUDIT_EVENT_TYPES = [
  "Order received", "Study completed", "Report finalized", "Note drafted",
  "Document linked", "Note signed", "Amendment created", "Note re-signed",
  "Sent back", "Bulk sign", "Version restored", "Access viewed",
];

// ---- Qualifications -----------------------------------------------------
export interface Qualification {
  id: string;
  patientId: string;
  services: string[];
  source: "Visit" | "Outreach";
  status: "Completed" | "In Review";
  nextStep: string;
  reason: string;
  completedAt: string;
}

export const QUALIFICATIONS: Qualification[] = [
  { id: "Q-1", patientId: "p3", services: ["VitalWave", "Renal Artery Doppler (93975)"], source: "Outreach", status: "Completed", nextStep: "Call to schedule", reason: "Hypertension with renal risk factors supports VitalWave and renal arterial evaluation.", completedAt: "2026-06-24 08:30" },
  { id: "Q-2", patientId: "p5", services: ["Renal Artery Doppler (93975)"], source: "Visit", status: "Completed", nextStep: "Call to schedule", reason: "Resistant hypertension warrants renal artery assessment.", completedAt: "2026-06-24 09:05" },
  { id: "Q-3", patientId: "p6", services: ["BrainWave", "Bilateral Carotid Duplex (93880)"], source: "Outreach", status: "Completed", nextStep: "Awaiting callback", reason: "Cognitive complaints with vascular risk support neuro and carotid screening.", completedAt: "2026-06-24 10:18" },
  { id: "Q-4", patientId: "p9", services: ["Lower Extremity Arterial Doppler (93925)"], source: "Visit", status: "In Review", nextStep: "Clinician review", reason: "Claudication symptoms support arterial doppler.", completedAt: "2026-06-24 10:55" },
  { id: "Q-5", patientId: "p12", services: ["BrainWave"], source: "Outreach", status: "Completed", nextStep: "Call to schedule", reason: "Memory concerns support neurological evaluation.", completedAt: "2026-06-24 11:40" },
];

// ---- Call tasks ---------------------------------------------------------
export type CallStatus = "Not Started" | "Attempted" | "Reached" | "Scheduled" | "Do Not Contact";
export type CallOutcome = "No Answer" | "Left Voicemail" | "Reached — Interested" | "Reached — Callback" | "Scheduled" | "Declined" | "—";
export type CallPriority = "High" | "Medium" | "Low";

export interface CallTask {
  id: string;
  patientId: string;
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

const STAFF = ["Maria Lopez", "Devon Carter", "Aisha Bello"];

export const CALL_TASKS: CallTask[] = [
  { id: "CALL-1", patientId: "p3", services: ["VitalWave", "Renal Artery Doppler (93975)"], priority: "High", assignedTo: "Maria Lopez", status: "Attempted", lastOutcome: "Left Voicemail", nextStep: "Retry this afternoon", reason: "Hypertension with renal risk factors.", lastAppointment: "2026-05-14", history: [{ label: "Call attempt", outcome: "No Answer", date: "2026-06-23 14:10" }, { label: "Call attempt", outcome: "Left Voicemail", date: "2026-06-24 09:32" }] },
  { id: "CALL-2", patientId: "p5", services: ["Renal Artery Doppler (93975)"], priority: "Medium", assignedTo: "Devon Carter", status: "Reached", lastOutcome: "Reached — Callback", nextStep: "Callback Thu AM", reason: "Resistant hypertension.", lastAppointment: "2026-05-28", history: [{ label: "Call attempt", outcome: "Reached — Callback", date: "2026-06-24 10:02" }] },
  { id: "CALL-3", patientId: "p6", services: ["BrainWave", "Bilateral Carotid Duplex (93880)"], priority: "High", assignedTo: "Maria Lopez", status: "Not Started", lastOutcome: "—", nextStep: "Initial outreach", reason: "Cognitive complaints with vascular risk.", lastAppointment: "2026-04-30", history: [] },
  { id: "CALL-4", patientId: "p9", services: ["Lower Extremity Arterial Doppler (93925)"], priority: "Medium", assignedTo: "Aisha Bello", status: "Scheduled", lastOutcome: "Scheduled", nextStep: "Confirm day before", reason: "Claudication symptoms.", lastAppointment: "2026-03-14", history: [{ label: "Call attempt", outcome: "Reached — Interested", date: "2026-06-23 11:20" }, { label: "Scheduled", outcome: "Scheduled", date: "2026-06-24 08:15" }] },
  { id: "CALL-5", patientId: "p12", services: ["BrainWave"], priority: "Low", assignedTo: "Devon Carter", status: "Attempted", lastOutcome: "No Answer", nextStep: "Retry tomorrow", reason: "Memory concerns.", lastAppointment: "2026-05-09", history: [{ label: "Call attempt", outcome: "No Answer", date: "2026-06-24 11:45" }] },
  { id: "CALL-6", patientId: "p2", services: ["BrainWave"], priority: "Medium", assignedTo: "Aisha Bello", status: "Reached", lastOutcome: "Reached — Interested", nextStep: "Schedule study", reason: "Intermittent memory lapses.", lastAppointment: "2026-06-05", history: [{ label: "Call attempt", outcome: "Reached — Interested", date: "2026-06-24 13:05" }] },
];

// ---- Engagement activity feed ------------------------------------------
export interface EngagementActivity {
  id: string;
  time: string;
  actor: string;
  action: string;
  patientId?: string;
}

export const ENGAGEMENT_ACTIVITY: EngagementActivity[] = [
  { id: "EA-1", time: "08:15", actor: "Aisha Bello", action: "Scheduled study", patientId: "p9" },
  { id: "EA-2", time: "08:30", actor: "Plexus Engine", action: "Qualification completed", patientId: "p3" },
  { id: "EA-3", time: "09:32", actor: "Maria Lopez", action: "Left voicemail", patientId: "p3" },
  { id: "EA-4", time: "10:02", actor: "Devon Carter", action: "Reached — callback requested", patientId: "p5" },
  { id: "EA-5", time: "10:18", actor: "Plexus Engine", action: "Qualification completed", patientId: "p6" },
  { id: "EA-6", time: "11:45", actor: "Devon Carter", action: "Call attempt — no answer", patientId: "p12" },
  { id: "EA-7", time: "13:05", actor: "Aisha Bello", action: "Reached — interested", patientId: "p2" },
];

// ---- Live schedule ------------------------------------------------------
export interface ScheduleItem {
  id: string;
  time: string;
  patientId: string;
  service: string;
  technician: string;
  status: "Scheduled" | "Checked In" | "In Progress" | "Completed";
  source: "Plexus Qualification" | "Clinician Order" | "Imaging Central";
}

export const SCHEDULE_ITEMS: ScheduleItem[] = [
  { id: "SCH-1", time: "08:30", patientId: "p1", service: "Echocardiogram TTE (93306)", technician: "T. Nguyen", status: "Completed", source: "Imaging Central" },
  { id: "SCH-2", time: "09:15", patientId: "p4", service: "Bilateral Carotid Duplex (93880)", technician: "T. Nguyen", status: "Completed", source: "Plexus Qualification" },
  { id: "SCH-3", time: "10:30", patientId: "p9", service: "Lower Extremity Arterial Doppler (93925)", technician: "R. Patel", status: "In Progress", source: "Plexus Qualification" },
  { id: "SCH-4", time: "11:45", patientId: "p11", service: "Lower Extremity Venous Duplex (93971)", technician: "R. Patel", status: "Checked In", source: "Imaging Central" },
  { id: "SCH-5", time: "13:30", patientId: "p2", service: "BrainWave", technician: "T. Nguyen", status: "Scheduled", source: "Clinician Order" },
  { id: "SCH-6", time: "14:45", patientId: "p3", service: "VitalWave", technician: "R. Patel", status: "Scheduled", source: "Plexus Qualification" },
];

// ---- Escalations --------------------------------------------------------
export interface Escalation {
  id: string;
  patientId: string;
  reason: string;
  service: string;
  assignedTo: string;
  ageDays: number;
}

export const ESCALATIONS: Escalation[] = [
  { id: "ESC-1", patientId: "p12", reason: "Multiple call attempts, no response", service: "BrainWave", assignedTo: "Devon Carter", ageDays: 4 },
  { id: "ESC-2", patientId: "p6", reason: "Awaiting clinician confirmation of qualification", service: "Bilateral Carotid Duplex (93880)", assignedTo: "Maria Lopez", ageDays: 2 },
  { id: "ESC-3", patientId: "p9", reason: "Transportation assistance requested", service: "Lower Extremity Arterial Doppler (93925)", assignedTo: "Aisha Bello", ageDays: 1 },
];

// ---- Engagement KPIs ----------------------------------------------------
export const ENGAGEMENT_KPIS = {
  activeCallList: 6,
  qualificationsToday: 4,
  callsCompletedToday: 7,
  patientsReached: 3,
  scheduledToday: 2,
  pendingCallbacks: 2,
  escalations: 3,
};

export { TESTS, PROVIDERS, STAFF };
