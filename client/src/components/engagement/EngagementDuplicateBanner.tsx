// Engagement Center duplicate warning banner (Part 5 of activation
// continuation). Reads the assignment board, runs the visible patients
// through the live duplicate-warning engine, and renders a slim,
// dismissible strip above the board. Expanding it reveals the full
// EngagementHandoffDuplicateBar. Read-only.

import { useQuery } from "@tanstack/react-query";
import type { EngagementBoardRow } from "@shared/contracts/engagementBoard";
import { EngagementHandoffDuplicateBar } from "@/components/patient-directory/EngagementHandoffDuplicateBar";
import { useLiveDuplicateWarnings } from "@/lib/useLiveDuplicateWarnings";
import { PatientAuditTrailModal } from "@/components/patient-directory/PatientAuditTrailModal";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";

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
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const auditWarning = auditId != null ? warnings.byId[auditId] : null;
  const auditName = rows.find((r) => r.patientScreeningId === auditId)?.patientName ?? null;

  const flagged = warnings.list.filter((r) => r.warnings.length > 0);
  if (flagged.length === 0 || dismissed) return null;
  const blockedCount = flagged.filter((r) => r.blockedFromOutreach).length;

  return (
    <>
      <div
        className={`rounded-lg border text-[12px] ${
          blockedCount > 0
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
        data-testid="engagement-duplicate-banner"
        data-expanded={expanded ? "true" : "false"}
      >
        {/* Slim strip — one line, expandable + dismissible. */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium"
            aria-expanded={expanded}
            data-testid="button-engagement-duplicate-banner-toggle"
          >
            <span className="truncate">
              {flagged.length} patient{flagged.length === 1 ? "" : "s"} flagged
              {blockedCount > 0 ? ` · ${blockedCount} blocked` : ""}
            </span>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss duplicate warnings"
            title="Dismiss"
            data-testid="button-engagement-duplicate-banner-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {expanded && (
          <div className="border-t border-black/10 px-3 py-2">
            <EngagementHandoffDuplicateBar
              results={warnings.list}
              onOpenAudit={(r) => setAuditId(r.patientScreeningId)}
            />
          </div>
        )}
      </div>
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
