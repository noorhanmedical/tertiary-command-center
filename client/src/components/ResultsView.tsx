import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  openPatientPacketPrintPreview,
  PACKET_PREVIEW_MESSAGE_SOURCE,
  type ReasoningValue,
} from "@/lib/pdfGeneration";
import PdfPatientSelectDialog from "@/components/PdfPatientSelectDialog";
import { PacketQaBlockingDialog } from "@/components/plexus-iq/PacketQaBlockingDialog";
import { auditPacketPatients, type PacketQaReport } from "@/lib/packetQa";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Building2, Calendar, Check, CheckSquare, ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Printer, Send, Share2, Users2,
} from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import { StepTimeline } from "@/components/StepTimeline";
import { NotesPanelDrawer } from "@/components/NotesPanelDrawer";
import { QualificationReasoningDialog } from "@/features/schedule/QualificationReasoningDialog";
import { PatientDetailDialog } from "@/components/PatientDetailDialog";
import { PatientSilhouette } from "@/components/PatientSilhouette";
import { categoryIcons, getAncillaryCategory, type AncillaryCategory } from "@/features/schedule/ancillaryMeta";

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

const FINAL_ANCILLARY_STROKE: Record<AncillaryCategory, string> = {
  brainwave: "text-violet-600",
  vitalwave: "text-red-600",
  ultrasound: "text-emerald-600",
  other: "text-slate-500",
};

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

type PatientTaskSummary = {
  id: number;
  title: string;
  status: string;
  urgency: string;
  priority: string;
};

const TASK_STATUS_STYLES: Record<string, string> = {
  open: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
  closed: "bg-slate-100 text-slate-400",
};

function PatientTasksSection({ patientId }: { patientId: number }) {
  const [open, setOpen] = useState(false);
  const { data: tasks, isLoading } = useQuery<PatientTaskSummary[]>({
    queryKey: ["/api/plexus/tasks/by-patient", patientId],
  });

  const count = tasks?.length ?? 0;

  return (
    <div className="mt-4 rounded-xl border border-slate-200/70 bg-white/70" data-testid={`section-tasks-${patientId}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50/80 rounded-xl transition-colors"
        data-testid={`button-toggle-tasks-${patientId}`}
      >
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-indigo-600" />
          <span className="font-semibold text-sm text-slate-900">Tasks</span>
          <span
            className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold"
            data-testid={`text-task-count-${patientId}`}
          >
            {isLoading ? "…" : count}
          </span>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1" onClick={(e) => e.stopPropagation()} data-testid={`panel-tasks-${patientId}`}>
          {isLoading ? (
            <p className="text-xs text-slate-500 italic py-2">Loading tasks…</p>
          ) : count === 0 ? (
            <p className="text-xs text-slate-500 italic py-2" data-testid={`text-no-tasks-${patientId}`}>
              No tasks linked to this patient yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {tasks!.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-xs text-slate-800"
                  data-testid={`row-task-${t.id}`}
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${TASK_STATUS_STYLES[t.status] ?? TASK_STATUS_STYLES.open}`}
                  >
                    {t.status.replace("_", " ")}
                  </span>
                  <span className="truncate flex-1" title={t.title}>{t.title}</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/plexus-tasks"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            onClick={(e) => e.stopPropagation()}
            data-testid={`link-task-brain-${patientId}`}
          >
            Open in Task Brain <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

const APPOINTMENT_STATUSES = ["Completed", "No Show", "Rescheduled", "Scheduled Different Day", "Cancelled", "Pending"] as const;

function buildSharedScheduleUrl(batchId: number): string {
  return `${window.location.origin}/schedule/${batchId}`;
}

function ResultsHeaderActions({
  patients,
  shareButtonText,
  onShare,
  onExport,
  onClinicianPdf,
  onPlexusPdf,
  onSendAllToScheduler,
  isSendingAll,
}: {
  patients: PatientScreening[];
  shareButtonText: string;
  onShare: () => void;
  onExport: () => void;
  onClinicianPdf: () => void;
  onPlexusPdf: () => void;
  onSendAllToScheduler: () => void;
  isSendingAll: boolean;
}) {
  const eligibleCount = patients.filter((p) => p.id != null && (p.name ?? "").trim() !== "").length;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        size="sm"
        onClick={onSendAllToScheduler}
        disabled={isSendingAll || eligibleCount === 0}
        className="gap-1.5 rounded-xl"
        data-testid="final-schedule-send-all-scheduler"
        title="Send every visible patient to the scheduler queue"
      >
        {isSendingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        Send All to Scheduler
      </Button>
      <Button variant="outline" size="sm" onClick={onShare} className="gap-1.5 rounded-xl" data-testid="button-share">
        {shareButtonText === "Copied!" ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />} {shareButtonText}
      </Button>
      <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 rounded-xl" data-testid="button-export">
        <Download className="w-3.5 h-3.5" /> Export CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onClinicianPdf}
        className="gap-1.5 rounded-xl"
        data-testid="button-clinician-pdf"
        disabled={patients.length === 0}
      >
        <Printer className="w-3.5 h-3.5" /> Clinician PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onPlexusPdf}
        className="gap-1.5 rounded-xl"
        data-testid="button-plexus-pdf"
        disabled={patients.length === 0}
      >
        <Users2 className="w-3.5 h-3.5" /> Plexus PDF
      </Button>
    </div>
  );
}

