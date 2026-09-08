// Access catalog scope + permission invariants (Reconciliation 2.5).
//   npx tsx tests/unit/accessCatalogScope.test.ts
// Exit 0 = pass; 1 = fail.

import { ROLE_CATALOG, PERMISSION_CATALOG, ALL_ROLE_KEYS } from "@shared/accessControl/catalog";

const failures: string[] = [];
function ok(label: string, cond: boolean) {
  if (!cond) failures.push(label);
}
function role(key: string) {
  const r = ROLE_CATALOG.find((x) => x.key === key);
  if (!r) failures.push(`role "${key}" missing from catalog`);
  return r;
}

// Catalog size sanity (locks the audited totals).
ok("45 permissions (43 + finance.manage[3.5] + audit.organization.view[4A])", PERMISSION_CATALOG.length === 45);
ok("24 roles", ALL_ROLE_KEYS.length === 24);
// Phase 3.5 policy: finance.manage exists; platform_admin holds billing + finance.
ok("finance.manage present in catalog", PERMISSION_CATALOG.some((p) => p.key === "finance.manage"));
// Phase 4A: org-scoped audit permission exists and org_admin holds it (NOT platform.audit.view).
ok("audit.organization.view present", PERMISSION_CATALOG.some((p) => p.key === "audit.organization.view"));
{
  const orgAdmin = ROLE_CATALOG.find((r) => r.key === "organization_admin");
  ok("organization_admin has audit.organization.view", !!orgAdmin && orgAdmin.permissions.includes("audit.organization.view"));
  ok("organization_admin does NOT have platform.audit.view", !!orgAdmin && !orgAdmin.permissions.includes("platform.audit.view"));
}

// #31 Investor holds NO patient/clinical permissions — investor.* only.
const investor = role("investor");
if (investor) {
  ok("#31 investor permissions are investor.* only", investor.permissions.every((p) => p.startsWith("investor.")));
  ok("#31 investor has no patient.* permission", !investor.permissions.some((p) => p.startsWith("patient.")));
}

// #32 Investor is NOT platform-scoped (organization scope).
ok("#32 investor scope is organization", investor?.scopeType === "organization");
ok("#32 investor is not platform-scoped", investor?.scopeType !== "platform");

// #33 External roles are never silently platform-scoped.
for (const key of ["investor", "external_auditor", "vendor_service_partner"]) {
  const r = role(key);
  ok(`#33 ${key} is not platform-scoped`, r?.scopeType !== "platform");
}
// compliance_auditor is org-scoped by default (not platform).
ok("compliance_auditor scope is organization", role("compliance_auditor")?.scopeType === "organization");

// #34 Technical roles carry NO PHI/patient permission by default, though they
// may retain platform scope (scope ≠ capability).
for (const key of ["technical_admin", "software_engineer", "ai_data"]) {
  const r = role(key);
  ok(`#34 ${key} has no patient.* permission`, !!r && !r.permissions.some((p) => p.startsWith("patient.")));
  ok(`#34 ${key} has no clinical_data permission`, !!r && !r.permissions.includes("patient.clinical_data.view"));
}

// Defense-in-depth invariant: platform scope does not imply PHI. Software
// Engineer may be platform-scoped but must never hold patient.read by default.
ok("software_engineer lacks patient.read", !role("software_engineer")?.permissions.includes("patient.read"));

// Platform Admin holds no clinical-data (PHI) permission by default.
ok("platform_admin has no PHI (clinical_data) permission", !role("platform_admin")?.permissions.includes("patient.clinical_data.view"));

// Clinic-scoped operational roles remain clinic-scoped.
for (const key of ["pcs", "acs", "ancillary_technician", "clinician", "clinic_admin"]) {
  ok(`${key} is clinic-scoped`, role(key)?.scopeType === "clinic");
}
// Organization-scoped roles.
for (const key of ["organization_admin", "finance_manager", "executive", "director_of_operations", "implementation_specialist"]) {
  ok(`${key} is organization-scoped`, role(key)?.scopeType === "organization");
}
// Platform Admin remains the true cross-tenant admin.
ok("platform_admin is platform-scoped", role("platform_admin")?.scopeType === "platform");

// Phase 3.5 billing/finance policy.
{
  const pa = role("platform_admin");
  ok("platform_admin has billing.view+manage", !!pa && ["billing.view", "billing.manage"].every((k) => pa.permissions.includes(k)));
  ok("platform_admin has finance.view+manage", !!pa && ["finance.view", "finance.manage"].every((k) => pa.permissions.includes(k)));
  ok("platform_admin still has NO clinical PHI permission", !pa?.permissions.includes("patient.clinical_data.view"));
  const fin = role("finance_manager");
  ok("finance_manager has finance.view+manage", !!fin && ["finance.view", "finance.manage"].every((k) => fin.permissions.includes(k)));
  ok("finance_manager has billing.view (read) but NOT billing.manage", !!fin && fin.permissions.includes("billing.view") && !fin.permissions.includes("billing.manage"));
  const biller = role("billing_revenue_cycle");
  ok("billing_revenue_cycle has billing.view+manage", !!biller && ["billing.view", "billing.manage"].every((k) => biller.permissions.includes(k)));
  ok("billing_revenue_cycle has NO finance.manage", !biller?.permissions.includes("finance.manage"));
  const inv = role("investor");
  ok("investor has NO billing/finance permission", !!inv && !inv.permissions.some((p) => p.startsWith("billing.") || p.startsWith("finance.")));
}

if (failures.length) {
  console.error("accessCatalogScope.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("accessCatalogScope.test.ts: all tests passed");
