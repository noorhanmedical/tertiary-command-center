// Thin fetch helpers for the Plexus IQ Recently Deleted card.
//
// Reads soft-deleted patient_screenings rows within the 14-day restore
// window, and restores one via the canonical commit/patient routes.
// No new backend tables — these helpers wrap two endpoints added on
// top of the existing patient_screenings infrastructure:
//
//   GET  /api/patient-screenings/recently-deleted
//   POST /api/patient-screenings/:id/restore

export type RecentlyDeletedPatient = {
  id: number;
  batchId: number;
  name: string;
  dob: string | null;
  facility: string | null;
  patientType: string | null;
  status: string | null;
  deletedAt: string | null;
  deleteExpiresAt: string | null;
  deleteReason: string | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url} (status ${res.status})`);
  }
  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export async function fetchPlexusIqRecentlyDeleted(
  limit: number = 100,
): Promise<RecentlyDeletedPatient[]> {
  return getJson<RecentlyDeletedPatient[]>(
    `/api/patient-screenings/recently-deleted?limit=${limit}`,
  );
}

export async function restorePlexusIqDeletedPatient(
  patientId: number,
): Promise<{ ok: boolean; alreadyActive?: boolean }> {
  return postJson(`/api/patient-screenings/${patientId}/restore`);
}
