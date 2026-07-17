// QuickNoteTool — Phase 2 PR 2.6.
//
// Left-rail tool. Lets a PCS/ACS operator write a Quick Note attached
// to a patient. We accept the patient context via a search input that
// hits /api/patient-directory/search; once a patient is picked the
// user types a note and submits. The note persists through
// /api/patient-notes — no local-only state, no fake save.
//
// The tool does not show patient detail. Detail belongs in the
// center canvas. The left-rail tool is a general writer surface.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, NotebookPen, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { searchPatientDirectory } from "@/lib/patientDirectoryApi";
import { createPatientNote } from "@/lib/patientNotesApi";

type PickedPatient = { patientScreeningId: number; name: string };

export function QuickNoteTool() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [body, setBody] = useState("");

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["quick-note-search", q],
    queryFn: () => searchPatientDirectory(q),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("Pick a patient first");
      if (!body.trim()) throw new Error("Note body is required");
      return createPatientNote({
        patientScreeningId: picked.patientScreeningId,
        noteType: "quick_note",
        body: body.trim(),
      });
    },
    onSuccess: () => {
      toast({ title: "Note saved" });
      setBody("");
      queryClient.invalidateQueries({
        queryKey: ["patient-notes", picked?.patientScreeningId],
      });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save note", description: err.message, variant: "destructive" }),
  });

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-hidden p-4"
      data-testid="portal-quick-note"
    >
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <NotebookPen className="h-4 w-4 text-slate-500" /> Quick Note
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Write a quick operator note attached to a patient. Notes
          persist to /api/patient-notes and appear in the center
          patient canvas + Patient EHR.
        </div>
      </Card>

      {picked ? (
        <Card className="p-3 bg-white" data-testid="quick-note-selected-patient">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-900">
              For: <span className="font-medium">{picked.name}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPicked(null)}
              data-testid="quick-note-change-patient"
            >
              Change
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-3 bg-white space-y-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search patient by name…"
              className="h-8 text-xs"
              data-testid="quick-note-search"
            />
          </div>
          {isFetching ? (
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : hits.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic">
              {q.trim().length < 2 ? "Type at least 2 characters." : "No matches."}
            </div>
          ) : (
            <ul className="space-y-1">
              {hits.slice(0, 10).map((h) => (
                <li key={h.patientScreeningId}>
                  <button
                    type="button"
                    onClick={() => setPicked({ patientScreeningId: h.patientScreeningId, name: h.name })}
                    className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-100"
                    data-testid={`quick-note-pick-${h.patientScreeningId}`}
                  >
                    {h.name}
                    {h.dob ? ` · ${h.dob}` : ""}
                    {h.facility ? ` · ${h.facility}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-3 bg-white flex-1 min-h-0 flex flex-col">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={picked ? "Type your note…" : "Pick a patient first."}
          disabled={!picked || saveMutation.isPending}
          className="flex-1 min-h-[120px] text-sm"
          data-testid="quick-note-body"
        />
        <div className="mt-2 flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!picked || !body.trim() || saveMutation.isPending}
            data-testid="quick-note-save"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving…
              </>
            ) : (
              "Save note"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
