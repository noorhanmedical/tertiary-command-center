// Client API for the Engagement Call List Distribution & Share Packages flow.
// All endpoints live under /api/engagement/call-lists/* (admin) plus the public
// /api/shared-call-list/:token surface. Thin fetch wrappers — the Engagement
// dialog + Recent Lists consume these.

import type { CallListCohortKey } from "@shared/engagement/callListCohorts";
import type {
  CallListPackageHeaderView,
  CallListPackageMemberView,
} from "@/lib/pdfGeneration";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ─── Cohort preview ──────────────────────────────────────────────────────────
export type CohortPreviewCase = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  selectedServices: string[];
  engagementStatus: string | null;
  lastCallOutcome: string | null;
  nextActionAt: string | null;
};

export type CohortPreviewResult = {
  cohort: CallListCohortKey;
  facility: string;
  services: string[] | null;
  notContactedDays: number | null;
  total: number;
  preview: CohortPreviewCase[];
};

export type ServiceCategory = "brainwave" | "vitalwave" | "ultrasound";

export async function fetchCohortPreview(params: {
  cohort: CallListCohortKey;
  facility: string;
  services?: string[];
  serviceCategories?: ServiceCategory[];
  notContactedDays?: number;
  limit?: number;
}): Promise<CohortPreviewResult> {
  const q = new URLSearchParams();
  q.set("cohort", params.cohort);
  q.set("facility", params.facility);
  if (params.services && params.services.length > 0) q.set("services", params.services.join(","));
  if (params.serviceCategories && params.serviceCategories.length > 0)
    q.set("serviceCategories", params.serviceCategories.join(","));
  if (params.notContactedDays != null) q.set("notContactedDays", String(params.notContactedDays));
  if (params.limit != null) q.set("limit", String(params.limit));
  const res = await fetch(`/api/engagement/call-lists/cohort-preview?${q.toString()}`, {
    credentials: "include",
  });
  return jsonOrThrow<CohortPreviewResult>(res);
}

// ─── Distribution preview ────────────────────────────────────────────────────
export type PreviewPatient = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  services: string[];
  reasonForCall: string;
  status: string;
  nextActionAt: string | null;
};

export type PreviewMember = {
  teamMemberId: number;
  name: string;
  facility: string | null;
  patientCount: number;
  capacity: {
    assignedThisPlan: number;
    dailyCallCapacity: number;
    standardWorkload: number;
    projectedEffectiveWorkload: number;
    remainingCapacity: number;
  };
  ancillaryMix: { brainwave: number; vitalwave: number; ultrasound: number; other: number };
  statusMix: Record<string, number>;
  patients: PreviewPatient[];
};

export type DistributionPreview = {
  previewOperationId: string;
  createdAt: string;
  facility: string;
  serviceDate: string;
  cohort: CallListCohortKey;
  cohortLabel: string;
  services: string[] | null;
  notContactedDays: number | null;
  totalMatches: number;
  distributedPoolSize: number;
  members: PreviewMember[];
  unplaced: Array<{ executionCaseId: number; patientName: string; reason: string; category: string }>;
  mapping: Array<{ executionCaseId: number; teamMemberId: number }>;
};

