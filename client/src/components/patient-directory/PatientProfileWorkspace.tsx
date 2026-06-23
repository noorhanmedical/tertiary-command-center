import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PatientProfileHeader, type ProfileBadgeFlags } from "./PatientProfileHeader";
import { PatientProfileTabs, type LibraryDoc, type BillingRow, type CallRow } from "./PatientProfileTabs";
import { type DirectoryProfile } from "./profileTypes";

const NEEDS_FOLLOW_UP = new Set([
  "no_answer", "callback", "needs_follow_up", "follow_up", "pending", "not_booked", "declined",
]);

async function fetchJsonOrEmpty<T>(url: string, pick: (d: any) => T, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return fallback;
    return pick(await res.json());
  } catch {
    return fallback;
  }
}

export function PatientProfileWorkspace({
  encodedKey,
  representativeScreeningId,
  onBack,
}: {
  encodedKey: string;
  representativeScreeningId: number | null;
  onBack?: () => void;
}) {
  const profileQuery = useQuery<DirectoryProfile>({
    queryKey: ["/api/patients/database", encodedKey],
    queryFn: async () => {
      const res = await fetch(`/api/patients/database/${encodedKey}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient profile");
      return res.json();
    },
    enabled: !!encodedKey,
  });

  const profile = profileQuery.data;
  const patientName = profile?.identity.name ?? "";

  const documentsQuery = useQuery<LibraryDoc[]>({
    queryKey: ["/api/documents-library", { patientId: representativeScreeningId }],
    queryFn: () =>
      fetchJsonOrEmpty<LibraryDoc[]>(
        `/api/documents-library?patientId=${representativeScreeningId}`,
        (d) => (Array.isArray(d) ? d : d.documents ?? d.rows ?? []),
        [],
      ),
    enabled: !!representativeScreeningId,
  });

  const callsQuery = useQuery<CallRow[]>({
    queryKey: ["/api/portal/calls", { patientScreeningId: representativeScreeningId }],
    queryFn: () =>
      fetchJsonOrEmpty<CallRow[]>(
        `/api/portal/calls?patientScreeningId=${representativeScreeningId}`,
        (d) => (Array.isArray(d) ? d : d.calls ?? d.rows ?? []),
        [],
      ),
    enabled: !!representativeScreeningId,
  });

  const billingQuery = useQuery<BillingRow[]>({
    queryKey: ["/api/billing-records/search", { q: patientName }],
    queryFn: () =>
      fetchJsonOrEmpty<BillingRow[]>(
        `/api/billing-records/search?q=${encodeURIComponent(patientName)}&limit=100`,
        (d) => {
          const rows: BillingRow[] = Array.isArray(d) ? d : d.rows ?? [];
          const target = patientName.trim().toLowerCase();
          return rows.filter((r) => (r.patientName ?? "").trim().toLowerCase() === target);
        },
        [],
      ),
    enabled: !!patientName,
  });

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="profile-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground" data-testid="profile-error">
        Failed to load patient profile.
      </div>
    );
  }

  const documents = documentsQuery.data ?? [];
  const calls = callsQuery.data ?? [];
  const billing = billingQuery.data ?? [];

  const flags: ProfileBadgeFlags = {
    callDue: calls.some((c) => !!c.callbackAt && c.callbackAt.slice(0, 10) <= new Date().toISOString().slice(0, 10)),
    needsFollowUp: profile.screenings.some((s) => NEEDS_FOLLOW_UP.has((s.appointmentStatus || "").toLowerCase())),
    billingReady: billing.some((r) => (r.billingStatus || "Not Billed").toLowerCase() !== "not billed"),
  };

  return (
    <div className="flex flex-col h-full" data-testid="profile-workspace">
      <PatientProfileHeader profile={profile} flags={flags} onBack={onBack} />
      <div className="flex-1 min-h-0">
        <PatientProfileTabs
          profile={profile}
          documents={documents}
          documentsLoading={documentsQuery.isLoading}
          billing={billing}
          billingLoading={billingQuery.isLoading}
          calls={calls}
          callsLoading={callsQuery.isLoading}
        />
      </div>
    </div>
  );
}
