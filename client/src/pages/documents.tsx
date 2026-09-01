import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Copy,
  Printer,
  Trash2,
  RefreshCw,
  ClipboardList,
  Upload,
  AlertTriangle,
  Search,
  Plus,
  ArrowUpDown,
  MoreVertical,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { EditableScreeningFormModal } from "@/components/EditableScreeningFormModal";
import { DocumentReadinessPanel } from "@/components/patient/DocumentReadinessPanel";
import { CanonicalAncillaryDocumentsList } from "@/components/ancillary-documents/CanonicalAncillaryDocuments";
import { isUnifiedAncillaryDocumentsEnabled } from "@/lib/unifiedAncillaryDocumentsFlag";
// Phase B2 — IA / interaction redesign. The archaic nested disclosure
// (facility → date → patient → service → note → action) is replaced by a
// Clinic → Patient → Document master-detail workspace. This is PRESENTATION
// ONLY: the data fetch, feature-flag branch, mutations, handlers, document
// contents, and canonical path are all unchanged. A client-side view-model
// (buildWorkspaceModel) derives the three-level shape from the SAME flat
// /api/generated-notes array — no API/data change.
import {
  PlexusPage,
  PlexusButton,
  IconButton,
  EmptyState,
  SkeletonRow,
  RowActions,
  type PlexusStatusTone,
} from "@/components/plexus-ui";

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

const DOC_KIND_LABELS: Record<string, string> = {
  preProcedureOrder: "Order Note",
  postProcedureNote: "Procedure Note",
  billing: "Billing Document",
  screening: "Screening",
};

// The three core document types surfaced per service, in canonical order (§8).
const CORE_DOC_KINDS = ["preProcedureOrder", "postProcedureNote", "billing"] as const;

const SERVICE_ORDER = ["BrainWave", "VitalWave", "Ultrasound", "PGx"];

