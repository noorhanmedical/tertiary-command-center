// PatientNotesPanel — Phase 2 PR 2.6
//
// Renders the canonical patient notes for a patient in the center
// canvas. Read-only here: writing goes through QuickNoteTool +
// future ACS/admin paths.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, NotebookPen } from "lucide-react";
import { fetchPatientNotes, type PatientNoteRow } from "@/lib/patientNotesApi";

type Props = { patientScreeningId: number };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function PatientNotesPanel({ patientScreeningId }: Props) {
  const { data: notes = [], isLoading, isError } = useQuery<PatientNoteRow[]>({
    queryKey: ["patient-notes", patientScreeningId],
    queryFn: () => fetchPatientNotes({ patientScreeningId, limit: 50 }),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="p-3 bg-white" data-testid="patient-notes-panel-loading">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading notes…
        </div>
      </Card>
    );
  }
  if (isError) return null;
  if (notes.length === 0) return null;

  return (
    <Card className="p-3 bg-white" data-testid="patient-notes-panel">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <NotebookPen className="h-4 w-4 text-slate-500" /> Notes ({notes.length})
      </div>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded border border-slate-100 bg-slate-50/40 p-2"
            data-testid={`patient-note-${n.id}`}
          >
            <div className="text-[12px] text-slate-800 whitespace-pre-wrap">{n.body}</div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
              <span>{n.noteType.replace(/_/g, " ")}</span>
              <span>{formatDate(n.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
