import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, FileText, Building2, Calendar, ChevronDown, ChevronRight, Copy, Printer, Trash2, RefreshCw } from "lucide-react";

type NoteSection = { heading: string; body: string };
type GeneratedNote = {
  id: number;
  patientId: number;
  batchId: number;
  facility: string | null;
  scheduleDate: string | null;
  patientName: string;
  service: string;
  docKind: string;
  title: string;
  sections: NoteSection[];
  generatedAt: string;
};

type PatientGroup = {
  patientName: string;
  patientId: number;
  notes: GeneratedNote[];
};

type DateGroup = {
  scheduleDate: string | null;
  patients: PatientGroup[];
};

type FacilityGroup = {
  facility: string;
  dates: DateGroup[];
};

function groupNotes(notes: GeneratedNote[]): FacilityGroup[] {
  const facilityMap = new Map<string, Map<string, Map<number, { name: string; notes: GeneratedNote[] }>>>();

  for (const note of notes) {
    const facility = note.facility || "Unknown Facility";
    const date = note.scheduleDate || "Unknown Date";

    if (!facilityMap.has(facility)) facilityMap.set(facility, new Map());
    const dateMap = facilityMap.get(facility)!;

    if (!dateMap.has(date)) dateMap.set(date, new Map());
    const patientMap = dateMap.get(date)!;

    if (!patientMap.has(note.patientId)) patientMap.set(note.patientId, { name: note.patientName, notes: [] });
    patientMap.get(note.patientId)!.notes.push(note);
  }

  const result: FacilityGroup[] = [];
  for (const [facility, dateMap] of Array.from(facilityMap.entries())) {
    const dates: DateGroup[] = [];
    for (const [scheduleDate, patientMap] of Array.from(dateMap.entries())) {
      const patients: PatientGroup[] = [];
      for (const [patientId, { name, notes }] of Array.from(patientMap.entries())) {
        patients.push({ patientId, patientName: name, notes });
      }
      patients.sort((a, b) => a.patientName.localeCompare(b.patientName));
      dates.push({ scheduleDate, patients });
    }
    dates.sort((a, b) => {
      if (!a.scheduleDate) return 1;
      if (!b.scheduleDate) return -1;
      return b.scheduleDate.localeCompare(a.scheduleDate);
    });
    result.push({ facility, dates });
  }
  result.sort((a, b) => a.facility.localeCompare(b.facility));
  return result;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr || dateStr === "Unknown Date") return "Unknown Date";
  const [yyyy, mm, dd] = dateStr.split("-").map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const SERVICE_COLORS: Record<string, string> = {
  BrainWave: "bg-purple-100 text-purple-700 border-purple-200",
  VitalWave: "bg-red-100 text-red-700 border-red-200",
  Ultrasound: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PGx: "bg-blue-100 text-blue-700 border-blue-200",
};

const DOC_KIND_LABELS: Record<string, string> = {
  preProcedureOrder: "Pre-Procedure Order",
  postProcedureNote: "Post-Procedure Note",
  billing: "Billing Document",
  screening: "Screening",
};