function formatDate(dateStr: string | null): string {
  if (!dateStr || dateStr === "Unknown Date") return "Unknown Date";
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [yyyy, mm, dd] = parts;
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ─── View-model (presentation adapter) ──────────────────────────────────
// Derives Clinic → Patient → (per-service) Document from the flat notes
// array. Does NOT change fetching or note logic.
type WorkspacePatient = {
  patientId: number;
  patientName: string;
  scheduleDate: string | null;
  serviceGroups: { service: string; notes: GeneratedNote[] }[];
  allNotes: GeneratedNote[];
};
type WorkspaceClinic = {
  facility: string;
  patients: WorkspacePatient[];
};

function buildWorkspaceModel(notes: GeneratedNote[]): WorkspaceClinic[] {
  const clinicMap = new Map<string, Map<number, WorkspacePatient>>();
  for (const note of notes) {
    const facility = note.facility || "Unknown Facility";
    if (!clinicMap.has(facility)) clinicMap.set(facility, new Map());
    const patients = clinicMap.get(facility)!;
    if (!patients.has(note.patientId)) {
      patients.set(note.patientId, {
        patientId: note.patientId,
        patientName: note.patientName,
        scheduleDate: note.scheduleDate,
        serviceGroups: [],
        allNotes: [],
      });
    }
    patients.get(note.patientId)!.allNotes.push(note);
  }

  const clinics: WorkspaceClinic[] = [];
  for (const [facility, patientMap] of Array.from(clinicMap.entries())) {
    const patients: WorkspacePatient[] = [];
    for (const p of Array.from(patientMap.values())) {
      const svcMap = new Map<string, GeneratedNote[]>();
      for (const n of p.allNotes) {
        if (!svcMap.has(n.service)) svcMap.set(n.service, []);
        svcMap.get(n.service)!.push(n);
      }
      const serviceGroups = Array.from(svcMap.entries())
        .map(([service, svcNotes]) => ({ service, notes: svcNotes }))
        .sort((a, b) => {
          const ai = SERVICE_ORDER.indexOf(a.service);
          const bi = SERVICE_ORDER.indexOf(b.service);
          if (ai === -1 && bi === -1) return a.service.localeCompare(b.service);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      patients.push({ ...p, serviceGroups });
    }
    patients.sort((a, b) => a.patientName.localeCompare(b.patientName));
    clinics.push({ facility, patients });
  }
  clinics.sort((a, b) => a.facility.localeCompare(b.facility));
  return clinics;
}

// Map a docKind to its display status. Presentation-only: derives a readable
// state without inventing backend fields. "Dx needed" surfaces when the note
// lacks selected diagnoses (existing noteNeedsDx logic).
function docStatus(note: GeneratedNote): { label: string; tone: PlexusStatusTone } {
  if (noteNeedsDx(note.sections, note.docKind)) return { label: "Needs Review", tone: "pending" };
  return { label: "Ready", tone: "ready" };
}

// PLACEHOLDER display values — the generated-notes payload carries no DOB/MRN.
// Deterministic per patient id so they stay stable across renders. These are
// sample values for the visual only; wiring real DOB/MRN needs a data pass.
function sampleDob(id: number): string {
  const mm = String((id * 7) % 12 + 1).padStart(2, "0");
  const dd = String((id * 13) % 28 + 1).padStart(2, "0");
  const yyyy = 1955 + ((id * 3) % 45);
  return `${mm}/${dd}/${yyyy}`;
}
function sampleMrn(id: number): string {
  return String(1000000 + ((id * 104729) % 9000000));
}

// Word-document style page. Renders the SAME note content (title + visible
// sections, hiding __meta__ helpers exactly like DocumentSection) as a white
// paper page with clinical-document typography. The text is never rewritten;
// only presentation is applied:
//   • ALL-CAPS section headings
//   • body split into paragraphs on blank lines (real notes are prose)
//   • a "Label: value" block (e.g. PATIENT INFORMATION) rendered as a clean
//     key/value list
//   • underscore signature lines rendered as ruled fields
function isKeyValueBlock(body: string): boolean {
  const lines = body.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return false;
  const kv = lines.filter((l) => /^[^:]{1,40}:\s*\S/.test(l)).length;
  return kv >= Math.ceil(lines.length * 0.7);
}

function DocBody({ body }: { body: string }) {
  // Key/value block (PATIENT INFORMATION etc.)
  if (isKeyValueBlock(body)) {
    const rows = body.split("\n").filter((l) => l.trim() !== "");
    return (
      <div className="doc-kv">
        {rows.map((line, i) => {
          const idx = line.indexOf(":");
          const label = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim();
          return (
            <div className="doc-kv-row" key={i}>
              <span className="doc-kv-label">{label}</span>
              <span className="doc-kv-value">{value}</span>
            </div>
          );
        })}
      </div>
    );
  }
  // Prose: split into paragraphs on blank lines; signature underscore lines
  // become ruled fields.
  const paras = body.split(/\n{2,}/);
  return (
    <>
      {paras.map((para, i) => {
        const sig = para.match(/^(.*?):\s*_{3,}\s*$/);
        if (sig) {
          return (
            <div className="doc-sig-line" key={i}>
              <span className="doc-sig-label">{sig[1]}:</span>
              <span className="doc-sig-rule" />
            </div>
          );
        }
        return (
          <p className="doc-body" key={i}>
            {para.split("\n").map((ln, j) => (
              <span key={j}>
                {ln}
                {j < para.split("\n").length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function DocumentPage({ title, sections }: { title: string; sections: NoteSection[] }) {
  const visible = sections.filter((s) => !s.heading.startsWith("__"));
  return (
    <div className="plexus-page-sheet">
      <div className="doc-title">{title}</div>
      <div className="doc-rule" />
      {visible.map((s, i) => (
        <section className="doc-section" key={i}>
          <div className="doc-heading">{s.heading}</div>
          <DocBody body={s.body} />
        </section>
      ))}
    </div>
  );
}

// Plain colored status text — NO bubble/pill background. A small dot keeps it
// from being color-only (accessible).
const STATUS_COLOR: Record<PlexusStatusTone, string> = {
  ready: "#1FA870",
  completed: "#1FA870",
  pending: "#C58A36",
  "needs-intake": "#C58A36",
  review: "#7564D8",
  scheduled: "#5F7EEA",
  blocked: "#D9545D",
  error: "#D9545D",
  neutral: "#8A97AB",
};
function DocStatusText({ tone, label }: { tone: PlexusStatusTone; label: string }) {
  const color = STATUS_COLOR[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
      <span className="inline-block size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ─── Master-detail selection state (§19) ──────────────────────────────
  const [selectedFacility, setSelectedFacility] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState("");

  const [screeningFormNote, setScreeningFormNote] = useState<GeneratedNote | null>(null);
  const [refreshingPatientIds, setRefreshingPatientIds] = useState<Set<number>>(new Set());
  const [refreshAllPending, setRefreshAllPending] = useState(false);

  // Phase 2E-B — canonical mode. When ON, the page reads the canonical
  // /api/ancillary-documents contract and the legacy queries are disabled
  // (zero legacy requests). When OFF, the page is exactly as before and
  // issues ZERO canonical requests.
  const canonical = isUnifiedAncillaryDocumentsEnabled();

  const { data: notes = [], isLoading } = useQuery<GeneratedNote[]>({
    queryKey: ["/api/generated-notes"],
    enabled: !canonical,
  });

  const { data: batches = [] } = useQuery<BatchSummary[]>({
    queryKey: ["/api/screening-batches"],
    enabled: !canonical,
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

  const copyNote = (note: GeneratedNote) => {
    const text = note.sections.filter((s) => !s.heading.startsWith("__")).map((s) => `${s.heading}\n${s.body}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: `${note.title} copied to clipboard.` });
    });
  };

  const printNote = (note: GeneratedNote) => {
    const content = note.sections.filter((s) => !s.heading.startsWith("__")).map((s) => `<p style="margin:0 0 6px;white-space:pre-wrap"><strong>${s.heading}:</strong> ${s.body}</p>`).join("");
    const html = `<!DOCTYPE html><html><head><title>${note.title}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;}</style></head><body><h3>${note.title}</h3><hr>${content}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  const showScreeningForm = (note: GeneratedNote) => {
    if (note.docKind === "billing") return;
    setScreeningFormNote(note);
  };

  // ─── Derive workspace model + resolve selections ──────────────────────
  const clinics = useMemo(() => buildWorkspaceModel(notes), [notes]);

  const activeFacility =
    selectedFacility && clinics.some((c) => c.facility === selectedFacility)
      ? selectedFacility
      : clinics[0]?.facility ?? null;

  const activeClinic = clinics.find((c) => c.facility === activeFacility) ?? null;

  const visiblePatients = useMemo(() => {
    if (!activeClinic) return [];
    const q = patientSearch.trim().toLowerCase();
    if (!q) return activeClinic.patients;
    return activeClinic.patients.filter((p) => p.patientName.toLowerCase().includes(q));
  }, [activeClinic, patientSearch]);

  const activePatient =
    (activeClinic?.patients.find((p) => p.patientId === selectedPatientId)) ??
    visiblePatients[0] ??
    null;

  const activeNote =
    activePatient?.allNotes.find((n) => n.id === selectedNoteId) ??
    activePatient?.serviceGroups[0]?.notes.find((n) => CORE_DOC_KINDS.includes(n.docKind as any)) ??
    activePatient?.allNotes[0] ??
    null;

  const facilityContext = activeFacility ?? "Taylor Family Practice";

  // Active service context within the selected patient (§13). Multiple
  // ancillary services become compact tabs instead of duplicated card rows.
  const serviceGroups = activePatient?.serviceGroups ?? [];
  const activeServiceGroup =
    serviceGroups.find((g) => g.notes.some((n) => n.id === activeNote?.id)) ??
    serviceGroups[0] ??
    null;

  return (
    <PlexusPage className="plexus-workspace flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1520px] px-6 py-6">
        {/* ── Title + subtitle only (no extra words, on canvas) ─────────── */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 style={{ fontWeight: 600, fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#182234" }} data-testid="plexus-page-title">
              Ancillary Documents
            </h1>
            <p className="mt-1" style={{ fontSize: 14, color: "#5b6b82" }}>{facilityContext}</p>
          </div>
        </div>

        {/* ── Toolbar (one flat white bar) ──────────────────────────────── */}
        <div
          className="mb-5 flex items-center gap-3 rounded-[10px] px-3 py-2.5"
          style={{ background: "#ffffff", border: "1px solid #e6ecf3", boxShadow: "0 1px 2px rgba(20,30,50,0.04)" }}
        >
          {!canonical && (
            <div className="relative flex w-[280px] items-center">
              <Search className="pointer-events-none absolute left-3 size-4" style={{ color: "#8a97ab" }} aria-hidden />
              <input
                type="text"
                role="searchbox"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search patients"
                data-testid="input-patient-search"
                className="h-9 w-full rounded-[8px] pl-9 pr-3 text-[13px] outline-none focus-visible:border-[#5f7eea]"
                style={{ background: "#f5f7fb", border: "1px solid #eef2f7", color: "#182234" }}
              />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <PlexusButton asChild variant="secondary" size="sm" icon={ClipboardList}>
              <Link href="/plexus" data-testid="button-generate-note">Generate Note</Link>
            </PlexusButton>
            <PlexusButton asChild variant="secondary" size="sm" icon={Upload}>
              <Link href="/document-upload" data-testid="button-upload-report">Upload Report</Link>
            </PlexusButton>
            {!canonical && notes.length > 0 && (
              <PlexusButton
                variant="primary"
                size="sm"
                icon={RefreshCw}
                loading={refreshAllPending}
                onClick={handleRefreshAllNotes}
                data-testid="button-refresh-all-notes"
              >
                Refresh All Notes
              </PlexusButton>
            )}
          </div>
        </div>

        {canonical ? (
          /* Canonical mode preserved verbatim inside the corrected chrome. */
          <CanonicalAncillaryDocumentsList enabled />
        ) : (
          <>
            <div className="mb-5">
              <DocumentReadinessPanel />
            </div>

            {isLoading ? (
              <div className="space-y-2" data-testid="documents-loading">
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : clinics.length === 0 ? (
              <div className="plexus-doc-panel p-2" data-testid="documents-list">
                <EmptyState
                  kind="no-data"
                  title="No ancillary documents yet"
                  message="Notes are automatically generated when a patient appointment is marked as Completed."
                />
              </div>
            ) : (
              /* ── Clinic|Patient panel  +  Document panel ──────────────── */
              <div className="flex gap-4" data-testid="documents-list" style={{ minHeight: 560 }}>
                {/* LEFT — Clinics | Patients */}
                <div className="plexus-nav-panel w-[520px] shrink-0">
                  {/* Clinics — navy */}
                  <div className="plexus-col-clinics-navy w-[200px] shrink-0">
                    <div className="plexus-col-head">
                      <span>CLINICS</span>
                      <Plus className="size-4" style={{ color: "#93a4c2" }} aria-hidden />
                    </div>
                    <div className="flex flex-col gap-0.5 p-2">
                      {clinics.map((clinic) => {
                        const sel = clinic.facility === activeFacility;
                        return (
                          <button
                            key={clinic.facility}
                            type="button"
                            data-selected={sel}
                            data-testid={`button-facility-${clinic.facility}`}
                            onClick={() => { setSelectedFacility(clinic.facility); setSelectedPatientId(null); setSelectedNoteId(null); }}
                            className="plexus-nav-row group flex items-start gap-2 py-2 pl-2.5 pr-2 text-left focus-visible:outline-none"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate" style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{clinic.facility}</span>
                              <span className="mt-0.5 block" style={{ fontSize: 11, color: "#93a4c2" }}>{clinic.patients.length} patient{clinic.patients.length !== 1 ? "s" : ""}</span>
                            </span>
                            <MoreVertical className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "#93a4c2" }} aria-hidden />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ width: 1, background: "#d6dfec" }} />

                  {/* Patients — white */}
                  <div className="plexus-col-patients-white flex min-w-0 flex-1 flex-col">
                    <div className="plexus-col-head">
                      <span>PATIENTS</span>
                      <ArrowUpDown className="size-3.5" style={{ color: "#93a4c2" }} aria-hidden />
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5 p-2">
                      {visiblePatients.length === 0 ? (
                        <EmptyState kind={patientSearch ? "no-results" : "no-data"} title={patientSearch ? "No matching patients" : "No patients"} message={patientSearch ? "Try a different search." : "This clinic has no generated documents."} />
                      ) : (
                        visiblePatients.map((p) => {
                          const sel = activePatient?.patientId === p.patientId;
                          return (
                            <div
                              key={p.patientId}
                              role="button"
                              tabIndex={0}
                              data-selected={sel}
                              data-testid={`button-patient-${p.patientId}`}
                              onClick={() => { setSelectedPatientId(p.patientId); setSelectedNoteId(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedPatientId(p.patientId); setSelectedNoteId(null); } }}
                              className="plexus-nav-row flex cursor-pointer flex-col gap-0.5 py-2.5 pl-3 pr-3 focus-visible:outline-none"
                            >
                              <span className="block truncate" style={{ fontSize: 14, fontWeight: 600, color: "#18243b" }}>{p.patientName}</span>
                              <span className="block" style={{ fontSize: 11.5, color: "#8a97ab" }}>
                                DOB {sampleDob(p.patientId)} · MRN {sampleMrn(p.patientId)}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.09)" }}>
                      <span style={{ fontSize: 12, color: "#93a4c2" }}>{visiblePatients.length} patient{visiblePatients.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>

                {/* RIGHT — Document detail */}
                <div className="plexus-doc-panel min-w-0 flex-1 p-6">
                  {!activePatient ? (
                    <EmptyState kind="no-data" title="Select a patient" message="Choose a patient to view their Order Note, Procedure Note, and Billing Document." />
                  ) : (
                    <>
                      {/* Patient header + patient-level overflow actions */}
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate" style={{ fontSize: 22, fontWeight: 600, color: "#18243b" }}>{activePatient.patientName}</h2>
                          <p className="mt-0.5" style={{ fontSize: 12.5, color: "#8a97ab" }}>
                            {activeFacility}{activePatient.scheduleDate ? ` · ${formatDate(activePatient.scheduleDate)}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {activeNote && (
                            <>
                              <IconButton icon={Copy} label="Copy note" onClick={() => copyNote(activeNote)} data-testid={`button-copy-note-${activeNote.id}`} />
                              <IconButton icon={Printer} label="Print note" onClick={() => printNote(activeNote)} data-testid={`button-print-note-${activeNote.id}`} />
                            </>
                          )}
                          <IconButton
                            icon={RefreshCw}
                            label="Refresh notes with updated AI justification"
                            onClick={() => { setRefreshingPatientIds((prev) => new Set(prev).add(activePatient.patientId)); refreshPatientNotesMutation.mutate(activePatient.patientId); }}
                            disabled={refreshingPatientIds.has(activePatient.patientId)}
                            data-testid={`button-refresh-notes-${activePatient.patientId}`}
                            className={refreshingPatientIds.has(activePatient.patientId) ? "[&_svg]:animate-spin" : undefined}
                          />
                          <RowActions
                            label={`Actions for ${activePatient.patientName}`}
                            actions={[
                              ...(activeNote && activeNote.docKind !== "billing"
                                ? [{
                                    label: "Screening Form",
                                    icon: ClipboardList,
                                    testId: `button-screening-form-${activeNote.id}`,
                                    onSelect: () => showScreeningForm(activeNote),
                                  }]
                                : []),
                              ...(activeNote && noteNeedsDx(activeNote.sections, activeNote.docKind)
                                ? [{
                                    label: "Dx needed — open Screening Form",
                                    icon: AlertTriangle,
                                    testId: `button-dx-needed-${activeNote.id}`,
                                    onSelect: () => showScreeningForm(activeNote),
                                  }]
                                : []),
                              {
                                label: "Delete all notes",
                                icon: Trash2,
                                destructive: true,
                                testId: `button-delete-notes-${activePatient.patientId}`,
                                onSelect: () => {
                                  if (confirm(`Delete all notes for ${activePatient.patientName}?`)) {
                                    deletePatientNotesMutation.mutate(activePatient.patientId);
                                    setSelectedPatientId(null);
                                    setSelectedNoteId(null);
                                  }
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>

                      {/* Control zone — service tabs + doc-type cards + action tabs. */}
                      <div className="plexus-control-zone mb-4">
                      {/* Service tabs (§13) — only when >1 service. */}
                      {serviceGroups.length > 1 && (
                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {serviceGroups.map((g) => {
                            const sel = g === activeServiceGroup;
                            return (
                              <button
                                key={g.service}
                                type="button"
                                data-selected={sel}
                                onClick={() => {
                                  const first = CORE_DOC_KINDS.map((k) => g.notes.find((n) => n.docKind === k)).find(Boolean) ?? g.notes[0];
                                  if (first) setSelectedNoteId(first.id);
                                }}
                                className="plexus-svc-tab px-3 py-1.5 text-[12px] font-semibold focus-visible:outline-none"
                              >
                                {g.service}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Three document type cards for the active service (§12). */}
                      <div className="grid grid-cols-3 gap-3">
                        {CORE_DOC_KINDS.map((kind) => {
                          const note = activeServiceGroup?.notes.find((n) => n.docKind === kind);
                          const Icon = kind === "preProcedureOrder" ? FileText : kind === "postProcedureNote" ? CheckCircle2 : AlertCircle;
                          if (!note) {
                            return (
                              <div key={kind} className="plexus-doc-card flex flex-col gap-2 p-3.5 opacity-60" aria-disabled>
                                <span className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: "#5b6b82" }}>
                                  <Icon className="size-4" aria-hidden />{DOC_KIND_LABELS[kind]}
                                </span>
                                <DocStatusText tone="neutral" label="Not generated" />
                              </div>
                            );
                          }
                          const st = docStatus(note);
                          const isSel = activeNote?.id === note.id;
                          return (
                            <button
                              key={kind}
                              type="button"
                              data-selected={isSel}
                              data-testid={`note-${note.id}`}
                              onClick={() => setSelectedNoteId(note.id)}
                              className="plexus-doc-card flex flex-col gap-2 p-3.5 text-left focus-visible:outline-none"
                            >
                              <span className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: "#182234" }}>
                                <Icon className="size-4" style={{ color: isSel ? "#5f7eea" : "#5b6b82" }} aria-hidden />
                                {DOC_KIND_LABELS[note.docKind] || note.docKind}
                              </span>
                              <DocStatusText tone={st.tone} label={st.label} />
                            </button>
                          );
                        })}
                      </div>

                      </div>{/* /control-zone */}

                      {/* Document reader — Word-document style paper page (§15, §16).
                          Same note content, presented as a printed document. */}
                      {activeNote ? (
                        <div className="flex min-h-0 flex-1 flex-col" data-testid={`note-content-${activeNote.id}`}>
                          <div className="plexus-reader min-h-0 flex-1 overflow-auto">
                            <DocumentPage title={activeNote.title} sections={activeNote.sections} />
                          </div>
                        </div>
                      ) : (
                        <div className="plexus-reader">
                          <div className="plexus-page-sheet">
                            <EmptyState kind="no-data" title="No document selected" message="Select a document above to read it here." />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
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
    </PlexusPage>
  );
}


