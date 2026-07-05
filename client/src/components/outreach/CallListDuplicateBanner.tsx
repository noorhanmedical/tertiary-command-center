// Team Portal call-list duplicate warning banner (Part 5 of activation
// continuation). Read-only — runs the visible call-list patients
// through useLiveDuplicateWarnings and renders the existing
// EngagementHandoffDuplicateBar above the panel header.

import { useState } from "react";
import { EngagementHandoffDuplicateBar } from "@/components/patient-directory/EngagementHandoffDuplicateBar";
import { useLiveDuplicateWarnings } from "@/lib/useLiveDuplicateWarnings";
import { PatientAuditTrailModal } from "@/components/patient-directory/PatientAuditTrailModal";
import type { CallListEntry } from "@/components/outreach/CallListPanel";

export function CallListDuplicateBanner({
  sortedCallList,
}: {
  sortedCallList: ReadonlyArray<CallListEntry>;
}) {
  const currentPatients = sortedCallList.map((e) => ({
    patientScreeningId: e.item.patientId,
    patientName: e.item.patientName,
    identity: {
      name: e.item.patientName,
      facility: null,
      dob: null,
      phoneNumber: null,
      mrn: null,
    },
  }));

  const warnings = useLiveDuplicateWarnings({ currentPatients });
  const [auditId, setAuditId] = useState<number | null>(null);
  if (warnings.list.filter((r) => r.warnings.length > 0).length === 0) return null;
  const auditWarning = auditId != null ? warnings.byId[auditId] : null;
  const auditName = sortedCallList.find((e) => e.item.patientId === auditId)?.item.patientName ?? null;

  return (
    <>
      <EngagementHandoffDuplicateBar
        title="Call list — Patient EHR warnings"
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
