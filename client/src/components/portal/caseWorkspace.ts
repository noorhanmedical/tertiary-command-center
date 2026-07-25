import { useQuery } from "@tanstack/react-query";

// Shared types + helpers for the call-list → Playground case workflows
// (Patient / Call / Schedule / Case Overview tabs). Everything here is
// derived from existing endpoints and the call-list row shape — no new
// source of truth.

export type CallCaseContext = {
  patientScreeningId: number | null;
  executionCaseId: number | null;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  callReason: string;
  /** Target ancillary/workflow services on the execution case. */
  targetServices: string[];
  // Phase 2E-B3 — EXACT ancillary-case identity for the selected case. Only
  // set when the source row unambiguously carries a Phase 2B ancillary-case
  // id (one case = one service). When null, canonical document surfaces
  // render NOTHING and issue NO screening-wide request (no case guessing).
  ancillaryCaseId: number | null;
  /** The single service for the selected ancillary case, when known. */
  serviceType: string | null;
  /** Originating workspace — "ACS" / "PCS" (workspaceRole). */
  sourcePortal: string;
  engagementStatus: string | null;
  lifecycleStatus: string | null;
};

// Appointment / test types offered by the scheduling workspace. The first
// eight are the AI-qualifying ancillary tests; the trailing items are
// follow-up workflow types requested for the Zocdoc-style scheduler.
export const ANCILLARY_SERVICE_OPTIONS: string[] = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
];

export const APPOINTMENT_TYPES: string[] = [
  "BrainWave",
  "VitalWave",
  "Ultrasound",
  "Follow-up call",
  "Document follow-up",
  "Order follow-up",
  "Patient callback",
];

// 8:00 AM – 4:30 PM in 30-minute steps.
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function combineLocalDateAndTimeToIso(
  date: string,
  time: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function prettyTime(time: string): string {
  const iso = combineLocalDateAndTimeToIso(todayIso(), time);
  if (!iso) return time;
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// True when RingCentral click-to-call is enabled for this build. When OFF
// the call workspaces render an honest "RingCentral connection required"
// boundary instead of pretending a call was placed.
export function isRingCentralClickToCallEnabled(): boolean {
  const v = import.meta.env.VITE_USE_RINGCENTRAL_CLICK_TO_CALL;
  return v === "true" || v === "1" || v === true;
}

export type CaseProofDoc = {
  id: number;
  title: string;
  kind: string;
  filename: string;
  contentType: string;
  createdAt: string | null;
  downloadUrl: string | null;
};

// Fetch the canonical document-library rows for a patient and classify the
// Clinician PDF / Plexus PDF proof documents that explain why the patient is
// being called. Returns nulls (not fakes) when documents are missing.
export function useCaseProofDocs(patientScreeningId: number | null) {
  const enabled = typeof patientScreeningId === "number" && patientScreeningId > 0;
  const query = useQuery<CaseProofDoc[]>({
    queryKey: ["/api/documents-library", { patientId: patientScreeningId }],
    queryFn: async () => {
      const u = new URL("/api/documents-library", window.location.origin);
      u.searchParams.set("patientId", String(patientScreeningId));
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? (body as CaseProofDoc[]) : [];
    },
    enabled,
  });

  const all = query.data ?? [];
  const matches = (doc: CaseProofDoc, needles: string[]): boolean => {
    const hay = `${doc.kind ?? ""} ${doc.title ?? ""} ${doc.filename ?? ""}`.toLowerCase();
    return needles.some((n) => hay.includes(n));
  };

  const clinicianPdf =
    all.find((d) => matches(d, ["clinician_pdf", "clinician"])) ??
    all.find((d) => matches(d, ["report"])) ??
    null;
  const plexusPdf =
    all.find((d) => matches(d, ["plexus"])) ?? null;

  return {
    all,
    clinicianPdf,
    plexusPdf,
    isLoading: enabled ? query.isLoading : false,
    isError: query.isError,
  };
}