export async function fetchDistributionPreview(params: {
  cohort: CallListCohortKey;
  facility: string;
  services?: string[];
  serviceCategories?: ServiceCategory[];
  notContactedDays?: number;
  serviceDate?: string;
}): Promise<DistributionPreview> {
  const res = await fetch("/api/engagement/call-lists/distribution-preview", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<DistributionPreview>(res);
}

// ─── Confirm ────────────────────────────────────────────────────────────────
export type ConfirmMemberResult = {
  teamMemberId: number;
  name: string | null;
  committedCount: number;
  packageId: number | null;
  shareToken: string | null;
  generationStatus: string | null;
  visibility: "visible" | "missing_user_mapping";
  packageError: boolean;
  /** True when this member's package already existed (reused on a retry). */
  alreadyExisted: boolean;
};

export type CallListOperationStatus =
  | "fully_complete"
  | "assignment_complete_package_incomplete";

export type ConfirmResult = {
  distributionOperationId: string;
  facility: string;
  serviceDate: string | null;
  cohort: CallListCohortKey;
  alreadyProcessed: boolean;
  /** Derived operation completion — a retry finishes an incomplete one. */
  operationStatus: CallListOperationStatus;
  members: ConfirmMemberResult[];
  totalCommitted: number;
  conflicts: Array<{ executionCaseId: number; reason: string }>;
};

export async function confirmDistribution(params: {
  distributionOperationId: string;
  cohort: CallListCohortKey;
  facility: string;
  serviceDate?: string;
  services?: string[];
  mapping: Array<{ executionCaseId: number; teamMemberId: number }>;
}): Promise<ConfirmResult> {
  const res = await fetch("/api/engagement/call-lists/distribution-confirm", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<ConfirmResult>(res);
}

// ─── Package fetch + PDF durability ──────────────────────────────────────────
type PackageRowRaw = {
  id: number;
  facilityId: string;
  teamMemberNameSnapshot: string | null;
  serviceDate: string | null;
  cohortLabelSnapshot: string | null;
  patientCount: number;
  generationStatus: string;
};

export async function fetchPackageWithMembers(id: number): Promise<{
  pkg: PackageRowRaw;
  members: CallListPackageMemberView[];
}> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}`, {
    credentials: "include",
  });
  return jsonOrThrow(res);
}

export async function uploadPackagePdfFor(id: number, pdfBase64: string, filename?: string) {
  return uploadPackagePdf(id, pdfBase64, filename);
}

/** Generate the combined PDF in the browser from the FROZEN snapshot and upload
 *  it for durable storage. On any failure, marks the package generation failed
 *  (retryable) — the committed assignments are unaffected. Returns the final
 *  generation status. */
export async function generateAndUploadPackagePdf(
  packageId: number,
): Promise<"ready" | "failed"> {
  const { generateCallListPackagePdfBase64 } = await import("@/lib/pdfGeneration");
  try {
    const { pkg, members } = await fetchPackageWithMembers(packageId);
    const header: CallListPackageHeaderView = {
      teamMemberName: pkg.teamMemberNameSnapshot ?? null,
      facility: pkg.facilityId ?? null,
      serviceDate: pkg.serviceDate ?? null,
      cohortLabel: pkg.cohortLabelSnapshot ?? null,
      patientCount: pkg.patientCount ?? members.length,
    };
    const { base64, filename } = await generateCallListPackagePdfBase64(header, members);
    await uploadPackagePdf(packageId, base64, filename);
    return "ready";
  } catch (e) {
    try {
      await markPackagePdfFailed(
        packageId,
        e instanceof Error ? e.message.slice(0, 120) : "client_render_failed",
      );
    } catch {
      /* best-effort — assignment already committed regardless */
    }
    return "failed";
  }
}

export async function uploadPackagePdf(
  id: number,
  pdfBase64: string,
  filename?: string,
): Promise<{ ok: boolean; generationStatus: string; pdfBlobId: number }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/pdf`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfBase64, filename }),
  });
  return jsonOrThrow(res);
}

export async function markPackagePdfFailed(
  id: number,
  errorCode?: string,
): Promise<{ ok: boolean; generationStatus: string }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/pdf-failed`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ errorCode }),
  });
  return jsonOrThrow(res);
}

// ─── Recent Generated Lists + lifecycle ──────────────────────────────────────
export type RecentPackage = {
  id: number;
  facility: string;
  teamMemberId: number;
  teamMemberName: string | null;
  serviceDate: string | null;
  cohortLabel: string | null;
  patientCount: number;
  generationStatus: string;
  status: string;
  shareExpiresAt: string | null;
  shareRevokedAt: string | null;
  pdfAvailable: boolean;
  pinProtected?: boolean;
  createdAt: string;
};

export async function fetchRecentPackages(params: {
  facility?: string | null;
  limit?: number;
}): Promise<RecentPackage[]> {
  const q = new URLSearchParams();
  if (params.facility) q.set("facility", params.facility);
  if (params.limit != null) q.set("limit", String(params.limit));
  const res = await fetch(`/api/engagement/call-lists/packages?${q.toString()}`, {
    credentials: "include",
  });
  return jsonOrThrow<RecentPackage[]>(res);
}

export async function revokePackage(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/revoke`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

export async function extendPackage(id: number, hours: number): Promise<{ ok: boolean; shareExpiresAt: string }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/extend`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hours }),
  });
  return jsonOrThrow(res);
}

export async function regeneratePackage(id: number): Promise<{ ok: boolean; shareToken: string; shareExpiresAt: string }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

/** Set/replace the OPTIONAL share PIN (second factor). Plaintext is sent over
 *  the authenticated manager channel; only a bcrypt hash is stored server-side. */
export async function setPackagePin(id: number, pin: string): Promise<{ ok: boolean; pinProtected: boolean }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/set-pin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  return jsonOrThrow(res);
}

/** Remove the share PIN (revert to token-only access). */
export async function clearPackagePin(id: number): Promise<{ ok: boolean; pinProtected: boolean }> {
  const res = await fetch(`/api/engagement/call-lists/packages/${id}/clear-pin`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Build the public share URL from a plaintext token (returned once). */
export function buildShareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/shared-call-list/${token}`;
}
