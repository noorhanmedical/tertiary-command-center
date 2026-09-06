// ═══════════════════════════════════════════════════════════════════════════
// Plexus OS Access Control — canonical SEED catalog (system defaults).
//
// This is the single source of truth for the SYSTEM role templates, the
// permission catalog, and each role's default permission bundle. Seeds provide
// defaults ONLY; actual per-user configuration is owned by Settings (later
// phase) via user_roles / user_permission_overrides / user_*_access.
//
// Nothing here hard-codes an individual user. Keys are stable + machine
// friendly; display names are separate and may be re-labeled freely.
//
// Design constraints honored:
//   • Coherent, understandable permissions — not hundreds of hyper-granular keys.
//   • Technical roles do NOT get PHI/patient clinical access by default.
//   • Investor is structurally restricted to aggregate dashboards + documents.
//   • Permissions and scope are separate concerns (scope lives on assignments).
// ═══════════════════════════════════════════════════════════════════════════

import type { AccessScopeType, WorkspaceIdentifier } from "../schema/access";

// ─── Permission catalog ──────────────────────────────────────────────────────
// Grouped by category for the Settings UI. Add keys additively as real
// security boundaries require; do not invent granularity preemptively.
export interface PermissionDef {
  key: string;
  category: string;
  description: string;
}

export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // Patients
  { key: "patient.read", category: "Patients", description: "View patient records within scope." },
  { key: "patient.manage", category: "Patients", description: "Create and edit patient records and demographics." },
  { key: "patient.clinical_data.view", category: "Patients", description: "View patient clinical data (PHI)." },

  // Screening / qualification
  { key: "screening.view", category: "Screening", description: "View screening and qualification workflows." },
  { key: "screening.manage", category: "Screening", description: "Perform and edit screening/qualification work." },
  { key: "screening.qualify", category: "Screening", description: "Make qualification decisions." },
  { key: "screening.admin_review", category: "Screening", description: "Perform Plexus-internal service-specific Admin Review." },

  // Orders
  { key: "order.view", category: "Orders", description: "View orders." },
  { key: "order.create", category: "Orders", description: "Create orders." },
  { key: "order.sign", category: "Orders", description: "Sign orders (clinician authority)." },

  // Procedures
  { key: "procedure.view", category: "Procedures", description: "View procedures." },
  { key: "procedure.perform", category: "Procedures", description: "Perform and record procedures/tests." },
  { key: "procedure.complete", category: "Procedures", description: "Complete and finalize procedures." },

  // Documents
  { key: "document.view", category: "Documents", description: "View documents." },
  { key: "document.generate", category: "Documents", description: "Generate documents." },
  { key: "document.sign", category: "Documents", description: "Sign documents (clinical signature authority)." },
  { key: "document.interpret", category: "Documents", description: "Interpret studies / produce interpreting reports." },

  // Scheduling
  { key: "schedule.view", category: "Scheduling", description: "View schedules." },
  { key: "schedule.manage", category: "Scheduling", description: "Create, modify, and cancel schedule entries." },

  // Communication
  { key: "communication.view", category: "Communication", description: "View patient communications." },
  { key: "communication.manage", category: "Communication", description: "Send/manage patient communications and outreach." },

  // Billing / revenue cycle
  { key: "billing.view", category: "Billing", description: "View billing documents and claim readiness." },
  { key: "billing.manage", category: "Billing", description: "Manage claims, denials, and billing workflow." },

  // Finance
  { key: "finance.view", category: "Finance", description: "View financial dashboards, revenue, collections, distributions." },
  { key: "finance.manage", category: "Finance", description: "Mutate financial configuration, payment/distribution state, and financial operations." },

  // Reporting
  { key: "reporting.view", category: "Reporting", description: "View operational reporting within scope." },
  { key: "reporting.clinical.view", category: "Reporting", description: "View clinical reporting." },
  { key: "reporting.financial.view", category: "Reporting", description: "View financial reporting." },
  { key: "reporting.executive.view", category: "Reporting", description: "View executive/high-level dashboards." },

  // Staff
  { key: "staff.view", category: "Staff", description: "View staff metrics and rosters within scope." },
  { key: "staff.manage", category: "Staff", description: "Manage staff, assignments, and team operations." },

  // User administration
  { key: "users.view", category: "User Admin", description: "View users and their access within scope." },
  { key: "users.manage", category: "User Admin", description: "Create, edit, disable users and assign roles/permissions within scope." },

  // Clinic administration
  { key: "clinic.view", category: "Clinic Admin", description: "View clinic configuration." },
  { key: "clinic.manage", category: "Clinic Admin", description: "Manage clinic settings, services, and configuration." },

  // Organization administration
  { key: "organization.view", category: "Org Admin", description: "View organization configuration." },
  { key: "organization.manage", category: "Org Admin", description: "Manage organization settings, clinics, and members." },

  // Platform administration
  { key: "platform.settings.view", category: "Platform", description: "View platform configuration." },
  { key: "platform.settings.manage", category: "Platform", description: "Manage platform-wide configuration." },
  { key: "platform.audit.view", category: "Platform", description: "View platform-wide audit history and access events (cross-tenant)." },
  { key: "audit.organization.view", category: "Platform", description: "View audit events scoped to the user's own organization(s)/clinic(s)." },

  // Technical (SEPARATE from clinical/PHI capability by design)
  { key: "technical.view", category: "Technical", description: "View system health, logs, and integrations." },
  { key: "technical.manage", category: "Technical", description: "Manage integrations, feature flags, and technical settings." },

  // Investor (restricted, aggregate only — never patient/PHI)
  { key: "investor.dashboard.view", category: "Investor", description: "View aggregate/de-identified investor dashboards." },
  { key: "investor.documents.view", category: "Investor", description: "View investor documents and company updates." },
] as const;

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

