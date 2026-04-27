import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchCaseDocumentReadiness,
  caseDocumentReadinessQueryKey,
  fetchProcedureNotes,
  procedureNotesQueryKey,
  type CaseDocumentReadiness,
  type ProcedureNote,
} from "@/lib/workflow/documentReadinessApi";

const TRACKED_DOC_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  "billing_document",
] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  informed_consent: "Consent",
  screening_form: "Screening",
  report: "Report",
  order_note: "Order Note",
  post_procedure_note: "Post-Procedure Note",
  billing_document: "Billing Document",
};

function statusTone(status: string): { className: string; label: string } {
  switch (status) {
    case "approved":
    case "completed":
    case "uploaded":
    case "generated":
      return { className: "bg-emerald-50 text-emerald-700 border-emerald-200", label: status };
    case "pending":
      return { className: "bg-amber-50 text-amber-700 border-amber-200", label: status };
    case "blocked":
      return { className: "bg-red-50 text-red-700 border-red-200", label: status };
    case "missing":
      return { className: "bg-slate-50 text-slate-600 border-slate-200", label: status };
    case "not_required":
      return { className: "bg-slate-50 text-slate-400 border-slate-200", label: "n/a" };
    default:
      return { className: "bg-slate-50 text-slate-600 border-slate-200", label: status || "—" };
  }
}

type GroupKey = string;
type Group = {
  key: GroupKey;
  patientName: string;
  serviceType: string;
  facilityId: string | null;
  rows: CaseDocumentReadiness[];
  noteByType: Map<string, ProcedureNote>;
};

function groupKey(row: CaseDocumentReadiness): GroupKey {
  return `${row.patientScreeningId ?? row.executionCaseId ?? "?"}::${row.serviceType}`;
}

export function DocumentReadinessPanel() {
  const { data: readinessRows = [], isLoading } = useQuery<CaseDocumentReadiness[]>({
    queryKey: caseDocumentReadinessQueryKey({ limit: 200 }),
    queryFn: () => fetchCaseDocumentReadiness({ limit: 200 }),
    staleTime: 30_000,
  });

  const { data: noteRows = [] } = useQuery<ProcedureNote[]>({
    queryKey: procedureNotesQueryKey({ limit: 200 }),
    queryFn: () => fetchProcedureNotes({ limit: 200 }),
    staleTime: 30_000,
  });

  const groups = useMemo<Group[]>(() => {
    if (readinessRows.length === 0) return [];
    const map = new Map<GroupKey, Group>();
    for (const row of readinessRows) {
      const key = groupKey(row);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          patientName: row.patientName ?? "Unknown patient",
          serviceType: row.serviceType,
          facilityId: row.facilityId,
          rows: [],
          noteByType: new Map(),
        };
        map.set(key, g);
      }
      g.rows.push(row);
    }

    // Attach procedure notes (matched by patientScreeningId + serviceType)
    for (const note of noteRows) {
      for (const g of map.values()) {
        const sample = g.rows[0];
        if (
          sample &&
          sample.patientScreeningId != null &&
          note.patientScreeningId === sample.patientScreeningId &&
          note.serviceType === g.serviceType
        ) {
          g.noteByType.set(note.noteType, note);
        }
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.patientName.localeCompare(b.patientName),
    );
  }, [readinessRows, noteRows]);

  if (isLoading) return null;
  if (groups.length === 0) return null;

  return (
    <Card
      className="mb-4 rounded-2xl border-slate-200 shadow-sm"
      data-testid="document-readiness-panel"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <ClipboardCheck className="h-4 w-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-slate-800">Document Readiness</h2>
        <Badge variant="outline" className="ml-2 rounded-full px-2 py-0 text-[10px]">
          {groups.length}
        </Badge>
        <span className="ml-auto text-[11px] text-slate-400">
          Canonical readiness from procedure events
        </span>
      </div>
      <div className="space-y-2 px-5 py-4">
        {groups.map((g) => {
          const rowByType = new Map<string, CaseDocumentReadiness>();
          for (const r of g.rows) rowByType.set(r.documentType, r);
          return (
            <div
              key={g.key}
              className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
              data-testid={`readiness-group-${g.key}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{g.patientName}</span>
                <span className="text-xs text-slate-500">· {g.serviceType}</span>
                {g.facilityId && <span className="text-xs text-slate-400">· {g.facilityId}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TRACKED_DOC_TYPES.map((dt) => {
                  const row = rowByType.get(dt);
                  // For notes, prefer the procedure note's generationStatus when
                  // it's further along than the readiness row's status.
                  let displayStatus = row?.documentStatus ?? "missing";
                  if (dt === "order_note" || dt === "post_procedure_note") {
                    const note = g.noteByType.get(dt);
                    if (note) {
                      const noteStatusRank: Record<string, number> = {
                        pending: 1, generating: 2, generated: 3, failed: 1, approved: 4,
                      };
                      const docStatusRank: Record<string, number> = {
                        missing: 0, pending: 1, blocked: 0, uploaded: 3, generated: 3, completed: 3, approved: 4, not_required: 0,
                      };
                      if ((noteStatusRank[note.generationStatus] ?? 0) > (docStatusRank[displayStatus] ?? 0)) {
                        displayStatus = note.generationStatus;
                      }
                    }
                  }
                  const tone = statusTone(displayStatus);
                  return (
                    <div
                      key={dt}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${tone.className}`}
                      data-testid={`readiness-${g.key}-${dt}`}
                    >
                      <span className="font-medium">{DOC_TYPE_LABELS[dt]}</span>
                      <span className="text-[10px] opacity-80">{tone.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
