// Plexus Bank — frontend-only mock data layer with localStorage
// persistence. No real bank/card/payroll/clearinghouse connections.
// A tiny external store (useSyncExternalStore) shares one state tree
// across every module + the Team Portal Invoice Desk.

import { useSyncExternalStore } from "react";

// ─── Domain types ───────────────────────────────────────────────────────────

export type BankClaim = {
  id: string;
  patient: string;
  dob: string;
  mrn: string;
  service: string;
  cpt: string;
  clinic: string;
  region: string;
  state: string;
  provider: string;
  payer: string;
  dateOfService: string;
  charge: number;
  allowed: number;
  paid: number;
  balance: number;
  status: string; // Not Billed | Ready | Submitted | Accepted | Pending | Denied | Rejected | Paid | On Hold
  readinessScore: "green" | "yellow" | "red";
  readinessReasons: string[];
  flaggedForAudit: boolean;
  sentToAuditor: boolean;
  notes: string[];
};

export type NetworkMatrixRow = {
  id: string;
  payer: string;
  provider: string;
  facility: string;
  npi: string;
  tin: string;
  networkStatus: string;
};

export const NETWORK_STATUS_OPTIONS = [
  "In-Network",
  "Out-of-Network",
  "Pending Credentialing",
  "Credentialing Submitted",
  "Contract Negotiation",
  "Termed",
  "Not Applicable",
] as const;

export type InvoicePayment = { id: string; date: string; amount: number; method: string; status: "succeeded" | "failed" | "refunded" };
export type InvoiceResend = { date: string; by: string; channel: string };
export type InvoiceAdjustment = { id: string; date: string; by: string; kind: "refund" | "adjustment" | "write-off"; amount: number; reason: string };

export type BankInvoice = {
  id: string;
  number: string;
  patient: string;
  patientEmail: string;
  clinic: string;
  region: string;
  service: string;
  amount: number;
  balance: number;
  status: "Draft" | "Sent" | "Paid" | "Unpaid" | "Overdue" | "Void" | "Partially Paid";
  issuedDate: string;
  dueDate: string;
  sentBy: string;
  source: "bank" | "teamPortal";
  paymentLink: string | null;
  resendHistory: InvoiceResend[];
  payments: InvoicePayment[];
  adjustments: InvoiceAdjustment[];
  contactNotes: { date: string; by: string; note: string }[];
  paymentPlan: { totalAmount: number; installments: number; firstDueDate: string; installmentAmount: number } | null;
  batchId: string | null;
};

export type FeeScheduleEntry = {
  id: string;
  service: string;
  cpt: string;
  level: "global" | "region" | "state" | "clinic" | "payer";
  scope: string; // "Global", region name, state, clinic, or payer
  price: number;
  requiresApproval: boolean;
  version: number;
  effectiveDate: string;
  history: { version: number; price: number; changedBy: string; changedAt: string; reason: string }[];
};

export type RvuSetting = { id: string; service: string; cpt: string; rvu: number; effectiveDate: string };

export type PlexFactorRule = {
  minEligibleCount: number;
  multiplier: number;
  eligibleServices: string[];
  activationWindowDays: number;
  payoutTrigger: "same-day" | "claim-paid" | "payroll-cycle";
};

export type RolePayoutRate = { id: string; role: string; ratePerRvu: number };
export type PayoutOverride = { id: string; scopeType: "clinic" | "region"; scope: string; role: string; ratePerRvu: number };

export type ServiceEvent = {
  id: string;
  date: string;
  patient: string;
  clinic: string;
  region: string;
  service: string;
  rvu: number;
  performedBy: string;
  role: string;
  status: "logged" | "verified" | "paid";
};

export type PayoutEntry = {
  id: string;
  employee: string;
  role: string;
  period: string;
  rvuTotal: number;
  baseAmount: number;
  plexFactorBonus: number;
  totalAmount: number;
  status: "pending" | "approved" | "paid";
};

export type BankEmployee = {
  id: string;
  name: string;
  role: string;
  type: "employee" | "contractor";
  clinic: string;
  basePay: number; // per period
};

export type PayrollRun = {
  id: string;
  period: string;
  createdAt: string;
  createdBy: string;
  status: "draft" | "review" | "approved" | "paid";
  lines: { employee: string; basePay: number; rvuPayout: number; plexFactorBonus: number; total: number }[];
  total: number;
  history: { date: string; by: string; action: string }[];
};

export type BankExpense = {
  id: string;
  date: string;
  vendor: string;
  category: string;
  clinic: string;
  amount: number;
  recurring: boolean;
  paymentMethod: string;
  status: "submitted" | "approved" | "paid" | "rejected";
  receiptAttached: boolean;
};

export type BankVendor = {
  id: string;
  name: string;
  category: string;
  contact: string;
  terms: string;
  w9OnFile: boolean;
  status: "active" | "inactive";
};

export type VendorBill = {
  id: string;
  vendorId: string;
  vendor: string;
  invoiceNumber: string;
  clinic: string;
  amount: number;
  issuedDate: string;
  dueDate: string;
  status: "pending-approval" | "approved" | "paid" | "disputed";
};

export type BankAccount = {
  id: string;
  name: string;
  institution: string;
  mask: string;
  type: "checking" | "savings" | "card";
  tokenRef: string;
  connectedAt: string;
  status: "connected" | "reauth-needed";
};

export type BankTransaction = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  reconciled: boolean;
  flaggedSuspicious: boolean;
};

