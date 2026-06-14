// billingPolicyService — Phase 4 PR 4.1.
//
// Resolves the effective billing policy for a (facility, testType,
// user?) scope by reading admin_settings.billing_policy.* keys. Uses
// the Phase 2 hardening getAdminSettingValue precedence
// (testType > facility > user > global > default).
//
// Returns a typed bundle + per-key source ledger so the Billing
// Settings Center can show which override won.

import { getAdminSettingValue } from "../../repositories/adminSettings.repo";
import type {
  EffectiveBillingPolicy,
  InvoiceFrequency,
  InvoiceCutoffWindow,
  InvoiceDeliveryMethod,
  ApprovalRequirement,
  PaymentTerm,
} from "@shared/contracts/billingPolicy";
import { BILLING_POLICY_KEYS as K } from "@shared/contracts/billingPolicy";

const DOMAIN = "billing_policy";

type Scope = { facilityId: string | null; userId: string | null; testType: string | null };

type SourceLabel = "test_type" | "facility" | "user" | "global" | "default";

async function readWithSource<T>(
  key: string,
  scope: Scope,
): Promise<{ value: T | null; source: SourceLabel }> {
  if (scope.testType != null) {
    const ts = await getAdminSettingValue<T>(DOMAIN, key, {
      facilityId: scope.facilityId ?? null,
      userId: scope.userId ?? null,
      testType: scope.testType,
    });
    if (ts !== null) return { value: ts, source: "test_type" };
  }
  if (scope.facilityId != null) {
    const fs = await getAdminSettingValue<T>(DOMAIN, key, { facilityId: scope.facilityId });
    if (fs !== null) return { value: fs, source: "facility" };
  }
  if (scope.userId != null) {
    const us = await getAdminSettingValue<T>(DOMAIN, key, { userId: scope.userId });
    if (us !== null) return { value: us, source: "user" };
  }
  const g = await getAdminSettingValue<T>(DOMAIN, key);
  if (g !== null) return { value: g, source: "global" };
  return { value: null, source: "default" };
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}
function asString(v: unknown, fallback: string | null): string | null {
  if (typeof v === "string") return v;
  return fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1" || v === "yes";
  return fallback;
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}
function asNumberArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "number" && Number.isFinite(x));
  return [];
}