// ─── Role templates ──────────────────────────────────────────────────────────
export interface RoleDef {
  key: string;
  displayName: string;
  description: string;
  scopeType: AccessScopeType;
  defaultWorkspace: WorkspaceIdentifier;
  /** Default permission bundle (permission keys). */
  permissions: readonly string[];
  /** Roles that are parked/non-assignable until their workspace ships. */
  isAssignable?: boolean;
}

// Convenience bundles (composed below).
const P = {
  patientReadOnly: ["patient.read"],
  clinicalCore: [
    "patient.read", "patient.clinical_data.view",
    "screening.view", "order.view", "order.create", "order.sign",
    "procedure.view", "document.view", "document.sign",
    "schedule.view", "reporting.clinical.view",
  ],
} as const;

export const ROLE_CATALOG: readonly RoleDef[] = [
  // ── Platform / System ──────────────────────────────────────────────────────
  {
    key: "platform_admin",
    displayName: "Platform Admin",
    description: "Plexus-wide administrator. Manages organizations, clinics, users, roles, permissions, platform configuration, and audit.",
    scopeType: "platform",
    defaultWorkspace: "platform_admin",
    // Platform Admin holds explicit platform-tier permissions (no magic).
    // Phase 3.5: Platform Admin administers BILLING and FINANCE across the
    // platform (billing.*/finance.*). This is deliberately SEPARATE from
    // clinical/PHI authority — Platform Admin still holds only patient.read
    // (demographics) and NO patient.clinical_data.view / signing permissions.
    permissions: [
      "organization.view", "organization.manage",
      "clinic.view", "clinic.manage",
      "users.view", "users.manage",
      "platform.settings.view", "platform.settings.manage", "platform.audit.view",
      "technical.view",
      "billing.view", "billing.manage",
      "finance.view", "finance.manage",
      "reporting.view", "reporting.executive.view", "reporting.financial.view", "reporting.clinical.view",
      "staff.view", "staff.manage",
      "patient.read",
    ],
  },
  {
    key: "technical_admin",
    displayName: "Technical Admin",
    description: "Technical/platform operations (integrations, system health, feature flags). No PHI by default.",
    scopeType: "platform",
    defaultWorkspace: "technical",
    permissions: [
      "technical.view", "technical.manage",
      "platform.settings.view", "platform.audit.view",
    ],
  },
  {
    key: "software_engineer",
    displayName: "Software Engineer",
    description: "Engineering access, separated from clinical/business authority. No production PHI by default; sensitive access is explicit and auditable.",
    scopeType: "platform",
    defaultWorkspace: "technical",
    permissions: ["technical.view"],
  },
  {
    key: "ai_data",
    displayName: "AI / Data",
    description: "Qualification-engine/model configuration and aggregate analytics. No identifiable patient data by default.",
    scopeType: "platform",
    defaultWorkspace: "technical",
    permissions: ["technical.view", "reporting.view"],
  },
  {
    key: "compliance_auditor",
    displayName: "Compliance / Auditor",
    description: "Read-focused access to audit trail, access events, and history. No mutation by default.",
    // Organization scope by default (Reconciliation 2.5). A Plexus-wide
    // compliance mandate must be granted explicitly, not assumed.
    scopeType: "organization",
    defaultWorkspace: "compliance",
    permissions: ["platform.audit.view", "reporting.view", "users.view"],
  },

  // ── Leadership ───────────────────────────────────────────────────────────────
  {
    key: "executive",
    displayName: "Executive",
    description: "High-level dashboards, growth, revenue, and operating metrics. No patient-level clinical editing.",
    scopeType: "organization",
    defaultWorkspace: "executive",
    permissions: ["reporting.executive.view", "reporting.view", "reporting.financial.view", "finance.view"],
  },
  {
    key: "director_of_operations",
    displayName: "Director of Operations",
    description: "Cross-clinic operational dashboards, staff productivity, scheduling and workflow monitoring.",
    scopeType: "organization",
    defaultWorkspace: "operations",
    permissions: [
      "reporting.view", "staff.view", "staff.manage",
      "schedule.view", "schedule.manage", "patient.read",
    ],
  },
  {
    key: "manager",
    displayName: "Manager",
    description: "Operational supervision: team metrics, scheduling, patient pipeline, workflow oversight for assigned clinics.",
    scopeType: "clinic",
    defaultWorkspace: "operations",
    permissions: [
      "reporting.view", "staff.view",
      "schedule.view", "schedule.manage",
      "patient.read", "communication.view",
    ],
  },
  {
    key: "finance_manager",
    displayName: "Finance Manager",
    description: "Revenue, collections, distributions, invoices, and financial reporting. No patient clinical access by default.",
    scopeType: "organization",
    defaultWorkspace: "finance",
    // Phase 3.5: Finance Manager owns finance operations (finance.view/manage).
    // Retains billing.view ONLY (read) for financial reporting — NOT
    // billing.manage. No patient/clinical or platform-admin authority.
    permissions: ["finance.view", "finance.manage", "reporting.financial.view", "billing.view"],
  },

  // ── Clinical ─────────────────────────────────────────────────────────────────
  {
    key: "clinician",
    displayName: "Clinician",
    description: "Physicians, NPs, PAs. Patient clinical access, order review/creation/signature, document signature, results review.",
    scopeType: "clinic",
    defaultWorkspace: "clinical",
    permissions: [...P.clinicalCore, "communication.view"],
  },
  {
    key: "acs",
    displayName: "ACS",
    description: "Ancillary Care Specialist. Screening, qualification workflows, ancillary eligibility, coordination, order prep if configured. No physician signing by default.",
    scopeType: "clinic",
    defaultWorkspace: "acs",
    permissions: [
      "patient.read", "screening.view", "screening.manage", "screening.qualify",
      "order.view", "procedure.view", "document.view", "document.generate",
      "schedule.view", "communication.view",
    ],
  },
  {
    key: "ancillary_technician",
    displayName: "Ancillary Technician",
    description: "Assigned testing queue, perform test, record completion, upload study, technical notes. Service-line access is configurable.",
    scopeType: "clinic",
    defaultWorkspace: "technician",
    permissions: [
      "patient.read", "procedure.view", "procedure.perform", "procedure.complete",
      "document.view", "document.generate", "schedule.view",
    ],
  },
  {
    key: "interpreting_physician",
    displayName: "Interpreting Physician",
    description: "Reads/interprets studies and produces interpreting reports/signatures.",
    scopeType: "clinic",
    defaultWorkspace: "clinical",
    permissions: [
      "patient.read", "patient.clinical_data.view",
      "procedure.view", "document.view", "document.interpret", "document.sign",
      "reporting.clinical.view",
    ],
  },
  {
    // Dedicated key preserving the legacy plexus_internal_clinical_reviewer
    // behavior (the ONLY role permitted for service-specific Admin Review).
    key: "plexus_clinical_reviewer",
    displayName: "Plexus Clinical Reviewer",
    description: "Plexus-internal clinical reviewer for service-specific Admin Review (qualification approval). Platform-operator provisioned.",
    scopeType: "platform",
    defaultWorkspace: "clinical",
    permissions: [
      "patient.read", "patient.clinical_data.view",
      "screening.view", "screening.qualify", "screening.admin_review",
      "document.view", "reporting.clinical.view",
    ],
  },

  // ── Patient Operations ─────────────────────────────────────────────────────
  {
    key: "pcs",
    displayName: "PCS",
    description: "Patient Care Specialist. Outreach, communication, scheduling, follow-up, patient coordination, screening workflow if configured. No clinical signing.",
    scopeType: "clinic",
    defaultWorkspace: "pcs",
    permissions: [
      "patient.read", "communication.view", "communication.manage",
      "schedule.view", "schedule.manage", "screening.view",
    ],
  },
  {
    key: "scheduler",
    displayName: "Scheduler",
    description: "Scheduling and appointment coordination.",
    scopeType: "clinic",
    defaultWorkspace: "pcs",
    permissions: ["patient.read", "schedule.view", "schedule.manage", "communication.view"],
  },
  {
    key: "patient_support",
    displayName: "Patient Support",
    description: "Patient support and coordination without clinical or scheduling-management authority.",
    scopeType: "clinic",
    defaultWorkspace: "patient_support",
    permissions: ["patient.read", "communication.view"],
  },

  // ── Clinic / Business Operations ─────────────────────────────────────────────
  {
    key: "organization_admin",
    displayName: "Organization Admin",
    description: "Manages users, clinics, and settings within their organization only. No platform authority; no access to other organizations.",
    scopeType: "organization",
    defaultWorkspace: "organization_admin",
    permissions: [
      "organization.view", "organization.manage",
      "clinic.view", "clinic.manage",
      "users.view", "users.manage",
      "staff.view", "staff.manage",
      "reporting.view", "patient.read",
      // Phase 4A: org-scoped audit (NOT platform.audit.view — cross-tenant).
      "audit.organization.view",
    ],
  },
  {
    key: "clinic_admin",
    displayName: "Clinic Admin",
    description: "Manages assigned clinic(s): clinic users, schedules, clinic configuration, ancillary settings, operational reporting. No platform authority.",
    scopeType: "clinic",
    defaultWorkspace: "clinic_admin",
    permissions: [
      "clinic.view", "clinic.manage",
      "users.view", "users.manage",
      "staff.view", "staff.manage",
      "schedule.view", "schedule.manage",
      "reporting.view", "patient.read",
    ],
  },
  {
    key: "billing_revenue_cycle",
    displayName: "Billing / Revenue Cycle",
    description: "Billing documents, claim readiness, CPT/ICD workflow, claims, denials, payer info, billing status. Distinct from Finance.",
    scopeType: "clinic",
    defaultWorkspace: "billing",
    permissions: ["billing.view", "billing.manage", "document.view", "patient.read", "reporting.financial.view"],
  },
  {
    key: "implementation_specialist",
    displayName: "Implementation Specialist",
    description: "Configure/onboard new clinics: services, schedules, users, forms/workflows, ancillary programs. Delegated without full Platform Admin.",
    scopeType: "organization",
    defaultWorkspace: "implementation",
    permissions: [
      "clinic.view", "clinic.manage",
      "users.view", "users.manage",
      "schedule.view", "schedule.manage",
    ],
  },

  // ── External ─────────────────────────────────────────────────────────────────
  {
    key: "investor",
    displayName: "Investor",
    description: "Highly restricted external persona. Aggregate/de-identified dashboards and investor documents ONLY. Never patient/PHI.",
    // Organization scope (Reconciliation 2.5): an Investor must be attached to
    // the organization(s) they are permitted to see — NEVER platform-wide,
    // even though they currently hold no patient permissions (defense in depth
    // as permissions may expand later).
    scopeType: "organization",
    defaultWorkspace: "investor",
    permissions: ["investor.dashboard.view", "investor.documents.view"],
  },
  {
    key: "external_auditor",
    displayName: "External Auditor",
    description: "External read-only audit access to access events and history within an agreed scope. No mutation.",
    scopeType: "organization",
    defaultWorkspace: "compliance",
    permissions: ["platform.audit.view", "reporting.view"],
  },
  {
    key: "vendor_service_partner",
    displayName: "Vendor / Service Partner",
    description: "External partner with narrowly scoped, explicitly granted access. Minimal defaults; capabilities added via overrides.",
    scopeType: "organization",
    defaultWorkspace: "plexus_home",
    isAssignable: true,
    permissions: [],
  },
] as const;

