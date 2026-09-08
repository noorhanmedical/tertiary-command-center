// Shared Phase 3.5 billing/finance permission guards.
//
// One place that maps billing/finance routes to the permission model, so the
// many billing route files don't each re-declare guards. Enforcement OFF →
// the legacy admin|biller fallback runs (which also CLOSES previously-ungated
// billing reads/writes by tightening them to admin|biller now).

import { requirePermission, legacyRequireAnyRole, legacyRequireAdmin } from "./accessControl";

const billerLegacy = legacyRequireAnyRole("admin", "biller");

/** Sensitive billing READ → billing.view (legacy: admin|biller). */
export const requireBillingView = requirePermission("billing.view", { legacy: billerLegacy });
/** Billing MUTATION → billing.manage (legacy: admin|biller). */
export const requireBillingManage = requirePermission("billing.manage", { legacy: billerLegacy });
/** Financial READ → finance.view (legacy: admin|biller). */
export const requireFinanceView = requirePermission("finance.view", { legacy: billerLegacy });
/** Financial MUTATION → finance.manage (legacy: admin). */
export const requireFinanceManage = requirePermission("finance.manage", { legacy: legacyRequireAdmin });
