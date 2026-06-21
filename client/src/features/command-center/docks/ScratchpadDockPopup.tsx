import React, { useState } from "react";
import { NotebookPen, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import { PopupPatientPicker, type PickedPatient } from "../components/PopupPatientPicker";
import { fetchPatientNotes, createPatientNote, type PatientNoteRow } from "@/lib/patientNotesApi";
import { useToast } from "@/hooks/use-toast";

export function ScratchpadDockPopup() {
  const { profile } = useCommandCenter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [body, setBody] = useState("");

  const notesKey = ["patient-notes", picked?.patientScreeningId];

  const { data: notes = [], isLoading: notesLoading } = useQuery<PatientNoteRow[]>({
    queryKey: notesKey,
    queryFn: () => fetchPatientNotes({ patientScreeningId: picked!.patientScreeningId, limit: 10 }),
    enabled: !!picked,
    staleTime: 10_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("Select a patient first");
      if (!body.trim()) throw new Error("Note body is required");
      return createPatientNote({
        patientScreeningId: picked.patientScreeningId,
        noteType: "quick_note",
        body: body.trim(),
      });
    },
    onSuccess: () => {
      toast({ title: "Note saved", description: picked?.name });
      setBody("");
      queryClient.invalidateQueries({ queryKey: notesKey });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not save note",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  const context = {
    sourceSurface: profile.surface,
    componentType: "scratchpad" as const,
    patientName: picked?.name,
    title: "Scratchpad",
  };

  return (
    <PanelPopupCard title="Scratchpad" eyebrow="Notes" icon={<NotebookPen className="h-5 w-5" />} context={context}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto" data-testid="command-left-rail-scratchpad-panel">
        <PopupPatientPicker
          picked={picked}
          onPick={setPicked}
          onClear={() => setPicked(null)}
          placeholder="Search patient to attach a note…"
        />

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-24 w-full rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm outline-none focus:border-amber-300"
          placeholder={picked ? "Type a note…" : "Select a patient first"}
          disabled={!picked}
          data-testid="scratchpad-body"
        />
        <button
          type="button"
          disabled={!picked || !body.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          data-testid="scratchpad-save"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />}
          Save note
        </button>

        {picked ? (
          <div className="space-y-2">
            <div className="px-1 text-xs font-semibold text-slate-700">Recent notes</div>
            {notesLoading ? (
              <div className="px-1 py-2 text-xs text-slate-400">Loading notes…</div>
            ) : notes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">
                No notes yet for this patient.
              </div>
            ) : (
              notes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-2xl border border-slate-200 bg-white p-3"
                  data-testid={`scratchpad-note-${n.id}`}
                >
                  <div className="whitespace-pre-wrap text-xs text-slate-700">{n.body}</div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </PanelPopupCard>
  );
}