export type AccessLogEntry = { id: string; date: string; actor: string; action: string; target: string };

export type ApprovalRequest = {
  id: string;
  type: string; // invoice | fee-change | vendor-payment | payroll-run | rvu-override | plex-factor-exception | refund | write-off
  requester: string;
  amountImpact: number;
  clinic: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "info-requested";
  notes: { date: string; by: string; note: string }[];
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  actor: string;
  module: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
};

export type PermissionLevel = "none" | "read" | "write";

export type BankState = {
  claims: BankClaim[];
  networkMatrix: NetworkMatrixRow[];
  invoices: BankInvoice[];
  feeSchedules: FeeScheduleEntry[];
  rvuSettings: RvuSetting[];
  plexFactorRule: PlexFactorRule;
  rolePayoutRates: RolePayoutRate[];
  payoutOverrides: PayoutOverride[];
  serviceEvents: ServiceEvent[];
  payoutEntries: PayoutEntry[];
  employees: BankEmployee[];
  payrollRuns: PayrollRun[];
  expenses: BankExpense[];
  vendors: BankVendor[];
  vendorBills: VendorBill[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  accessLog: AccessLogEntry[];
  approvals: ApprovalRequest[];
  auditLog: AuditEvent[];
  permissions: Record<string, Record<string, PermissionLevel>>; // role -> module -> level
};

// ─── Constants ──────────────────────────────────────────────────────────────

export const BANK_CLINICS = ["Plexus Dallas", "Plexus Austin", "Plexus Houston", "Plexus Phoenix"] as const;
export const BANK_REGIONS = ["Texas North", "Texas Central", "Texas Gulf", "Southwest"] as const;
export const CLINIC_REGION: Record<string, string> = {
  "Plexus Dallas": "Texas North",
  "Plexus Austin": "Texas Central",
  "Plexus Houston": "Texas Gulf",
  "Plexus Phoenix": "Southwest",
};
export const CLINIC_STATE: Record<string, string> = {
  "Plexus Dallas": "TX",
  "Plexus Austin": "TX",
  "Plexus Houston": "TX",
  "Plexus Phoenix": "AZ",
};
export const BANK_PAYERS = ["Medicare", "Medicare Advantage", "BCBS PPO", "Aetna PPO", "UHC HMO", "Cigna PPO", "Self Pay"] as const;
export const BANK_PROVIDERS = ["Dr. Nguyen", "Dr. Patel", "Dr. Okafor", "Dr. Ramirez"] as const;

export const BANK_SERVICES: { service: string; cpt: string; rvu: number; price: number }[] = [
  { service: "BrainWave", cpt: "95816", rvu: 9, price: 650 },
  { service: "VitalWave", cpt: "93923", rvu: 6, price: 425 },
  { service: "Bilateral Carotid Duplex", cpt: "93880", rvu: 5, price: 510 },
  { service: "Echocardiogram TTE", cpt: "93306", rvu: 7, price: 780 },
  { service: "Renal Artery Doppler", cpt: "93975", rvu: 5, price: 540 },
  { service: "Lower Extremity Arterial Doppler", cpt: "93925", rvu: 5, price: 495 },
  { service: "Abdominal Aortic Aneurysm Duplex", cpt: "93978", rvu: 4, price: 460 },
  { service: "Lower Extremity Venous Duplex", cpt: "93971", rvu: 4, price: 430 },
];

export const BANK_ROLES = [
  "Owner/Admin",
  "Finance Manager",
  "Billing Staff",
  "Billing Auditor",
  "Team Member",
  "Payroll Manager",
  "Read-only Auditor",
] as const;

export const BANK_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "billing", label: "Billing Center" },
  { id: "auditor", label: "Billing Auditor" },
  { id: "invoicing", label: "Invoicing Center" },
  { id: "invoiceDesk", label: "Team Invoice Desk" },
  { id: "fees", label: "Fee Schedules" },
  { id: "rvu", label: "RVU & Plex Factor" },
  { id: "pnl", label: "P&L / Profitability" },
  { id: "expenses", label: "Expenses" },
  { id: "vendors", label: "Vendors / Vendor Pay" },
  { id: "payroll", label: "Payroll" },
  { id: "banking", label: "Banking / Cards" },
  { id: "reports", label: "Reports" },
  { id: "approvals", label: "Approvals" },
  { id: "audit", label: "Audit Logs" },
  { id: "settings", label: "Settings & Permissions" },
] as const;

export type BankModuleId = (typeof BANK_MODULES)[number]["id"];

export const CLAIM_STATUS_OPTIONS = ["Not Billed", "Ready", "On Hold", "Submitted", "Accepted", "Pending", "Denied", "Rejected", "Paid"] as const;

export const EXPENSE_CATEGORIES = ["Rent", "Supplies", "Equipment", "Software", "Marketing", "Travel", "Insurance", "Utilities", "Contract Labor", "Other"] as const;

export const REPORT_TYPES = [
  "Revenue by Clinic",
  "Revenue by Service",
  "Collections vs Charges",
  "AR Aging Summary",
  "Denial Rate by Payer",
  "Claim Lag Report",
  "Invoice Collection Report",
  "Payment Plan Performance",
  "Fee Schedule Variance",
  "RVU Production by Provider",
  "Plex Factor Payout Summary",
  "Payroll Cost by Clinic",
  "Vendor Spend by Category",
  "Expense Trend by Month",
  "P&L by Region",
  "Profitability by Service Line",
  "Audit Activity Summary",
] as const;

