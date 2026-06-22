// Enterprise demo fallback flag.
//
// PR #294 ships the four enterprise tiles (Mission Control, Imaging
// Central, Clinic Analytics, Clinic Onboarding) with mock data, no
// backend calls, and no real persistence. This module is the single
// switch that decides whether the production UI surfaces the demo-only
// affordances (view-state switchers, demo signoff buttons, etc.).
//
// PRODUCTION DEFAULT: off. The tiles render mock data with a clear
// "Demo fallback data — backend endpoint pending" banner. Demo
// scenario switchers are hidden. Action buttons surface honest
// "Backend endpoint pending" toasts instead of fake success.
//
// HOW TO TURN ON FOR LOCAL REVIEW: set
//   localStorage.enterpriseDemoMode = "1"
// in the browser console and refresh. Setting it from devtools is
// intentional — the demo affordances are never exposed to end users
// through the normal UI.

export const ENTERPRISE_DEMO_FALLBACK_LOCAL_STORAGE_KEY = "enterpriseDemoMode";

export function isEnterpriseDemoFallbackEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.localStorage === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(ENTERPRISE_DEMO_FALLBACK_LOCAL_STORAGE_KEY) ===
      "1"
    );
  } catch {
    return false;
  }
}

// Surfaced verbatim in the demo-fallback banner so the framing stays
// consistent across all four tiles.
export const ENTERPRISE_DEMO_FALLBACK_NOTICE =
  "Demo fallback data — backend endpoint pending. The figures below are illustrative only. No real sync, persistence, or PHI.";

export const ENTERPRISE_DEMO_FALLBACK_SHORT_BADGE = "Demo fallback";

// Shared honest copy for action buttons that would otherwise fake
// success. Use `enterpriseBackendPendingToast(action)` to fire it.
export interface EnterpriseBackendPendingToast {
  title: string;
  description: string;
}

export function enterpriseBackendPendingToast(
  action: string,
): EnterpriseBackendPendingToast {
  return {
    title: "Backend endpoint pending",
    description: `${action} is wired in the UI but does not persist yet. The backend mutation for this action ships separately.`,
  };
}
