import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, FileText, Building2, Calendar, ChevronDown, ChevronRight, Copy, Printer, Trash2, RefreshCw, ClipboardList, ExternalLink, Upload, AlertTriangle } from "lucide-react";
import { SiGoogledrive } from "react-icons/si";
import { EditableScreeningFormModal } from "@/components/EditableScreeningFormModal";
import { DocumentSection } from "@/components/DocumentSection";
import { PageHeader } from "@/components/PageHeader";
type NoteSection = { heading: string; body: string };

function noteNeedsDx(sections: NoteSection[], docKind: string): boolean {
  if (docKind === "billing") return false;
  const notesSection = sections.find((s) => s.heading === "Notes");
  if (notesSection && notesSection.body.trim() === "Select conditions in the screening form.") return true;
  const meta = sections.find((s) => s.heading === "__screening_meta__");
  if (!meta) return false;
  try {
    const parsed = JSON.parse(meta.body);
    const conditions = Array.isArray(parsed.selectedConditions) ? parsed.selectedConditions : [];
    if (conditions.length === 0) return true;
  } catch {
    return false;
  }
  return false;
}
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
  driveFileId: string | null;
  driveWebViewLink: string | null;
};
type BatchSummary = { id: number; clinicianName: string | null };

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
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [screeningFormNote, setScreeningFormNote] = useState<GeneratedNote | null>(null);
  const [exportingNoteIds, setExportingNoteIds] = useState<Set<number>>(new Set());
  const [refreshingPatientIds, setRefreshingPatientIds] = useState<Set<number>>(new Set());
  const [refreshAllPending, setRefreshAllPending] = useState(false);

  const exportNoteMutation = useMutation({
    mutationFn: async (noteId: number) => {
      setExportingNoteIds((prev) => new Set(prev).add(noteId));
      const res = await apiRequest("POST", "/api/google/drive/export-note", { noteId });
      return res.json();
    },
    onSuccess: (data) => {
      setExportingNoteIds((prev) => { const s = new Set(prev); s.delete(data.note?.id); return s; });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      toast({
        title: "Saved to Google Drive",
        description: data.webViewLink
          ? `File saved — open it at: ${data.webViewLink}`
          : "File saved to Google Drive",
      });
    },
    onError: (err: Error, noteId) => {
      setExportingNoteIds((prev) => { const s = new Set(prev); s.delete(noteId); return s; });
      toast({ title: "Drive export failed", description: err.message, variant: "destructive" });
    },
  });

  const exportAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google/drive/export-all");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      toast({ title: "Bulk export complete", description: `${data.exported} notes saved to Google Drive${data.failed > 0 ? `, ${data.failed} failed` : ""}` });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk export failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: notes = [], isLoading } = useQuery<GeneratedNote[]>({
    queryKey: ["/api/generated-notes"],
  });

  const { data: batches = [] } = useQuery<BatchSummary[]>({
    queryKey: ["/api/screening-batches"],
    select: (data: any[]) => data.map((b) => ({ id: b.id, clinicianName: b.clinicianName ?? null })),
  });

  const refreshPatientNotesMutation = useMutation({
    mutationFn: async (patientId: number) => {
      const res = await apiRequest("POST", `/api/patients/${patientId}/refresh-notes`);
      return res.json();
    },
    onSuccess: (_, patientId) => {
      setRefreshingPatientIds((prev) => { const s = new Set(prev); s.delete(patientId); return s; });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      toast({ title: "Notes refreshed", description: "Clinical justification has been updated." });
    },
    onError: (err: Error, patientId) => {
      setRefreshingPatientIds((prev) => { const s = new Set(prev); s.delete(patientId); return s; });
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  const handleRefreshAllNotes = async () => {
    const uniquePatientIds = Array.from(new Set(notes.map((n) => n.patientId)));
    if (uniquePatientIds.length === 0) return;
    setRefreshAllPending(true);
    toast({ title: "Refreshing all notes…", description: `Regenerating AI justifications for ${uniquePatientIds.length} patients.` });
    let successCount = 0;
    let failCount = 0;
    for (const pid of uniquePatientIds) {
      try {
        setRefreshingPatientIds((prev) => new Set(prev).add(pid));
        const res = await apiRequest("POST", `/api/patients/${pid}/refresh-notes`);
        await res.json();
        setRefreshingPatientIds((prev) => { const s = new Set(prev); s.delete(pid); return s; });
        successCount++;
      } catch {
        setRefreshingPatientIds((prev) => { const s = new Set(prev); s.delete(pid); return s; });
        failCount++;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
    setRefreshAllPending(false);
    toast({
      title: "Refresh complete",
      description: `${successCount} patient${successCount !== 1 ? "s" : ""} refreshed${failCount > 0 ? `, ${failCount} failed` : ""}.`,
    });
  };

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

  const toggleService = (key: string) => {
    setExpandedServices((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  };

  const SERVICE_ORDER = ["BrainWave", "VitalWave", "Ultrasound", "PGx"];

  const toggleNote = (id: number) => {
    setExpandedNotes((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const copyNote = (note: GeneratedNote) => {
    const text = note.sections.filter((s) => !s.heading.startsWith("__")).map((s) => `${s.heading}\n${s.body}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: `${note.title} copied to clipboard.` });
    });
  };

  const grouped = groupNotes(notes);

  const showScreeningForm = (note: GeneratedNote, e: React.MouseEvent) => {
    e.stopPropagation();
    if (note.docKind === "billing") return;
    setScreeningFormNote(note);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[hsl(210,35%,96%)]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <PageHeader
          backHref="/"
          backLabel="Home"
          eyebrow="PLEXUS ANCILLARY · DOCUMENTS"
          icon={FileText}
          iconAccent="bg-teal-100 text-teal-700"
          title="Ancillary Documents"
          subtitle="Auto-generated notes organized by clinic, date, and patient"
          className="mb-8"
          actions={
            <>
            <Link href="/plexus">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                data-testid="button-generate-note"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Generate Note
              </Button>
            </Link>
            <Link href="/document-upload">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                data-testid="button-upload-report"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Report
              </Button>
            </Link>
            {notes.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshAllNotes}
                disabled={refreshAllPending}
                className="gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
                data-testid="button-refresh-all-notes"
              >
                {refreshAllPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Refresh All Notes
              </Button>
            )}
            {notes.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportAllMutation.mutate()}
                disabled={exportAllMutation.isPending}
                className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
                data-testid="button-sync-all-drive"
              >
                {exportAllMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <SiGoogledrive className="w-3.5 h-3.5" />
                )}
                Sync All to Drive
              </Button>
            )}
            </>
          }
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <Card className="p-10 text-center rounded-2xl border-dashed border-slate-200">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No ancillary documents yet</p>
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
                                      className="p-1 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors"
                                      title="Refresh notes with updated AI justification"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRefreshingPatientIds((prev) => new Set(prev).add(pg.patientId));
                                        refreshPatientNotesMutation.mutate(pg.patientId);
                                      }}
                                      disabled={refreshingPatientIds.has(pg.patientId)}
                                      data-testid={`button-refresh-notes-${pg.patientId}`}
                                    >
                                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingPatientIds.has(pg.patientId) ? "animate-spin" : ""}`} />
                                    </button>
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
                                    <div className="border-t border-slate-100">
                                      {(() => {
                                        const serviceGroups = new Map<string, GeneratedNote[]>();
                                        for (const note of pg.notes) {
                                          if (!serviceGroups.has(note.service)) serviceGroups.set(note.service, []);
                                          serviceGroups.get(note.service)!.push(note);
                                        }
                                        const sortedServices = Array.from(serviceGroups.keys()).sort((a, b) => {
                                          const ai = SERVICE_ORDER.indexOf(a);
                                          const bi = SERVICE_ORDER.indexOf(b);
                                          if (ai === -1 && bi === -1) return a.localeCompare(b);
                                          if (ai === -1) return 1;
                                          if (bi === -1) return -1;
                                          return ai - bi;
                                        });
                                        return sortedServices.map((service) => {
                                          const serviceNotes = serviceGroups.get(service)!;
                                          const serviceKey = `${pg.patientId}::${service}`;
                                          const isServiceExpanded = expandedServices.has(serviceKey);
                                          return (
                                            <div key={service} className="border-b border-slate-50 last:border-b-0">
                                              <button
                                                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50/80 transition-colors text-left"
                                                onClick={() => toggleService(serviceKey)}
                                                data-testid={`button-service-${serviceKey}`}
                                              >
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SERVICE_COLORS[service] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                                                  {service}
                                                </span>
                                                <span className="text-xs text-slate-400 flex-1">{serviceNotes.length} doc{serviceNotes.length !== 1 ? "s" : ""}</span>
                                                {isServiceExpanded ? (
                                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                                ) : (
                                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                                )}
                                              </button>
                                              {isServiceExpanded && (
                                                <div className="divide-y divide-slate-50">
                                                  {serviceNotes.map((note) => (
                                                    <div key={note.id} className="px-4" data-testid={`note-${note.id}`}>
                                                      <div
                                                        className="flex items-center gap-2 py-2 cursor-pointer hover:bg-slate-50/60 transition-colors -mx-4 px-4 rounded"
                                                        onClick={() => toggleNote(note.id)}
                                                      >
                                                        <span className="text-xs text-slate-600 flex-1">{DOC_KIND_LABELS[note.docKind] || note.docKind}</span>
                                                        {noteNeedsDx(note.sections, note.docKind) && (
                                                          <button
                                                            className="text-[10px] text-amber-700 hover:text-amber-900 px-2 py-0.5 rounded border border-amber-300 bg-amber-50 flex items-center gap-1 shrink-0 font-medium"
                                                            onClick={(e) => showScreeningForm(note, e)}
                                                            data-testid={`button-dx-needed-${note.id}`}
                                                            title="No diagnoses selected — click to fill in the Screening Form"
                                                          >
                                                            <AlertTriangle className="w-3 h-3" />
                                                            Dx needed
                                                          </button>
                                                        )}
                                                        {note.docKind !== "billing" && (
                                                          <button
                                                            className="text-[10px] text-teal-600 hover:text-teal-800 px-2 py-0.5 rounded border border-teal-200 bg-teal-50 flex items-center gap-1 shrink-0"
                                                            onClick={(e) => showScreeningForm(note, e)}
                                                            data-testid={`button-screening-form-${note.id}`}
                                                          >
                                                            <ClipboardList className="w-3 h-3" />
                                                            Screening Form
                                                          </button>
                                                        )}
                                                        {note.driveWebViewLink ? (
                                                          <a
                                                            href={note.driveWebViewLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[10px] text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 flex items-center gap-1 shrink-0"
                                                            onClick={(e) => e.stopPropagation()}
                                                            data-testid={`link-drive-${note.id}`}
                                                          >
                                                            <ExternalLink className="w-3 h-3" />
                                                            Drive
                                                          </a>
                                                        ) : (
                                                          <button
                                                            className="text-[10px] text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 flex items-center gap-1 shrink-0"
                                                            onClick={(e) => { e.stopPropagation(); exportNoteMutation.mutate(note.id); }}
                                                            disabled={exportingNoteIds.has(note.id)}
                                                            data-testid={`button-save-drive-${note.id}`}
                                                          >
                                                            {exportingNoteIds.has(note.id) ? (
                                                              <RefreshCw className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                              <SiGoogledrive className="w-3 h-3" />
                                                            )}
                                                            Save to Drive
                                                          </button>
                                                        )}
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
                                                            const content = note.sections.filter((s) => !s.heading.startsWith("__")).map((s) => `<p style="margin:0 0 6px;white-space:pre-wrap"><strong>${s.heading}:</strong> ${s.body}</p>`).join("");
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
                                                        <div className="pb-3" data-testid={`note-content-${note.id}`}>
                                                          <DocumentSection
                                                            doc={{ kind: note.docKind, title: note.title, sections: note.sections }}
                                                            index={note.id}
                                                          />
                                                        </div>
                                                      )}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        });
                                      })()}
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

      {screeningFormNote && (
        <EditableScreeningFormModal
          note={{
            service: screeningFormNote.service,
            title: screeningFormNote.title,
            sections: screeningFormNote.sections,
            patientId: screeningFormNote.patientId,
            batchId: screeningFormNote.batchId,
            facility: screeningFormNote.facility,
            scheduleDate: screeningFormNote.scheduleDate,
            patientName: screeningFormNote.patientName,
            clinicianName: batches.find((b) => b.id === screeningFormNote.batchId)?.clinicianName ?? null,
          }}
          onClose={() => setScreeningFormNote(null)}
        />
      )}

    </main>
  );
}