// ─── Seed data ──────────────────────────────────────────────────────────────

function d(offsetDays: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function seedState(): BankState {
  const claims: BankClaim[] = [
    { id: "clm-1001", patient: "Margaret Holloway", dob: "1948-03-12", mrn: "MRN-40213", service: "Echocardiogram TTE", cpt: "93306", clinic: "Plexus Dallas", region: "Texas North", state: "TX", provider: "Dr. Nguyen", payer: "Medicare", dateOfService: d(-24), charge: 780, allowed: 412, paid: 412, balance: 0, status: "Paid", readinessScore: "green", readinessReasons: ["Documentation complete", "Eligibility verified", "In-network"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1002", patient: "Raymond Cutler", dob: "1955-11-02", mrn: "MRN-40987", service: "Bilateral Carotid Duplex", cpt: "93880", clinic: "Plexus Dallas", region: "Texas North", state: "TX", provider: "Dr. Patel", payer: "BCBS PPO", dateOfService: d(-18), charge: 510, allowed: 366, paid: 0, balance: 366, status: "Submitted", readinessScore: "green", readinessReasons: ["Documentation complete", "Eligibility verified"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1003", patient: "Dolores Whitfield", dob: "1942-07-29", mrn: "MRN-41544", service: "BrainWave", cpt: "95816", clinic: "Plexus Austin", region: "Texas Central", state: "TX", provider: "Dr. Okafor", payer: "Medicare Advantage", dateOfService: d(-15), charge: 650, allowed: 0, paid: 0, balance: 650, status: "Denied", readinessScore: "red", readinessReasons: ["Prior auth missing", "Diagnosis code mismatch"], flaggedForAudit: true, sentToAuditor: true, notes: ["Denial reason CO-197: precert absent"] },
    { id: "clm-1004", patient: "Harold Jenkins", dob: "1951-01-17", mrn: "MRN-41720", service: "VitalWave", cpt: "93923", clinic: "Plexus Austin", region: "Texas Central", state: "TX", provider: "Dr. Okafor", payer: "Aetna PPO", dateOfService: d(-12), charge: 425, allowed: 301, paid: 301, balance: 0, status: "Paid", readinessScore: "green", readinessReasons: ["Documentation complete"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1005", patient: "Beverly Nash", dob: "1946-09-05", mrn: "MRN-42101", service: "Renal Artery Doppler", cpt: "93975", clinic: "Plexus Houston", region: "Texas Gulf", state: "TX", provider: "Dr. Ramirez", payer: "UHC HMO", dateOfService: d(-10), charge: 540, allowed: 0, paid: 0, balance: 540, status: "Pending", readinessScore: "yellow", readinessReasons: ["Out-of-network payer", "Awaiting medical records"], flaggedForAudit: false, sentToAuditor: true, notes: [] },
    { id: "clm-1006", patient: "Ernest Boudreaux", dob: "1939-12-21", mrn: "MRN-42388", service: "Abdominal Aortic Aneurysm Duplex", cpt: "93978", clinic: "Plexus Houston", region: "Texas Gulf", state: "TX", provider: "Dr. Ramirez", payer: "Medicare", dateOfService: d(-8), charge: 460, allowed: 244, paid: 0, balance: 244, status: "Accepted", readinessScore: "green", readinessReasons: ["Documentation complete", "Eligibility verified"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1007", patient: "Lucille Prewitt", dob: "1953-04-14", mrn: "MRN-42615", service: "Lower Extremity Venous Duplex", cpt: "93971", clinic: "Plexus Phoenix", region: "Southwest", state: "AZ", provider: "Dr. Nguyen", payer: "Cigna PPO", dateOfService: d(-6), charge: 430, allowed: 0, paid: 0, balance: 430, status: "Not Billed", readinessScore: "yellow", readinessReasons: ["Missing signed report", "Charge entry not reviewed"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1008", patient: "Clifford Osei", dob: "1957-06-30", mrn: "MRN-42990", service: "Lower Extremity Arterial Doppler", cpt: "93925", clinic: "Plexus Phoenix", region: "Southwest", state: "AZ", provider: "Dr. Patel", payer: "Medicare", dateOfService: d(-5), charge: 495, allowed: 262, paid: 0, balance: 262, status: "Submitted", readinessScore: "green", readinessReasons: ["Documentation complete"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
    { id: "clm-1009", patient: "Vivian Castellanos", dob: "1944-10-08", mrn: "MRN-43217", service: "BrainWave", cpt: "95816", clinic: "Plexus Dallas", region: "Texas North", state: "TX", provider: "Dr. Nguyen", payer: "Self Pay", dateOfService: d(-4), charge: 650, allowed: 650, paid: 0, balance: 650, status: "On Hold", readinessScore: "red", readinessReasons: ["Self-pay agreement unsigned", "No card on file"], flaggedForAudit: true, sentToAuditor: false, notes: [] },
    { id: "clm-1010", patient: "Stanley Kowalczyk", dob: "1950-02-25", mrn: "MRN-43456", service: "Echocardiogram TTE", cpt: "93306", clinic: "Plexus Austin", region: "Texas Central", state: "TX", provider: "Dr. Okafor", payer: "BCBS PPO", dateOfService: d(-2), charge: 780, allowed: 0, paid: 0, balance: 780, status: "Ready", readinessScore: "green", readinessReasons: ["Documentation complete", "Eligibility verified", "In-network"], flaggedForAudit: false, sentToAuditor: false, notes: [] },
  ];

  const networkMatrix: NetworkMatrixRow[] = [];
  let nm = 0;
  for (const payer of ["Medicare", "BCBS PPO", "Aetna PPO", "UHC HMO", "Cigna PPO"]) {
    for (const provider of BANK_PROVIDERS.slice(0, 3)) {
      for (const facility of BANK_CLINICS.slice(0, 2)) {
        nm++;
        networkMatrix.push({
          id: `nm-${nm}`,
          payer,
          provider,
          facility,
          npi: `1${String(700000000 + nm * 137).slice(0, 9)}`,
          tin: `75-${String(1000000 + nm * 31).slice(0, 7)}`,
          networkStatus:
            payer === "UHC HMO" ? "Out-of-Network" : nm % 7 === 0 ? "Pending Credentialing" : nm % 11 === 0 ? "Contract Negotiation" : "In-Network",
        });
      }
    }
  }

  const invoices: BankInvoice[] = [
    { id: "inv-2001", number: "PB-1041", patient: "Margaret Holloway", patientEmail: "m.holloway@example.com", clinic: "Plexus Dallas", region: "Texas North", service: "Echocardiogram TTE", amount: 118, balance: 0, status: "Paid", issuedDate: d(-20), dueDate: d(-6), sentBy: "Alicia Grant", source: "bank", paymentLink: "https://pay.plexus.example/PB-1041", resendHistory: [], payments: [{ id: "pay-1", date: d(-9), amount: 118, method: "card", status: "succeeded" }], adjustments: [], contactNotes: [], paymentPlan: null, batchId: "batch-A" },
    { id: "inv-2002", number: "PB-1042", patient: "Raymond Cutler", patientEmail: "rcutler@example.com", clinic: "Plexus Dallas", region: "Texas North", service: "Bilateral Carotid Duplex", amount: 144, balance: 144, status: "Overdue", issuedDate: d(-35), dueDate: d(-5), sentBy: "Alicia Grant", source: "bank", paymentLink: "https://pay.plexus.example/PB-1042", resendHistory: [{ date: d(-10), by: "Alicia Grant", channel: "email" }], payments: [{ id: "pay-2", date: d(-12), amount: 144, method: "card", status: "failed" }], adjustments: [], contactNotes: [{ date: d(-10), by: "Alicia Grant", note: "Left voicemail about overdue balance." }], paymentPlan: null, batchId: "batch-A" },
    { id: "inv-2003", number: "PB-1043", patient: "Dolores Whitfield", patientEmail: "dwhit@example.com", clinic: "Plexus Austin", region: "Texas Central", service: "BrainWave", amount: 210, balance: 210, status: "Unpaid", issuedDate: d(-9), dueDate: d(12), sentBy: "Marcus Webb", source: "teamPortal", paymentLink: "https://pay.plexus.example/PB-1043", resendHistory: [{ date: d(-3), by: "Marcus Webb", channel: "sms" }], payments: [], adjustments: [], contactNotes: [], paymentPlan: { totalAmount: 210, installments: 3, firstDueDate: d(12), installmentAmount: 70 }, batchId: null },
    { id: "inv-2004", number: "PB-1044", patient: "Harold Jenkins", patientEmail: "hjenkins@example.com", clinic: "Plexus Austin", region: "Texas Central", service: "VitalWave", amount: 62, balance: 0, status: "Paid", issuedDate: d(-8), dueDate: d(6), sentBy: "Marcus Webb", source: "teamPortal", paymentLink: "https://pay.plexus.example/PB-1044", resendHistory: [], payments: [{ id: "pay-3", date: d(-4), amount: 62, method: "ach", status: "succeeded" }], adjustments: [], contactNotes: [], paymentPlan: null, batchId: null },
    { id: "inv-2005", number: "PB-1045", patient: "Beverly Nash", patientEmail: "bnash@example.com", clinic: "Plexus Houston", region: "Texas Gulf", service: "Renal Artery Doppler", amount: 185, balance: 185, status: "Sent", issuedDate: d(-3), dueDate: d(18), sentBy: "Alicia Grant", source: "bank", paymentLink: "https://pay.plexus.example/PB-1045", resendHistory: [], payments: [], adjustments: [], contactNotes: [], paymentPlan: null, batchId: "batch-B" },
    { id: "inv-2006", number: "PB-1046", patient: "Vivian Castellanos", patientEmail: "vcast@example.com", clinic: "Plexus Dallas", region: "Texas North", service: "BrainWave", amount: 650, balance: 520, status: "Partially Paid", issuedDate: d(-14), dueDate: d(1), sentBy: "Marcus Webb", source: "teamPortal", paymentLink: "https://pay.plexus.example/PB-1046", resendHistory: [{ date: d(-6), by: "Marcus Webb", channel: "email" }, { date: d(-2), by: "Marcus Webb", channel: "email" }], payments: [{ id: "pay-4", date: d(-7), amount: 130, method: "card", status: "succeeded" }, { id: "pay-5", date: d(-1), amount: 130, method: "card", status: "failed" }], adjustments: [], contactNotes: [{ date: d(-2), by: "Marcus Webb", note: "Patient asked for a payment plan." }], paymentPlan: null, batchId: null },
    { id: "inv-2007", number: "PB-1047", patient: "Ernest Boudreaux", patientEmail: "ebx@example.com", clinic: "Plexus Houston", region: "Texas Gulf", service: "Abdominal Aortic Aneurysm Duplex", amount: 48, balance: 48, status: "Draft", issuedDate: d(0), dueDate: d(30), sentBy: "Alicia Grant", source: "bank", paymentLink: null, resendHistory: [], payments: [], adjustments: [], contactNotes: [], paymentPlan: null, batchId: "batch-B" },
  ];

  const feeSchedules: FeeScheduleEntry[] = BANK_SERVICES.map((s, i) => ({
    id: `fee-g-${i}`,
    service: s.service,
    cpt: s.cpt,
    level: "global" as const,
    scope: "Global",
    price: s.price,
    requiresApproval: true,
    version: 2,
    effectiveDate: d(-90),
    history: [
      { version: 1, price: Math.round(s.price * 0.92), changedBy: "System Seed", changedAt: d(-320), reason: "Initial schedule" },
      { version: 2, price: s.price, changedBy: "Finance Manager", changedAt: d(-90), reason: "Annual adjustment" },
    ],
  }));
  feeSchedules.push(
    { id: "fee-r-1", service: "BrainWave", cpt: "95816", level: "region", scope: "Southwest", price: 615, requiresApproval: true, version: 1, effectiveDate: d(-60), history: [{ version: 1, price: 615, changedBy: "Finance Manager", changedAt: d(-60), reason: "Regional payer mix" }] },
    { id: "fee-c-1", service: "Echocardiogram TTE", cpt: "93306", level: "clinic", scope: "Plexus Austin", price: 745, requiresApproval: true, version: 1, effectiveDate: d(-45), history: [{ version: 1, price: 745, changedBy: "Finance Manager", changedAt: d(-45), reason: "Clinic-negotiated rate" }] },
    { id: "fee-p-1", service: "VitalWave", cpt: "93923", level: "payer", scope: "Medicare", price: 301, requiresApproval: true, version: 1, effectiveDate: d(-30), history: [{ version: 1, price: 301, changedBy: "Billing Auditor", changedAt: d(-30), reason: "Medicare allowable" }] },
  );

  const serviceEvents: ServiceEvent[] = [
    { id: "se-1", date: d(-3), patient: "Margaret Holloway", clinic: "Plexus Dallas", region: "Texas North", service: "BrainWave", rvu: 9, performedBy: "Tina Alvarez", role: "Technician", status: "verified" },
    { id: "se-2", date: d(-3), patient: "Margaret Holloway", clinic: "Plexus Dallas", region: "Texas North", service: "VitalWave", rvu: 6, performedBy: "Tina Alvarez", role: "Technician", status: "verified" },
    { id: "se-3", date: d(-2), patient: "Raymond Cutler", clinic: "Plexus Dallas", region: "Texas North", service: "Bilateral Carotid Duplex", rvu: 5, performedBy: "Owen Brooks", role: "Sonographer", status: "logged" },
    { id: "se-4", date: d(-2), patient: "Dolores Whitfield", clinic: "Plexus Austin", region: "Texas Central", service: "Echocardiogram TTE", rvu: 7, performedBy: "Priya Raman", role: "Sonographer", status: "verified" },
    { id: "se-5", date: d(-1), patient: "Harold Jenkins", clinic: "Plexus Austin", region: "Texas Central", service: "BrainWave", rvu: 9, performedBy: "Priya Raman", role: "Sonographer", status: "logged" },
    { id: "se-6", date: d(-1), patient: "Harold Jenkins", clinic: "Plexus Austin", region: "Texas Central", service: "VitalWave", rvu: 6, performedBy: "Priya Raman", role: "Sonographer", status: "logged" },
    { id: "se-7", date: d(0), patient: "Beverly Nash", clinic: "Plexus Houston", region: "Texas Gulf", service: "Renal Artery Doppler", rvu: 5, performedBy: "Owen Brooks", role: "Sonographer", status: "logged" },
  ];

  const employees: BankEmployee[] = [
    { id: "emp-1", name: "Tina Alvarez", role: "Technician", type: "employee", clinic: "Plexus Dallas", basePay: 2400 },
    { id: "emp-2", name: "Owen Brooks", role: "Sonographer", type: "contractor", clinic: "Plexus Houston", basePay: 0 },
    { id: "emp-3", name: "Priya Raman", role: "Sonographer", type: "employee", clinic: "Plexus Austin", basePay: 2900 },
    { id: "emp-4", name: "Alicia Grant", role: "Billing Staff", type: "employee", clinic: "Plexus Dallas", basePay: 2100 },
    { id: "emp-5", name: "Marcus Webb", role: "Team Member", type: "employee", clinic: "Plexus Austin", basePay: 1950 },
    { id: "emp-6", name: "Dr. Nguyen", role: "Provider", type: "contractor", clinic: "Plexus Dallas", basePay: 0 },
  ];

  const payoutEntries: PayoutEntry[] = [
    { id: "po-1", employee: "Tina Alvarez", role: "Technician", period: "Prior period", rvuTotal: 15, baseAmount: 22.5, plexFactorBonus: 22.5, totalAmount: 45, status: "paid" },
    { id: "po-2", employee: "Priya Raman", role: "Sonographer", period: "Current period", rvuTotal: 22, baseAmount: 44, plexFactorBonus: 30, totalAmount: 74, status: "pending" },
    { id: "po-3", employee: "Owen Brooks", role: "Sonographer", period: "Current period", rvuTotal: 10, baseAmount: 20, plexFactorBonus: 0, totalAmount: 20, status: "approved" },
  ];

  const payrollRuns: PayrollRun[] = [
    {
      id: "pr-1",
      period: "Prior semi-monthly period",
      createdAt: d(-16),
      createdBy: "Payroll Manager",
      status: "paid",
      lines: [
        { employee: "Tina Alvarez", basePay: 2400, rvuPayout: 22.5, plexFactorBonus: 22.5, total: 2445 },
        { employee: "Priya Raman", basePay: 2900, rvuPayout: 38, plexFactorBonus: 0, total: 2938 },
        { employee: "Alicia Grant", basePay: 2100, rvuPayout: 0, plexFactorBonus: 0, total: 2100 },
      ],
      total: 7483,
      history: [
        { date: d(-16), by: "Payroll Manager", action: "Run created" },
        { date: d(-15), by: "Owner/Admin", action: "Approved" },
        { date: d(-14), by: "Payroll Manager", action: "Marked paid" },
      ],
    },
  ];

  const expenses: BankExpense[] = [
    { id: "exp-1", date: d(-20), vendor: "Lonestar Properties", category: "Rent", clinic: "Plexus Dallas", amount: 4800, recurring: true, paymentMethod: "ACH", status: "paid", receiptAttached: true },
    { id: "exp-2", date: d(-14), vendor: "MedSupply Co", category: "Supplies", clinic: "Plexus Austin", amount: 642.18, recurring: false, paymentMethod: "Card •• token", status: "approved", receiptAttached: true },
    { id: "exp-3", date: d(-7), vendor: "SonoTech Services", category: "Equipment", clinic: "Plexus Houston", amount: 1250, recurring: false, paymentMethod: "ACH", status: "submitted", receiptAttached: false },
    { id: "exp-4", date: d(-5), vendor: "CloudEHR Inc", category: "Software", clinic: "Plexus Dallas", amount: 899, recurring: true, paymentMethod: "Card •• token", status: "approved", receiptAttached: true },
    { id: "exp-5", date: d(-2), vendor: "Desert Print & Media", category: "Marketing", clinic: "Plexus Phoenix", amount: 310.5, recurring: false, paymentMethod: "Card •• token", status: "submitted", receiptAttached: false },
  ];

  const vendors: BankVendor[] = [
    { id: "ven-1", name: "Lonestar Properties", category: "Facilities", contact: "leasing@lonestar.example", terms: "Net 1", w9OnFile: true, status: "active" },
    { id: "ven-2", name: "MedSupply Co", category: "Medical Supplies", contact: "orders@medsupply.example", terms: "Net 30", w9OnFile: true, status: "active" },
    { id: "ven-3", name: "SonoTech Services", category: "Equipment Service", contact: "support@sonotech.example", terms: "Net 15", w9OnFile: false, status: "active" },
    { id: "ven-4", name: "CloudEHR Inc", category: "Software", contact: "billing@cloudehr.example", terms: "Net 30", w9OnFile: true, status: "active" },
    { id: "ven-5", name: "Desert Print & Media", category: "Marketing", contact: "hello@desertprint.example", terms: "Net 15", w9OnFile: false, status: "inactive" },
  ];

  const vendorBills: VendorBill[] = [
    { id: "vb-1", vendorId: "ven-2", vendor: "MedSupply Co", invoiceNumber: "MS-88121", clinic: "Plexus Austin", amount: 642.18, issuedDate: d(-14), dueDate: d(16), status: "approved" },
    { id: "vb-2", vendorId: "ven-3", vendor: "SonoTech Services", invoiceNumber: "ST-2204", clinic: "Plexus Houston", amount: 1250, issuedDate: d(-7), dueDate: d(8), status: "pending-approval" },
    { id: "vb-3", vendorId: "ven-4", vendor: "CloudEHR Inc", invoiceNumber: "CE-99310", clinic: "Plexus Dallas", amount: 899, issuedDate: d(-35), dueDate: d(-5), status: "pending-approval" },
    { id: "vb-4", vendorId: "ven-1", vendor: "Lonestar Properties", invoiceNumber: "LP-JUL", clinic: "Plexus Dallas", amount: 4800, issuedDate: d(-20), dueDate: d(-18), status: "paid" },
  ];

  const bankAccounts: BankAccount[] = [
    { id: "acct-1", name: "Operating Checking", institution: "First Meridian Bank", mask: "••4821", type: "checking", tokenRef: "tok_conn_9f31…", connectedAt: d(-120), status: "connected" },
    { id: "acct-2", name: "Payroll Checking", institution: "First Meridian Bank", mask: "••7710", type: "checking", tokenRef: "tok_conn_a077…", connectedAt: d(-120), status: "connected" },
    { id: "acct-3", name: "Corporate Card", institution: "Summit Card Services", mask: "••3402", type: "card", tokenRef: "tok_conn_c5d2…", connectedAt: d(-64), status: "reauth-needed" },
  ];

  const bankTransactions: BankTransaction[] = [
    { id: "tx-1", accountId: "acct-1", date: d(-6), description: "ERA DEPOSIT MEDICARE", amount: 3120.44, category: "Insurance Collections", reconciled: true, flaggedSuspicious: false },
    { id: "tx-2", accountId: "acct-1", date: d(-5), description: "PATIENT PAYMENTS BATCH", amount: 412.0, category: "Patient Collections", reconciled: false, flaggedSuspicious: false },
    { id: "tx-3", accountId: "acct-3", date: d(-4), description: "MEDSUPPLY CO", amount: -642.18, category: null, reconciled: false, flaggedSuspicious: false },
    { id: "tx-4", accountId: "acct-1", date: d(-3), description: "ACH LONESTAR PROPERTIES", amount: -4800, category: "Rent", reconciled: true, flaggedSuspicious: false },
    { id: "tx-5", accountId: "acct-3", date: d(-1), description: "UNKNOWN POS 8841", amount: -89.99, category: null, reconciled: false, flaggedSuspicious: true },
  ];

  const accessLog: AccessLogEntry[] = [
    { id: "al-1", date: d(-4), actor: "Owner/Admin", action: "Viewed connected accounts", target: "Banking" },
    { id: "al-2", date: d(-2), actor: "Finance Manager", action: "Imported transactions (placeholder)", target: "Operating Checking" },
  ];

  const approvals: ApprovalRequest[] = [
    { id: "apr-1", type: "fee-change", requester: "Billing Staff", amountImpact: 35, clinic: "Plexus Austin", reason: "Raise Echo TTE clinic rate to $780 to match global", status: "pending", notes: [], createdAt: d(-3) },
    { id: "apr-2", type: "refund", requester: "Marcus Webb", amountImpact: -130, clinic: "Plexus Dallas", reason: "Duplicate card charge on PB-1046", status: "pending", notes: [], createdAt: d(-1) },
    { id: "apr-3", type: "vendor-payment", requester: "Finance Manager", amountImpact: -1250, clinic: "Plexus Houston", reason: "SonoTech probe repair ST-2204", status: "pending", notes: [], createdAt: d(-2) },
    { id: "apr-4", type: "payroll-run", requester: "Payroll Manager", amountImpact: -7620, clinic: "All", reason: "Current semi-monthly payroll run", status: "info-requested", notes: [{ date: d(-1), by: "Owner/Admin", note: "Confirm contractor hours for Owen Brooks." }], createdAt: d(-2) },
    { id: "apr-5", type: "write-off", requester: "Alicia Grant", amountImpact: -144, clinic: "Plexus Dallas", reason: "PB-1042 uncollectible after 3 attempts", status: "rejected", notes: [{ date: d(-1), by: "Finance Manager", note: "Send to payment plan first." }], createdAt: d(-4) },
  ];

  const auditLog: AuditEvent[] = [
    { id: "ae-1", timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), actor: "System Seed", module: "System", action: "Workspace initialized with sample data", oldValue: null, newValue: null, reason: "First boot" },
    { id: "ae-2", timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), actor: "Finance Manager", module: "Fee Schedules", action: "Updated Medicare VitalWave payer rate", oldValue: "$318.00", newValue: "$301.00", reason: "Medicare allowable" },
    { id: "ae-3", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), actor: "Alicia Grant", module: "Invoicing Center", action: "Resent invoice PB-1042", oldValue: null, newValue: "email", reason: "Overdue follow-up" },
  ];

  const permissions: Record<string, Record<string, PermissionLevel>> = {};
  for (const role of BANK_ROLES) {
    permissions[role] = {};
    for (const m of BANK_MODULES) {
      if (role === "Owner/Admin") permissions[role][m.id] = "write";
      else if (role === "Finance Manager") permissions[role][m.id] = m.id === "settings" ? "read" : "write";
      else if (role === "Billing Staff") permissions[role][m.id] = ["billing", "invoicing", "dashboard"].includes(m.id) ? "write" : ["auditor", "fees", "reports"].includes(m.id) ? "read" : "none";
      else if (role === "Billing Auditor") permissions[role][m.id] = ["auditor", "audit"].includes(m.id) ? "write" : ["billing", "invoicing", "fees", "reports", "dashboard"].includes(m.id) ? "read" : "none";
      else if (role === "Team Member") permissions[role][m.id] = m.id === "invoiceDesk" ? "write" : "none";
      else if (role === "Payroll Manager") permissions[role][m.id] = ["payroll", "rvu"].includes(m.id) ? "write" : ["dashboard", "reports", "approvals"].includes(m.id) ? "read" : "none";
      else permissions[role][m.id] = ["banking", "settings"].includes(m.id) ? "none" : "read"; // Read-only Auditor
    }
  }

  return {
    claims,
    networkMatrix,
    invoices,
    feeSchedules,
    rvuSettings: BANK_SERVICES.map((s, i) => ({ id: `rvu-${i}`, service: s.service, cpt: s.cpt, rvu: s.rvu, effectiveDate: d(-90) })),
    plexFactorRule: { minEligibleCount: 2, multiplier: 2, eligibleServices: ["BrainWave", "VitalWave"], activationWindowDays: 1, payoutTrigger: "payroll-cycle" },
    rolePayoutRates: [
      { id: "rpr-1", role: "Technician", ratePerRvu: 1.5 },
      { id: "rpr-2", role: "Sonographer", ratePerRvu: 2.0 },
      { id: "rpr-3", role: "Provider", ratePerRvu: 12.0 },
    ],
    payoutOverrides: [{ id: "ovr-1", scopeType: "clinic", scope: "Plexus Phoenix", role: "Sonographer", ratePerRvu: 2.25 }],
    serviceEvents,
    payoutEntries,
    employees,
    payrollRuns,
    expenses,
    vendors,
    vendorBills,
    bankAccounts,
    bankTransactions,
    accessLog,
    approvals,
    auditLog,
    permissions,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "plexusBank.v1";

let state: BankState | null = null;
const listeners = new Set<() => void>();

function load(): BankState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw) as BankState;
      return state;
    }
  } catch {
    /* corrupted storage — reseed */
  }
  state = seedState();
  persist();
  return state;
}

function persist() {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — keep in-memory */
  }
}

function notify() {
  for (const l of Array.from(listeners)) l();
}

export function getBankState(): BankState {
  return load();
}

/** Apply a mutation to bank state, persist to localStorage, and notify subscribers. */
export function updateBank(mutator: (draft: BankState) => void) {
  const s = load();
  // shallow-clone the root so useSyncExternalStore sees a new reference
  const next: BankState = { ...s };
  state = next;
  mutator(next);
  persist();
  notify();
}

let idCounter = 0;
export function bankId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}${idCounter}`;
}

export function logAuditEvent(input: { actor: string; module: string; action: string; oldValue?: string | null; newValue?: string | null; reason?: string | null }) {
  updateBank((draft) => {
    draft.auditLog = [
      {
        id: bankId("ae"),
        timestamp: new Date().toISOString(),
        actor: input.actor,
        module: input.module,
        action: input.action,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        reason: input.reason ?? null,
      },
      ...draft.auditLog,
    ];
  });
}

export function usePlexusBank(): BankState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => load(),
    () => load(),
  );
}

export function resetPlexusBank() {
  state = seedState();
  persist();
  notify();
}

// ─── Shared computation helpers ────────────────────────────────────────────

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function resolveFee(stateIn: BankState, service: string, clinic: string, payer: string): { price: number; source: FeeScheduleEntry | null; chain: string[] } {
  const entries = stateIn.feeSchedules.filter((f) => f.service === service);
  const region = CLINIC_REGION[clinic] ?? "";
  const st = CLINIC_STATE[clinic] ?? "";
  const chain: string[] = [];
  const byLevel = (level: FeeScheduleEntry["level"], scope: string) => entries.find((e) => e.level === level && e.scope === scope) ?? null;

  const payerHit = byLevel("payer", payer);
  chain.push(payerHit ? `Payer override (${payer}): ${fmtMoney(payerHit.price)} ✓` : `Payer override (${payer}): none`);
  if (payerHit) return { price: payerHit.price, source: payerHit, chain };

  const clinicHit = byLevel("clinic", clinic);
  chain.push(clinicHit ? `Clinic override (${clinic}): ${fmtMoney(clinicHit.price)} ✓` : `Clinic override (${clinic}): none`);
  if (clinicHit) return { price: clinicHit.price, source: clinicHit, chain };

  const stateHit = byLevel("state", st);
  chain.push(stateHit ? `State override (${st}): ${fmtMoney(stateHit.price)} ✓` : `State override (${st}): none`);
  if (stateHit) return { price: stateHit.price, source: stateHit, chain };

  const regionHit = byLevel("region", region);
  chain.push(regionHit ? `Region override (${region}): ${fmtMoney(regionHit.price)} ✓` : `Region override (${region}): none`);
  if (regionHit) return { price: regionHit.price, source: regionHit, chain };

  const globalHit = byLevel("global", "Global");
  chain.push(globalHit ? `Global default: ${fmtMoney(globalHit.price)} ✓` : "Global default: missing");
  return { price: globalHit?.price ?? 0, source: globalHit, chain };
}

export type PlexFactorResult = {
  eligibleCount: number;
  eligibleServices: string[];
  active: boolean;
  totalRvu: number;
  baseRate: number;
  basePayout: number;
  finalPayout: number;
  steps: string[];
};

export function computePlexFactor(stateIn: BankState, services: string[], role: string, clinic: string): PlexFactorResult {
  const rule = stateIn.plexFactorRule;
  const rvuOf = (svc: string) => stateIn.rvuSettings.find((r) => r.service === svc)?.rvu ?? 0;
  const eligible = services.filter((s) => rule.eligibleServices.includes(s));
  const active = eligible.length >= rule.minEligibleCount;
  const totalRvu = services.reduce((sum, s) => sum + rvuOf(s), 0);
  const override = stateIn.payoutOverrides.find((o) => o.role === role && ((o.scopeType === "clinic" && o.scope === clinic) || (o.scopeType === "region" && o.scope === (CLINIC_REGION[clinic] ?? ""))));
  const baseRate = override?.ratePerRvu ?? stateIn.rolePayoutRates.find((r) => r.role === role)?.ratePerRvu ?? 0;
  const basePayout = totalRvu * baseRate;
  const finalPayout = active ? basePayout * rule.multiplier : basePayout;

  const steps: string[] = [];
  for (const s of services) steps.push(`${s}: ${rvuOf(s)} RVUs${rule.eligibleServices.includes(s) ? " (Plex Factor eligible)" : ""}`);
  steps.push(`Total: ${totalRvu} RVUs across ${services.length} service${services.length === 1 ? "" : "s"}`);
  steps.push(`Eligible services performed: ${eligible.length} (threshold ${rule.minEligibleCount}) → Plex Factor ${active ? `ACTIVE ${rule.multiplier}x` : "not triggered"}`);
  steps.push(`${role} rate ${override ? `(override for ${override.scope})` : "(standard)"}: ${fmtMoney(baseRate)}/RVU × ${totalRvu} RVUs = ${fmtMoney(basePayout)}`);
  if (active) steps.push(`Apply ${rule.multiplier}x multiplier → payout ${fmtMoney(finalPayout)}`);
  else steps.push(`Payout ${fmtMoney(finalPayout)}`);

  return { eligibleCount: eligible.length, eligibleServices: eligible, active, totalRvu, baseRate, basePayout, finalPayout, steps };
}
