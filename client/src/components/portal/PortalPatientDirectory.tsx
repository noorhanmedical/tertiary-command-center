import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { PatientProfileWorkspace } from "@/components/patient-directory/PatientProfileWorkspace";
import { PatientChartSkeleton } from "@/components/patient-directory/PatientChart";

type ResolveResponse = { encodedKey: string; name: string; dob: string | null };

/**
 * Portal wrapper that opens a patient's full Patient Directory EMR chart
 * (the same workspace rendered on the /patient-directory page) from the
 * portal call list, which only carries a patientScreeningId.
 *
 * It resolves the screening id -> roster encodedKey via the shared resolve
 * endpoint (cache key matches the directory page so the lookup is reused),
 * painting the seeded chart skeleton while the lookup is in flight.
 */
export function PortalPatientDirectory({
  patientScreeningId,
  seedName,
  onBack,
}: {
  patientScreeningId: number;
  seedName?: string | null;
  onBack?: () => void;
}) {
  const resolveQuery = useQuery<ResolveResponse>({
    queryKey: ["/api/patients/database/resolve", String(patientScreeningId)],
    queryFn: async () => {
      const res = await fetch(`/api/patients/database/resolve/${patientScreeningId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to resolve patient");
      return res.json();
    },
    enabled: patientScreeningId > 0,
    staleTime: 60_000,
    gcTime: 300_000,
  });

  if (patientScreeningId <= 0 || resolveQuery.isError) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm text-rose-700"
        data-testid="portal-patient-directory-error"
      >
        <AlertCircle className="h-4 w-4 mr-2" />
        {resolveQuery.error instanceof Error
          ? resolveQuery.error.message
          : "Failed to load patient"}
      </div>
    );
  }

  const encodedKey = resolveQuery.data?.encodedKey ?? null;
  const name = resolveQuery.data?.name ?? seedName ?? null;

  if (resolveQuery.isLoading || !encodedKey) {
    return <PatientChartSkeleton seedName={name} onBack={onBack} />;
  }

  return (
    <PatientProfileWorkspace
      key={encodedKey}
      encodedKey={encodedKey}
      representativeScreeningId={patientScreeningId}
      seedName={name}
      onBack={onBack}
    />
  );
}