export const ALL_ROLE_KEYS = ROLE_CATALOG.map((r) => r.key);

// ─── Legacy → new role mapping (for backfill) ────────────────────────────────
// AMBIGUOUS mappings are marked and handled conservatively by the backfill
// (never a silent guess). See backfill script for the resolution rules.
export interface LegacyRoleMapping {
  legacy: string;
  /** The unambiguous target role key, or null when it must be resolved from
   *  richer signals (team membership) / flagged for manual review. */
  target: string | null;
  ambiguous: boolean;
  note: string;
}

// ─── NEW role → LEGACY users.role mirror (Phase 4A) ──────────────────────────
// When the access-management API sets a user's PRIMARY role, we keep the
// transitional `users.role` mirror in sync so legacy role-string guards keep
// behaving during the migration. Only roles with a SAFE, non-misleading legacy
// equivalent are mapped. Roles with no safe equivalent mirror the NEW key
// verbatim — legacy string guards never match it, so the user is least-
// privileged under legacy checks (never a misleading elevation).
export const NEW_ROLE_LEGACY_MIRROR: Record<string, string> = {
  platform_admin: "admin",
  clinician: "clinician",
  interpreting_physician: "clinician",
  scheduler: "scheduler",
  billing_revenue_cycle: "biller",
  ancillary_technician: "technician",
  acs: "technician",
  pcs: "liaison",
  plexus_clinical_reviewer: "plexus_internal_clinical_reviewer",
};

