import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type DirectoryProfile } from "./profileTypes";
import { PatientChart, PatientChartSkeleton } from "./PatientChart";
import {
  buildEmrChart, type RawExecutionCase, type RawCooldownRecord,
  type RawInsuranceReview, type RawAppointment, type RawCall,
  type RawDocument, type RawBillingRow, type RawScreeningDetail,
} from "./emrModel";

// Patient-tab cache: keep a profile's data fresh for a minute and resident for
// five so re-opening the same patient (tab switch / call-list re-click) paints
// instantly from cache instead of refetching.
const CACHE = { staleTime: 60_000, gcTime: 300_000 } as const;

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
  seedName,
  onBack,
  onSchedule,
}: {
  encodedKey: string;
  representativeScreeningId: number | null;
  /** Name from the call-list/roster context, shown instantly in the shell. */
  seedName?: string | null;
  onBack?: () => void;
  /** Opens the in-portal scheduling dialog (calendar popup) for this patient. */
  onSchedule?: () => void;
}) {
  // Heavy, cleanly-independent sections fetch only once scrolled into view.
  const [documentsWanted, setDocumentsWanted] = useState(false);
  const handleVisible = useCallback((ids: string[]) => {
    if (ids.includes("documents")) setDocumentsWanted((w) => w || true);
  }, []);

  const profileQuery = useQuery<DirectoryProfile>({
    queryKey: ["/api/patients/database", encodedKey],
    queryFn: async () => {
      const res = await fetch(`/api/patients/database/${encodedKey}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patient profile");
      return res.json();
    },
    enabled: !!encodedKey,
    ...CACHE,
  });

  const profile = profileQuery.data;
  const patientName = profile?.identity.name ?? "";
  const psid = representativeScreeningId;

  const documentsQuery = useQuery<RawDocument[]>({
    queryKey: ["/api/documents-library", { patientId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawDocument[]>(
        `/api/documents-library?patientId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.documents ?? d.rows ?? []),
        [],
      ),
    enabled: !!psid && documentsWanted,
    ...CACHE,
  });

  const callsQuery = useQuery<RawCall[]>({
    queryKey: ["/api/portal/calls", { patientScreeningId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawCall[]>(
        `/api/portal/calls?patientScreeningId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.calls ?? d.rows ?? []),
        [],
      ),
    enabled: !!psid,
    ...CACHE,
  });

  const billingQuery = useQuery<RawBillingRow[]>({
    queryKey: ["/api/billing-records/search", { q: patientName }],
    queryFn: () =>
      fetchJsonOrEmpty<RawBillingRow[]>(
        `/api/billing-records/search?q=${encodeURIComponent(patientName)}&limit=100`,
        (d) => {
          const rows: any[] = Array.isArray(d) ? d : d.rows ?? [];
          const target = patientName.trim().toLowerCase();
          return rows.filter((r) => (r.patientName ?? "").trim().toLowerCase() === target);
        },
        [],
      ),
    enabled: !!patientName,
    ...CACHE,
  });

  const executionCasesQuery = useQuery<RawExecutionCase[]>({
    queryKey: ["/api/execution-cases", { patientScreeningId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawExecutionCase[]>(
        `/api/execution-cases?patientScreeningId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.rows ?? []),
        [],
      ),
    enabled: !!psid,
    ...CACHE,
  });

  // The provider (clinician) name + the report batch id live on the schedule
  // batch, not on the patient_screening row. Use the representative screening's
  // batch so the header can show a provider and the Documents section can link
  // the Clinician/Plexus PDFs.
  const repBatchId = useMemo(() => {
    const screenings = profile?.screenings ?? [];
    if (!screenings.length) return null;
    const match = psid != null ? screenings.find((s) => s.id === psid) : undefined;
    return (match ?? screenings[0]).batchId ?? null;
  }, [profile, psid]);

  const batchQuery = useQuery<{ provider: string | null; batchId: number | null }>({
    queryKey: ["/api/screening-batches", repBatchId],
    queryFn: () =>
      fetchJsonOrEmpty<{ provider: string | null; batchId: number | null }>(
        `/api/screening-batches/${repBatchId}`,
        (d) => ({ provider: d?.clinicianName ?? null, batchId: d?.id ?? repBatchId }),
        { provider: null, batchId: repBatchId },
      ),
    enabled: repBatchId != null,
    ...CACHE,
  });

  const cooldownRecordsQuery = useQuery<RawCooldownRecord[]>({
    queryKey: ["/api/cooldown-records", { patientScreeningId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawCooldownRecord[]>(
        `/api/cooldown-records?patientScreeningId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.rows ?? []),
        [],
      ),
    enabled: !!psid,
    ...CACHE,
  });

  const insuranceQuery = useQuery<RawInsuranceReview[]>({
    queryKey: ["/api/insurance-eligibility-reviews", { patientScreeningId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawInsuranceReview[]>(
        `/api/insurance-eligibility-reviews?patientScreeningId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.rows ?? []),
        [],
      ),
    enabled: !!psid,
    ...CACHE,
  });

  const appointmentsQuery = useQuery<RawAppointment[]>({
    queryKey: ["/api/appointments/patient", psid],
    queryFn: () =>
      fetchJsonOrEmpty<RawAppointment[]>(
        `/api/appointments/patient/${psid}`,
        (d) => (Array.isArray(d) ? d : d.rows ?? []),
        [],
      ),
    enabled: !!psid,
    ...CACHE,
  });

  const screeningDetailQuery = useQuery<RawScreeningDetail>({
    queryKey: ["/api/patients", psid],
    queryFn: () =>
      fetchJsonOrEmpty<RawScreeningDetail>(
        `/api/patients/${psid}`,
        (d) => d ?? null,
        null,
      ),
    enabled: !!psid,
    ...CACHE,
  });

  const chart = useMemo(() => {
    if (!profile) return null;
    return buildEmrChart({
      profile,
      patientScreeningId: psid,
      executionCases: executionCasesQuery.data ?? [],
      cooldownRecords: cooldownRecordsQuery.data ?? [],
      insuranceReviews: insuranceQuery.data ?? [],
      appointments: appointmentsQuery.data ?? [],
      calls: callsQuery.data ?? [],
      documents: documentsQuery.data ?? [],
      billing: billingQuery.data ?? [],
      screeningDetail: screeningDetailQuery.data ?? null,
      provider: batchQuery.data?.provider ?? null,
      reportBatchId: batchQuery.data?.batchId ?? repBatchId,
    });
  }, [
    profile, psid, executionCasesQuery.data, cooldownRecordsQuery.data,
    insuranceQuery.data, appointmentsQuery.data, callsQuery.data,
    documentsQuery.data, billingQuery.data, screeningDetailQuery.data,
    batchQuery.data, repBatchId,
  ]);

  // Per-section skeletons: a section shows a placeholder until its own backing
  // query resolves, so the chart hydrates progressively instead of blanking.
  const loadingSections = useMemo(() => {
    const s = new Set<string>();
    if (executionCasesQuery.isLoading) s.add("execution-cases");
    if (callsQuery.isLoading) s.add("calls");
    if (appointmentsQuery.isLoading) s.add("scheduling");
    if (billingQuery.isLoading) s.add("billing");
    if (insuranceQuery.isLoading) s.add("insurance");
    if (cooldownRecordsQuery.isLoading) s.add("cooldown");
    if (screeningDetailQuery.isLoading) s.add("plexus-iq");
    if (documentsWanted && !documentsQuery.isFetched) s.add("documents");
    return s;
  }, [
    executionCasesQuery.isLoading, callsQuery.isLoading, appointmentsQuery.isLoading,
    billingQuery.isLoading, insuranceQuery.isLoading, cooldownRecordsQuery.isLoading,
    screeningDetailQuery.isLoading, documentsWanted, documentsQuery.isFetched,
  ]);

  // No full-page spinner: paint the chart frame immediately with the seeded
  // name while the summary (profile) loads.
  if (!profile || !chart) {
    if (profileQuery.isError) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground" data-testid="profile-error">
          Failed to load patient profile.
        </div>
      );
    }
    return <PatientChartSkeleton seedName={seedName} onBack={onBack} />;
  }

  return (
    <PatientChart
      chart={chart}
      onBack={onBack}
      onSchedule={onSchedule}
      loadingSections={loadingSections}
      onVisibleSectionsChange={handleVisible}
    />
  );
}