export default function DocumentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedFacilities, setExpandedFacilities] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedPatients, setExpandedPatients] = useState<Set<number>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());

  const { data: notes = [], isLoading } = useQuery<GeneratedNote[]>({
    queryKey: ["/api/generated-notes"],
  });

  const deletePatientNotesMutation = useMutation({
    mutationFn: async (patientId: number) => {
      await apiRequest("DELETE", `/api/generated-notes/patient/${patientId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      toast({ title: "Notes deleted" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to delete", description: e.message, variant: "destructive" });
    },
  });

  const toggleFacility = (f: string) => {
    setExpandedFacilities((prev) => {
      const s = new Set(prev);
      if (s.has(f)) s.delete(f);
      else s.add(f);
      return s;
    });
  };

  const toggleDate = (key: string) => {
    setExpandedDates((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  };

  const togglePatient = (id: number) => {
    setExpandedPatients((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const toggleNote = (id: number) => {
    setExpandedNotes((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const copyNote = (note: GeneratedNote) => {
    const text = note.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: `${note.title} copied to clipboard.` });
    });
  };

  const grouped = groupNotes(notes);

  return (
    <main className="flex-1 overflow-y-auto bg-[hsl(210,35%,96%)]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:text-slate-900" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
              Home
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <FileText className="w-7 h-7 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clinical Notes</h1>
            <p className="text-sm text-slate-500 mt-0.5">Auto-generated notes organized by clinic, date, and patient</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <Card className="p-10 text-center rounded-2xl border-dashed border-slate-200">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No clinical notes yet</p>
            <p className="text-sm text-slate-400 mt-1">Notes are automatically generated when a patient appointment is marked as Completed.</p>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="documents-list">
            {grouped.map((fg) => (
              <Card key={fg.facility} className="rounded-2xl border-slate-200 shadow-sm overflow-hidden" data-testid={`facility-group-${fg.facility}`}>
                <button
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                  onClick={() => toggleFacility(fg.facility)}
                  data-testid={`button-facility-${fg.facility}`}
                >
                  <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="font-semibold text-slate-800 flex-1">{fg.facility}</span>
                  <span className="text-xs text-slate-400 mr-2">{fg.dates.reduce((n, d) => n + d.patients.length, 0)} patients</span>
                  {expandedFacilities.has(fg.facility) ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {expandedFacilities.has(fg.facility) && (
                  <div className="border-t border-slate-100">
                    {fg.dates.map((dg) => {
                      const dateKey = `${fg.facility}::${dg.scheduleDate}`;
                      return (
                        <div key={dateKey} className="border-b border-slate-100 last:border-b-0">
                          <button
                            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-slate-50/80 transition-colors text-left"
                            onClick={() => toggleDate(dateKey)}
                            data-testid={`button-date-${dateKey}`}
                          >
                            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-sm font-medium text-slate-700 flex-1">{formatDate(dg.scheduleDate)}</span>
                            <span className="text-xs text-slate-400 mr-2">{dg.patients.length} patients</span>
                            {expandedDates.has(dateKey) ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>

                          {expandedDates.has(dateKey) && (
                            <div className="px-4 pb-3 space-y-2">
                              {dg.patients.map((pg) => (
                                <div key={pg.patientId} className="rounded-xl border border-slate-100 bg-white overflow-hidden" data-testid={`patient-notes-${pg.patientId}`}>
                                  <div
                                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
                                    onClick={() => togglePatient(pg.patientId)}
                                    data-testid={`button-patient-${pg.patientId}`}
                                  >
                                    <span className="font-medium text-sm text-slate-800 flex-1">{pg.patientName}</span>
                                    <span className="text-xs text-slate-400 mr-2">{pg.notes.length} docs</span>
                                    <button
                                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete all notes for ${pg.patientName}?`)) {
                                          deletePatientNotesMutation.mutate(pg.patientId);
                                        }
                                      }}
                                      data-testid={`button-delete-notes-${pg.patientId}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    {expandedPatients.has(pg.patientId) ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                    )}
                                  </div>

                                  {expandedPatients.has(pg.patientId) && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                                      {pg.notes.map((note) => (
                                        <div key={note.id} className="px-4" data-testid={`note-${note.id}`}>
                                          <div
                                            className="flex items-center gap-2 py-2 cursor-pointer hover:bg-slate-50/60 transition-colors -mx-4 px-4 rounded"
                                            onClick={() => toggleNote(note.id)}
                                          >
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SERVICE_COLORS[note.service] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                                              {note.service}
                                            </span>
                                            <span className="text-xs text-slate-600 flex-1">{DOC_KIND_LABELS[note.docKind] || note.docKind}</span>
                                            <button
                                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                              onClick={(e) => { e.stopPropagation(); copyNote(note); }}
                                              data-testid={`button-copy-note-${note.id}`}
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                            <button
                                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const content = note.sections.map((s) => `<p style="margin:0 0 6px"><strong>${s.heading}:</strong> ${s.body}</p>`).join("");
                                                const html = `<!DOCTYPE html><html><head><title>${note.title}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;}</style></head><body><h3>${note.title}</h3><hr>${content}</body></html>`;
                                                const w = window.open("", "_blank");
                                                if (w) { w.document.write(html); w.document.close(); w.print(); }
                                              }}
                                              data-testid={`button-print-note-${note.id}`}
                                            >
                                              <Printer className="w-3 h-3" />
                                            </button>
                                            {expandedNotes.has(note.id) ? (
                                              <ChevronDown className="w-3 h-3 text-slate-400" />
                                            ) : (
                                              <ChevronRight className="w-3 h-3 text-slate-400" />
                                            )}
                                          </div>

                                          {expandedNotes.has(note.id) && (
                                            <div className="pb-3 space-y-1.5" data-testid={`note-content-${note.id}`}>
                                              {note.sections.map((s, si) => (
                                                <div key={si} className="text-[11px] text-slate-700 leading-snug">
                                                  <span className="font-semibold">{s.heading}: </span>
                                                  <span>{s.body}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