export function legacyRoleMirrorFor(newRoleKey: string): { legacy: string; mapped: boolean } {
  const legacy = NEW_ROLE_LEGACY_MIRROR[newRoleKey];
  if (legacy) return { legacy, mapped: true };
  return { legacy: newRoleKey, mapped: false };
}

export const LEGACY_ROLE_MAPPINGS: readonly LegacyRoleMapping[] = [
  { legacy: "admin", target: "platform_admin", ambiguous: false, note: "Legacy admin is the tenant-bypass superuser → Platform Admin." },
  { legacy: "clinician", target: "clinician", ambiguous: false, note: "Direct." },
  { legacy: "scheduler", target: "scheduler", ambiguous: false, note: "Direct." },
  { legacy: "biller", target: "billing_revenue_cycle", ambiguous: false, note: "Legacy biller → Billing / Revenue Cycle." },
  { legacy: "technician", target: "ancillary_technician", ambiguous: false, note: "Per instruction: technician → Ancillary Technician." },
  {
    legacy: "liaison",
    target: null,
    ambiguous: true,
    note:
      "AMBIGUOUS. Codebase contradicts itself: fallbackWorkspaceTypeForRole() treats liaison as ACS, " +
      "while portal VIEWAS maps pcs→liaison (PCS). Canonical path derives PCS/ACS from TEAM MEMBERSHIP, " +
      "not role. Backfill resolves via team membership when available; otherwise assigns a neutral " +
      "Patient Support role and flags for manual review. Never a silent PCS/ACS guess.",
  },
  {
    legacy: "plexus_internal_clinical_reviewer",
    target: "plexus_clinical_reviewer",
    ambiguous: false,
    note: "Dedicated role preserving the ONLY-role-permitted-for-Admin-Review behavior. Not clinic admin, not generic clinician.",
  },
];