export function ResultsView({
  batch,
  patients,
  loading,
  onExport,
  onNavigate,
  expandedPatient,
  setExpandedPatient,
  expandedClinical,
  setExpandedClinical,
  selectedTestDetail,
  setSelectedTestDetail,
  onUpdatePatient,
  chromeless = false,
}: {
  batch: ScreeningBatchWithPatients | undefined;
  patients: PatientScreening[];
  loading: boolean;
  onExport: () => void;
  onNavigate: (step: "home" | "build" | "results") => void;
  expandedPatient: number | null;
  setExpandedPatient: (id: number | null) => void;
  expandedClinical: number | null;
  setExpandedClinical: (id: number | null) => void;
  selectedTestDetail: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null;
  setSelectedTestDetail: (v: { patientId: number; category: string; tests: string[]; reasoning: Record<string, ReasoningValue> } | null) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  // When true, suppress the StepTimeline + sidebar trigger + title block. The
  // caller (e.g. Plexus IQ day modal) supplies its own dialog header but still
  // wants the actions row (Plexus PDF / Clinician PDF / Share / Export /
  // Send All) and the patient bars. Default false preserves Visit/Outreach.
  chromeless?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [shareButtonText, setShareButtonText] = useState("Share");
  const [pdfMode, setPdfMode] = useState<"clinician" | "plexus" | null>(null);
  // Packet QA Gate — opened when auditPacketPatients finds blockers.
  // Mirrors the Plexus IQ pre-print gate so the batch results page and
  // the Plexus IQ workspace block the same low-quality packets.
  const [packetQa, setPacketQa] = useState<{
    report: PacketQaReport;
    mode: "clinician" | "plexus";
    printable: PatientScreening[];
  } | null>(null);
  const [completeModalPatient, setCompleteModalPatient] = useState<PatientScreening | null>(null);
  const [scheduleEditingPatientId, setScheduleEditingPatientId] = useState<number | null>(null);
  const [sendingPatientIds, setSendingPatientIds] = useState<Set<number>>(new Set());
  const [isSendingAll, setIsSendingAll] = useState(false);

  // Send a single patient to the scheduler queue. Reuses the canonical
  // POST /api/patients/:id/commit endpoint — no parallel commit logic.
  // Treats already-committed patients as success ("already sent").
  const sendPatientToScheduler = useCallback(
    async (
      patient: PatientScreening,
    ): Promise<"sent" | "alreadySent" | "failed"> => {
      try {
        const res = await apiRequest("POST", `/api/patients/${patient.id}/commit`);
        if (res.ok) return "sent";
        let msg = "";
        try {
          const body = await res.json();
          msg = (body?.error ?? "").toString().toLowerCase();
        } catch {
          /* noop */
        }
        if (res.status === 409 || msg.includes("already committed")) return "alreadySent";
        return "failed";
      } catch {
        return "failed";
      }
    },
    [],
  );

  const handleSendOneToScheduler = useCallback(
    async (patient: PatientScreening) => {
      setSendingPatientIds((prev) => new Set(prev).add(patient.id));
      try {
        const outcome = await sendPatientToScheduler(patient);
        if (outcome === "sent") {
          toast({ title: "Sent to scheduler queue", description: patient.name });
        } else if (outcome === "alreadySent") {
          toast({ title: "Already sent to scheduler", description: patient.name });
        } else {
          toast({
            title: "Could not send patient to scheduler",
            description: patient.name,
            variant: "destructive",
          });
        }
        if (batch?.id != null) {
          queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", batch.id] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
        queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });
      } finally {
        setSendingPatientIds((prev) => {
          const next = new Set(prev);
          next.delete(patient.id);
          return next;
        });
      }
    },
    [sendPatientToScheduler, toast, queryClient, batch?.id],
  );

  const handleSendAllToScheduler = useCallback(async () => {
    const eligible = patients.filter((p) => p.id != null && (p.name ?? "").trim() !== "");
    if (eligible.length === 0) {
      toast({ title: "No patients to send" });
      return;
    }
    setIsSendingAll(true);
    let sent = 0;
    let alreadySent = 0;
    let failed = 0;
    try {
      for (const p of eligible) {
        const outcome = await sendPatientToScheduler(p);
        if (outcome === "sent") sent += 1;
        else if (outcome === "alreadySent") alreadySent += 1;
        else failed += 1;
      }
      toast({
        title: failed === 0 ? "Send to scheduler complete" : "Send to scheduler finished with errors",
        description: `Sent ${sent} patient${sent === 1 ? "" : "s"} to scheduler queue · ${alreadySent} already sent · ${failed} failed`,
        variant: failed === 0 ? undefined : "destructive",
      });
      if (batch?.id != null) {
        queryClient.invalidateQueries({ queryKey: ["/api/screening-batches", batch.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });
    } finally {
      setIsSendingAll(false);
    }
  }, [patients, sendPatientToScheduler, toast, queryClient, batch?.id]);

  const handleStatusChange = useCallback(async (patient: PatientScreening, newStatus: string) => {
    if (newStatus.toLowerCase() === "completed") {
      if ((patient.qualifyingTests || []).length === 0) {
        toast({ title: "No qualifying tests", description: "This patient has no qualifying tests to mark complete.", variant: "destructive" });
        return;
      }
      setCompleteModalPatient(patient);
      return;
    }
    onUpdatePatient(patient.id, { appointmentStatus: newStatus });
  }, [toast, onUpdatePatient, setCompleteModalPatient]);

  // Opens the print-preview popup for a clean (or operator-confirmed)
  // subset. Kept separate from handlePdfGenerate so the QA gate's
  // "Print N safe rows" path can reuse it without re-auditing.
  const openPreview = useCallback((
    mode: "clinician" | "plexus",
    selected: PatientScreening[],
    printMode: "print" | "select" = "print",
  ) => {
    if (!batch) return;
    try {
      const result = openPatientPacketPrintPreview({
        mode,
        batchName: batch.name,
        patients: selected,
        scheduleDate: batch.scheduleDate,
        createdAt: batch.createdAt,
        printMode,
      });
      if (!result.ok && result.reason === "popup-blocked") {
        toast({
          title: "Popup blocked. Allow popups to print this packet.",
          description:
            "Your browser blocked the print preview window. Re-enable popups for this site and try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Could not open print preview",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [batch, toast]);

  // Packet QA Gate — same pre-print check the Plexus IQ workspace runs.
  //   1. Refetch latest batch data so a stale tab can't print outdated
  //      reasoning after a background qualification finished.
  //   2. Run auditPacketPatients(mode). If any patient has blockers,
  //      open PacketQaBlockingDialog; the dialog never auto-regenerates.
  //   3. Only after a clean (or operator-confirmed-subset) audit do we
  //      open the print-preview window.
  const handlePdfGenerate = useCallback(async (selected: PatientScreening[]) => {
    if (!batch || !pdfMode) return;
    const mode = pdfMode;
    setPdfMode(null);

    // Freshness step — best-effort. A network blip falls through to the
    // audit on the in-memory copies (still real data, just possibly
    // slightly older) and the operator can still bail at the QA dialog.
    try {
      await queryClient.refetchQueries({ queryKey: ["/api/screening-batches"] });
    } catch {
      // ignore — proceed with audit on current data
    }

    const report = auditPacketPatients(selected, mode);
    if (report.blockedCount > 0) {
      setPacketQa({ report, mode, printable: report.printablePatients });
      return;
    }

    openPreview(mode, selected);
  }, [batch, pdfMode, queryClient, openPreview]);

  // Preview-first workflow: clicking a packet button opens a print
  // preview popup containing every patient. The popup's Print button
  // posts back to this window (see PACKET_PREVIEW_MESSAGE_SOURCE) so the
  // operator can narrow down which patients to print via
  // PdfPatientSelectDialog before the final render.
  const handleOpenClinicianPdf = useCallback(() => {
    openPreview("clinician", patients, "select");
  }, [openPreview, patients]);

  const handleOpenPlexusPdf = useCallback(() => {
    openPreview("plexus", patients, "select");
  }, [openPreview, patients]);

  // Listen for the preview popup's Print click. We validate the message
  // origin (same-origin popup) and source tag before opening the
  // patient-selection dialog for the requested packet mode.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { source?: string; action?: string; mode?: "clinician" | "plexus" }
        | null;
      if (!data || data.source !== PACKET_PREVIEW_MESSAGE_SOURCE) return;
      if (data.action !== "open-select") return;
      if (data.mode !== "clinician" && data.mode !== "plexus") return;
      setPdfMode(data.mode);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleShare = useCallback(() => {
    if (!batch) return;
    const url = buildSharedScheduleUrl(batch.id);
    navigator.clipboard.writeText(url).then(() => {
      setShareButtonText("Copied!");
      toast({ title: "Link copied", description: "Share link copied to clipboard" });
      setTimeout(() => setShareButtonText("Share"), 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    });
  }, [batch, toast]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center relative z-10">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      {chromeless ? (
        <div className="bg-white border-b border-slate-200/60 px-4 sm:px-6 py-3 flex items-center justify-end gap-2 flex-wrap">
          <ResultsHeaderActions
            patients={patients}
            shareButtonText={shareButtonText}
            onShare={handleShare}
            onExport={onExport}
            onClinicianPdf={handleOpenClinicianPdf}
            onPlexusPdf={handleOpenPlexusPdf}
            onSendAllToScheduler={handleSendAllToScheduler}
            isSendingAll={isSendingAll}
          />
        </div>
      ) : (
        <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-slate-200/60">
          <StepTimeline current="results" onNavigate={onNavigate} canGoToResults={true} />
          <div className="px-8 lg:px-[10%] py-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle-results" />
              <div>
                <h1 className="text-base font-semibold tracking-tight" data-testid="text-results-title">{batch?.name} — Final Schedule</h1>
                {batch?.clinicianName && (
                  <p className="text-xs font-medium text-primary" data-testid="text-results-clinician">Dr. {batch.clinicianName}</p>
                )}
                {batch?.facility && (
                  <p className="text-xs text-slate-600 flex items-center gap-1" data-testid="text-results-facility">
                    <Building2 className="w-3 h-3 inline" />
                    {batch.facility}
                  </p>
                )}
                <p className="text-xs text-slate-900">{patients.length} patients screened</p>
              </div>
            </div>
            <ResultsHeaderActions
              patients={patients}
              shareButtonText={shareButtonText}
              onShare={handleShare}
              onExport={onExport}
              onClinicianPdf={handleOpenClinicianPdf}
              onPlexusPdf={handleOpenPlexusPdf}
              onSendAllToScheduler={handleSendAllToScheduler}
              isSendingAll={isSendingAll}
            />
          </div>
        </header>
      )}

      <main className="flex-1 overflow-auto bg-slate-50/50">
        <div className="px-8 lg:px-[10%] py-6">
          <div className="space-y-3" data-testid="table-final-schedule">
            {patients.map((patient) => {
              const allTests = patient.qualifyingTests || [];
              const isOutreach = (patient.patientType || "visit") === "outreach";
              const typeLabel: "Visit" | "Outreach" = isOutreach ? "Outreach" : "Visit";
              const showTimeBlock = !isOutreach && !!patient.time;
              const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;
              const visibleCategories = ANCILLARY_ORDER.filter(
                (c) => allTests.some((t) => getAncillaryCategory(t) === c),
              );

              const toggleType = (e: React.MouseEvent) => {
                e.stopPropagation();
                const newType = isOutreach ? "visit" : "outreach";
                onUpdatePatient(patient.id, { patientType: newType });
              };

              return (
                <Card
                  key={patient.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedPatient(patient.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedPatient(patient.id);
                    }
                  }}
                  className="relative rounded-2xl border-0 shadow-sm overflow-hidden cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  data-testid={`row-result-${patient.id}`}
                >
                  <div className="flex items-stretch min-h-[88px]">
                    <div className="bg-plexus-navy-800 text-white flex items-center gap-3 px-5 py-4 shrink-0 w-[44%] max-w-[460px] min-w-[260px]">
                      <div
                        aria-hidden="true"
                        className="shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-full bg-white/10 ring-1 ring-white/20 text-white"
                      >
                        <PatientSilhouette gender={patient.gender} className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {showTimeBlock ? (
                          <div className="grid grid-cols-[auto_1fr] gap-x-4 items-center">
                            <div className="flex flex-col leading-tight">
                              <span
                                className="text-base font-semibold tabular-nums text-white"
                                data-testid={`final-schedule-time-${patient.id}`}
                              >
                                {patient.time}
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={toggleType}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const newType = isOutreach ? "visit" : "outreach";
                                    onUpdatePatient(patient.id, { patientType: newType });
                                  }
                                }}
                                title="Click to toggle patient type"
                                className="text-[10px] uppercase tracking-[0.14em] text-white/60 font-medium cursor-pointer hover:text-white/90"
                                data-testid={`badge-patient-type-${patient.id}`}
                              >
                                Visit Appointment
                              </span>
                            </div>
                            <p
                              className="min-w-0 text-xl font-light tracking-tight text-white truncate self-center"
                              data-testid={`final-schedule-name-${patient.id}`}
                            >
                              {patient.name}
                            </p>
                          </div>
                        ) : (
                          <div className="leading-tight">
                            <p
                              className="min-w-0 text-xl font-light tracking-tight text-white truncate"
                              data-testid={`final-schedule-name-${patient.id}`}
                            >
                              {patient.name}
                            </p>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={toggleType}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const newType = isOutreach ? "visit" : "outreach";
                                  onUpdatePatient(patient.id, { patientType: newType });
                                }
                              }}
                              title="Click to toggle patient type"
                              className="text-[10px] uppercase tracking-[0.14em] text-white/60 font-medium cursor-pointer hover:text-white/90"
                              data-testid={`badge-patient-type-${patient.id}`}
                            >
                              {typeLabel === "Visit" ? "Visit Appointment" : "Outreach"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 bg-white px-5 py-4 flex items-center gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {visibleCategories.length === 0 ? (
                          <span className="text-xs text-slate-400 italic">
                            No qualifying tests
                          </span>
                        ) : (
                          visibleCategories.map((cat) => {
                            const Icon = categoryIcons[cat];
                            const catTests = allTests.filter(
                              (t) => getAncillaryCategory(t) === cat,
                            );
                            const count = catTests.length;
                            const label =
                              cat === "brainwave"
                                ? "BrainWave"
                                : cat === "vitalwave"
                                ? "VitalWave"
                                : "Ultrasound Studies";
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestDetail({
                                    patientId: patient.id,
                                    category: cat,
                                    tests: catTests,
                                    reasoning,
                                  });
                                }}
                                aria-label={`${label}${count > 1 ? ` (${count})` : ""}`}
                                title={`${label}${count > 1 ? ` (${count})` : ""}`}
                                className="relative inline-flex items-center justify-center transition-transform hover:scale-110"
                                data-testid={`final-schedule-ancillary-${cat}-${patient.id}`}
                              >
                                <Icon
                                  className={`w-7 h-7 ${FINAL_ANCILLARY_STROKE[cat]}`}
                                  strokeWidth={2}
                                  fill="none"
                                />
                                {count > 1 && (
                                  <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-slate-900 text-white text-[10px] font-semibold">
                                    {count}
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                      <select
                        className="text-[10px] border border-slate-200 rounded-lg px-2 py-1 bg-white font-medium cursor-pointer capitalize focus:outline-none focus:ring-1 focus:ring-primary shrink-0"
                        value={patient.appointmentStatus || "pending"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleStatusChange(patient, e.target.value);
                        }}
                        data-testid={`select-appointment-status-${patient.id}`}
                      >
                        {APPOINTMENT_STATUSES.map((s) => (
                          <option key={s} value={s.toLowerCase()}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div
                      className="bg-slate-950 text-white flex items-center gap-2 pl-7 pr-5 py-4 shrink-0"
                      style={{ clipPath: "polygon(20px 0, 100% 0, 100% 100%, 0 100%)" }}
                    >
                      {scheduleEditingPatientId === patient.id ? (
                        <input
                          type="text"
                          defaultValue={patient.time ?? ""}
                          autoFocus
                          placeholder="e.g. 10:00 AM"
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            e.stopPropagation();
                            const val = e.currentTarget.value.trim();
                            setScheduleEditingPatientId(null);
                            if (val !== (patient.time ?? "")) {
                              onUpdatePatient(patient.id, { time: val || null });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                            if (e.key === "Escape") {
                              setScheduleEditingPatientId(null);
                            }
                          }}
                          className="h-9 w-[120px] text-[11px] px-2 rounded-lg border border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-white/40"
                          data-testid={`input-final-schedule-time-${patient.id}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setScheduleEditingPatientId(patient.id);
                          }}
                          aria-label="Schedule patient"
                          title="Schedule patient"
                          className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                          data-testid={`final-schedule-patient-schedule-${patient.id}`}
                        >
                          <Calendar className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!sendingPatientIds.has(patient.id)) {
                            handleSendOneToScheduler(patient);
                          }
                        }}
                        disabled={sendingPatientIds.has(patient.id)}
                        aria-label="Send to scheduler"
                        title="Send to scheduler"
                        className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                        data-testid={`final-schedule-patient-send-scheduler-${patient.id}`}
                      >
                        {sendingPatientIds.has(patient.id) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </main>

      <PatientDetailDialog
        patient={patients.find((p) => p.id === expandedPatient) ?? null}
        open={expandedPatient !== null}
        onClose={() => {
          setExpandedPatient(null);
          setExpandedClinical(null);
        }}
        onOpenAncillary={(detail) => setSelectedTestDetail(detail)}
        patientType={
          ((patients.find((p) => p.id === expandedPatient)?.patientType) || "visit") === "outreach"
            ? "Outreach"
            : "Visit"
        }
        tasksSlot={
          expandedPatient !== null ? (
            <PatientTasksSection patientId={expandedPatient} />
          ) : null
        }
      />

      <QualificationReasoningDialog
        selectedTestDetail={selectedTestDetail}
        setSelectedTestDetail={setSelectedTestDetail}
      />

      <PdfPatientSelectDialog
        open={pdfMode !== null}
        mode={pdfMode}
        patients={patients}
        onClose={() => setPdfMode(null)}
        onGenerate={handlePdfGenerate}
      />

      <PacketQaBlockingDialog
        open={packetQa !== null}
        report={packetQa?.report ?? null}
        onCancel={() => setPacketQa(null)}
        onProceed={() => {
          if (!packetQa) return;
          const subset = packetQa.printable;
          const mode = packetQa.mode;
          setPacketQa(null);
          openPreview(mode, subset);
        }}
      />

      <NotesPanelDrawer
        batch={batch}
        onUpdatePatient={onUpdatePatient}
        completeModalPatient={completeModalPatient}
        setCompleteModalPatient={setCompleteModalPatient}
      />
    </div>
  );
}