export async function getEffectiveBillingPolicy(
  scope: { facilityId?: string | null; userId?: string | null; testType?: string | null } = {},
): Promise<EffectiveBillingPolicy> {
  const s: Scope = {
    facilityId: scope.facilityId ?? null,
    userId: scope.userId ?? null,
    testType: scope.testType ?? null,
  };
  const sources: Record<string, SourceLabel> = {};

  async function pick<T>(
    key: string,
  ): Promise<{ value: { value: unknown } | null; source: SourceLabel }> {
    const r = await readWithSource<{ value: T }>(key, s);
    sources[key] = r.source;
    return { value: r.value, source: r.source };
  }

  // schedule
  const freq = await pick<InvoiceFrequency>(K.scheduleFrequency);
  const daysOfMonth = await pick<number[]>(K.scheduleDaysOfMonth);
  const weekdays = await pick<number[]>(K.scheduleWeekdays);
  const timezone = await pick<string>(K.scheduleTimezone);
  const cutoffWindow = await pick<InvoiceCutoffWindow>(K.scheduleCutoffWindow);
  const cutoffHour = await pick<number>(K.scheduleCutoffHourLocal);

  // recipients
  const primaryEmail = await pick<string>(K.primaryEmail);
  const ccEmails = await pick<string[]>(K.ccEmails);
  const bccEmails = await pick<string[]>(K.bccEmails);
  const billingContactName = await pick<string>(K.billingContactName);
  const fallbackToFacility = await pick<boolean>(K.fallbackToFacilityContact);
  const escalationContact = await pick<string>(K.escalationContactName);
  const deliveryMethod = await pick<InvoiceDeliveryMethod>(K.deliveryMethod);

  // pricing
  const perTestPrice = await pick<number>(K.perTestPrice);
  const bundledPrice = await pick<number>(K.bundledPrice);
  const minMonthlyFee = await pick<number>(K.minimumMonthlyFee);
  const allowManualAdjustment = await pick<boolean>(K.allowManualAdjustment);
  const revenueSplit = await pick<{
    plexusSharePercent: number | null;
    clinicSharePercent: number | null;
    plexusFixedFee: number | null;
  }>(K.revenueSplit);

  // readiness
  const holdReport = await pick<boolean>(K.holdMissingReport);
  const holdConsent = await pick<boolean>(K.holdMissingConsent);
  const holdScreening = await pick<boolean>(K.holdMissingScreening);
  const holdOrder = await pick<boolean>(K.holdMissingOrderNote);
  const holdProcNote = await pick<boolean>(K.holdMissingProcedureNote);
  const holdSig = await pick<boolean>(K.holdPendingPhysicianSignature);
  const holdReadiness = await pick<boolean>(K.holdPendingBillingReadiness);
  const holdInsurance = await pick<boolean>(K.holdPendingInsuranceVerification);
  const excludeNoShows = await pick<boolean>(K.excludeNoShows);
  const excludeCancelled = await pick<boolean>(K.excludeCancelled);
  const billableNoShow = await pick<boolean>(K.billableNoShow);

  // approval
  const approvalReq = await pick<ApprovalRequirement>(K.approvalRequirement);
  const autoDraftOnly = await pick<boolean>(K.autoDraftOnly);

  // payment
  const paymentTerm = await pick<PaymentTerm>(K.paymentTerm);
  const customDays = await pick<number>(K.paymentTermCustomDays);
  const reminderInterval = await pick<number>(K.reminderIntervalDays);

  // numbering
  const facilityPrefix = await pick<string>(K.facilityPrefix);
  const includePeriodCode = await pick<boolean>(K.includePeriodCode);

  function unwrap<T>(v: { value: unknown } | null): unknown {
    if (v && typeof v === "object" && "value" in v) return (v as { value: unknown }).value;
    return null;
  }

  return {
    scope: { facilityId: s.facilityId, testType: s.testType },
    schedule: {
      frequency: (unwrap<InvoiceFrequency>(freq.value) as InvoiceFrequency) ?? "monthly",
      daysOfMonth: asNumberArray(unwrap(daysOfMonth.value)),
      weekdays: asNumberArray(unwrap(weekdays.value)),
      timezone: asString(unwrap(timezone.value), "America/New_York") ?? "America/New_York",
      cutoffWindow: (unwrap(cutoffWindow.value) as InvoiceCutoffWindow) ?? "through_yesterday",
      cutoffHourLocal: asNumber(unwrap(cutoffHour.value), 17),
    },
    recipients: {
      primaryEmail: asString(unwrap(primaryEmail.value), null),
      ccEmails: asStringArray(unwrap(ccEmails.value)),
      bccEmails: asStringArray(unwrap(bccEmails.value)),
      billingContactName: asString(unwrap(billingContactName.value), null),
      fallbackToFacilityContact: asBoolean(unwrap(fallbackToFacility.value), true),
      escalationContactName: asString(unwrap(escalationContact.value), null),
      deliveryMethod: (unwrap(deliveryMethod.value) as InvoiceDeliveryMethod) ?? "download_only",
    },
    pricing: {
      perTestPrice: typeof unwrap(perTestPrice.value) === "number" ? (unwrap(perTestPrice.value) as number) : null,
      bundledPrice: typeof unwrap(bundledPrice.value) === "number" ? (unwrap(bundledPrice.value) as number) : null,
      minimumMonthlyFee: typeof unwrap(minMonthlyFee.value) === "number" ? (unwrap(minMonthlyFee.value) as number) : null,
      allowManualAdjustment: asBoolean(unwrap(allowManualAdjustment.value), false),
      revenueSplit: {
        plexusSharePercent: (unwrap(revenueSplit.value) as any)?.plexusSharePercent ?? null,
        clinicSharePercent: (unwrap(revenueSplit.value) as any)?.clinicSharePercent ?? null,
        plexusFixedFee: (unwrap(revenueSplit.value) as any)?.plexusFixedFee ?? null,
      },
    },
    readiness: {
      holdMissingReport: asBoolean(unwrap(holdReport.value), true),
      holdMissingConsent: asBoolean(unwrap(holdConsent.value), true),
      holdMissingScreening: asBoolean(unwrap(holdScreening.value), true),
      holdMissingOrderNote: asBoolean(unwrap(holdOrder.value), true),
      holdMissingProcedureNote: asBoolean(unwrap(holdProcNote.value), true),
      holdPendingPhysicianSignature: asBoolean(unwrap(holdSig.value), true),
      holdPendingBillingReadiness: asBoolean(unwrap(holdReadiness.value), true),
      holdPendingInsuranceVerification: asBoolean(unwrap(holdInsurance.value), false),
      excludeNoShows: asBoolean(unwrap(excludeNoShows.value), true),
      excludeCancelled: asBoolean(unwrap(excludeCancelled.value), true),
      billableNoShow: asBoolean(unwrap(billableNoShow.value), false),
    },
    approval: {
      requirement: (unwrap(approvalReq.value) as ApprovalRequirement) ?? "admin",
      autoDraftOnly: asBoolean(unwrap(autoDraftOnly.value), true),
    },
    paymentTerms: {
      term: (unwrap(paymentTerm.value) as PaymentTerm) ?? "net_15",
      customDays: typeof unwrap(customDays.value) === "number" ? (unwrap(customDays.value) as number) : null,
      reminderIntervalDays: asNumber(unwrap(reminderInterval.value), 7),
    },
    numbering: {
      facilityPrefix: asString(unwrap(facilityPrefix.value), null),
      includePeriodCode: asBoolean(unwrap(includePeriodCode.value), true),
    },
    sources,
  };
}

export const BILLING_POLICY_DOMAIN = DOMAIN;
