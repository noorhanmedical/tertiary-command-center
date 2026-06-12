// Engagement Center duplicate warning banner (Part 5 of activation
// continuation). Reads the assignment board, runs the visible patients
// through the live duplicate-warning engine, and renders the existing
// EngagementHandoffDuplicateBar above the board. Read-only.

import { useQuery } from "@tanstack/react-query";
import type { EngagementBoardRow } from "@shared/contracts/engagementBoard";
import { EngagementHandoffDuplicateBar } from "@/components/patient-directory/EngagementHandoffDuplicateBar";
import { useLiveDuplicateWarnings } from "@/lib/useLiveDuplicateWarnings";
import { PatientAuditTrailModal } from "@/components/patient-directory/PatientAuditTrailModal";
import { useState } from "react";

type BoardResponse = { rows: EngagementBoardRow[] };

export function EngagementDuplicateBanner() {
  const board = useQuery<BoardResponse>({
    queryKey: ["/api/engagement/assignment-board", "warning-bar"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/assignment-board", { credentials: "include" });
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const rows = (board.data?.rows ?? []).filter((r) => r.patientScreeningId != null);
  const currentPatients = rows.map((r) => ({
    patientScreeningId: r.patientScreeningId as number,
    patientName: r.patientName,
    identity: {
      name: r.patientName,
      facility: r.facility ?? null,
      dob: null,
      phoneNumber: null,
      mrn: null,
    },
  }));

  const warnings = useLiveDuplicateWarnings({ currentPatients });
  const [auditId, setAuditId] = useState<number | null>(null);
  const auditWarning = auditId != null ? warnings.byId[auditId] : null;
  const auditName = rows.find((r) => r.patientScreeningId === auditId)?.patientName ?? null;

  if (warnings.list.filter((r) => r.warnings.length > 0).length === 0) return null;

  return (
    <>
      <EngagementHandoffDuplicateBar
        results={warnings.list}
        onOpenAudit={(r) => setAuditId(r.patientScreeningId)}
      />
      <PatientAuditTrailModal
        open={auditId !== null}
        onOpenChange={(o) => !o && setAuditId(null)}
        patientScreeningId={auditId}
        patientName={auditName}
        warningResult={auditWarning}
        events={[]}
        endpointUnavailable={warnings.factsUnavailable}
      />
    </>
  );
}
