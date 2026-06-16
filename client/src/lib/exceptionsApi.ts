// exceptionsApi — Phase 3 PR 3.2 / 3.3 client.

export type ExceptionStatus = "open" | "acknowledged" | "in_review" | "resolved" | "dismissed" | "superseded";

export type ExceptionRow = {
  id: number;
  exceptionKey: string;
  exceptionType: string;
  entityType: string;
  entityId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  invoiceId: number | null;
  facilityId: string | null;
  testType: string | null;
  severity: "info" | "low" | "medium" | "high" | "critical";
  status: ExceptionStatus;
  title: string;
  explanation: string;
  recommendedOwnerRole: string | null;
  assignedToUserId: string | null;
  assignedRole: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dismissedReason: string | null;
  resolutionReason: string | null;
  detectedAt: string;
  lastSeenAt: string;
  sourceSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchExceptions(filters: { status?: string; severity?: string; exceptionType?: string; facilityId?: string; ownerRole?: string; limit?: number } = {}): Promise<ExceptionRow[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.severity) qs.set("severity", filters.severity);
  if (filters.exceptionType) qs.set("exceptionType", filters.exceptionType);
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.ownerRole) qs.set("ownerRole", filters.ownerRole);
  if (filters.limit) qs.set("limit", String(filters.limit));
  const res = await fetch(`/api/exceptions${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<ExceptionRow[]>(res);
}

export async function fetchException(id: number): Promise<ExceptionRow> {
  const res = await fetch(`/api/exceptions/${id}`, { credentials: "include" });
  return jsonOrThrow<ExceptionRow>(res);
}

export async function postEvaluate(body: { facilityId?: string | null; testType?: string | null }): Promise<{ detected: number; refreshed: number; superseded: number }> {
  const res = await fetch(`/api/exceptions/evaluate`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function postEvaluateAll(): Promise<{ detected: number; refreshed: number; superseded: number }> {
  const res = await fetch(`/api/exceptions/evaluate-all-safe`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}

// PR 3.3 client functions.
export async function postAcknowledge(id: number) {
  const res = await fetch(`/api/exceptions/${id}/acknowledge`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}
export async function postAssign(id: number, body: { assignedToUserId?: string; assignedRole?: string }) {
  const res = await fetch(`/api/exceptions/${id}/assign`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}
export async function postNote(id: number, note: string) {
  const res = await fetch(`/api/exceptions/${id}/note`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
  });
  return jsonOrThrow(res);
}
export async function postDismiss(id: number, reason: string) {
  const res = await fetch(`/api/exceptions/${id}/dismiss`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
  });
  return jsonOrThrow(res);
}
export async function postResolve(id: number, reason: string) {
  const res = await fetch(`/api/exceptions/${id}/resolve`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
  });
  return jsonOrThrow(res);
}
export async function postReopen(id: number) {
  const res = await fetch(`/api/exceptions/${id}/reopen`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}
export async function fetchReviewEvents(id: number) {
  const res = await fetch(`/api/exceptions/${id}/review-events`, { credentials: "include" });
  return jsonOrThrow(res);
}

export const SEVERITY_TONE: Record<string, string> = {
  info: "bg-slate-50 text-slate-700",
  low: "bg-blue-50 text-blue-800",
  medium: "bg-amber-50 text-amber-900",
  high: "bg-rose-50 text-rose-900",
  critical: "bg-red-100 text-red-900",
};
