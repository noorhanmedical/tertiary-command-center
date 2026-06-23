import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type DirectoryProfile } from "./profileTypes";
import { PatientChart } from "./PatientChart";
import {
  buildEmrChart, type RawExecutionCase, type RawCooldownRecord,
  type RawInsuranceReview, type RawAppointment, type RawCall,
  type RawDocument, type RawBillingRow, type RawScreeningDetail,
} from "./emrModel";

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
  const psid = representativeScreeningId;

  const documentsQuery = useQuery<RawDocument[]>({
    queryKey: ["/api/documents-library", { patientId: psid }],
    queryFn: () =>
      fetchJsonOrEmpty<RawDocument[]>(
        `/api/documents-library?patientId=${psid}`,
        (d) => (Array.isArray(d) ? d : d.documents ?? d.rows ?? []),
        [],
      ),
    enabled: !!psid,
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

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="profile-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!profile || !chart) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground" data-testid="profile-error">
        Failed to load patient profile.
      </div>
    );
  }

  return <PatientChart chart={chart} onBack={onBack} />;
}
