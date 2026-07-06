// Engagement Documents — the manager document surface embedded in the
// Engagement Center view switcher. Rides entirely on the canonical
// document-readiness spine (case_document_readiness + procedure_notes):
//
//   read  · GET /api/case-document-readiness  (per-case doc statuses)
//   read  · GET /api/procedure-notes          (generated note text)
//   write · POST /api/portal/uploads + POST /api/case-document-readiness/complete
//           (the same two-step report upload the portal panel uses — no new writer)
//
// Grouping is per-ancillary (BrainWave / VitalWave / Ultrasound / PGx / Other)
// because serviceType columns store full test names ("Echocardiogram TTE
// (93306)"), each case row buckets by name. Uploading a report flips the
// readiness row to `uploaded`, which is exactly what unlocks the order-note /
// procedure-note / billing-document lane downstream — the UI reflects that
// gate honestly: docs that don't exist yet say "Not generated", never a fake
// preview.

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Activity,
  Waves,
  Dna,
  Layers,
  FileText,
  Upload,
  Loader2,
  Eye,
  Copy,
  MapPin,
  Lock,
  Receipt,
  ClipboardList,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCaseDocumentReadiness,
  caseDocumentReadinessQueryKey,
  fetchProcedureNotes,
  procedureNotesQueryKey,
  type CaseDocumentReadiness,
  type ProcedureNote,
} from "@/lib/workflow/documentReadinessApi";

// ---------------------------------------------------------------------------
// Ancillary bucketing — serviceType stores full test names, so bucket by name.

type AncillaryBucket = "BrainWave" | "VitalWave" | "Ultrasound" | "PGx" | "Other";

const BUCKET_ORDER: AncillaryBucket[] = [
  "BrainWave",
  "VitalWave",
  "Ultrasound",
  "PGx",
  "Other",
];

function ancillaryBucket(serviceType: string): AncillaryBucket {
  const t = serviceType.toLowerCase();
  if (t.includes("brainwave") || t.includes("brain wave")) return "BrainWave";
  if (t.includes("vitalwave") || t.includes("vital wave")) return "VitalWave";
  if (
    t.includes("ultrasound") ||
    t.includes("duplex") ||
    t.includes("echocardiogram") ||
    t.includes("doppler") ||
    t.includes("aneurysm")
  )
    return "Ultrasound";
  if (t.includes("pgx") || t.includes("pharmacogen")) return "PGx";
  return "Other";
}

const BUCKET_META: Record<
  AncillaryBucket,
  { Icon: typeof Brain; activeTone: string; chip: string; iconTone: string }
> = {
  BrainWave: {
    Icon: Brain,
    activeTone:
      "data-[active=true]:border-violet-400 data-[active=true]:bg-violet-50 dark:data-[active=true]:bg-violet-950/40",
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    iconTone: "group-data-[active=true]:text-violet-600",
  },
  VitalWave: {
    Icon: Activity,
    activeTone:
      "data-[active=true]:border-rose-400 data-[active=true]:bg-rose-50 dark:data-[active=true]:bg-rose-950/40",
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    iconTone: "group-data-[active=true]:text-rose-600",
  },
  Ultrasound: {
    Icon: Waves,
    activeTone:
      "data-[active=true]:border-emerald-400 data-[active=true]:bg-emerald-50 dark:data-[active=true]:bg-emerald-950/40",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    iconTone: "group-data-[active=true]:text-emerald-600",
  },
  PGx: {
    Icon: Dna,
    activeTone:
      "data-[active=true]:border-sky-400 data-[active=true]:bg-sky-50 dark:data-[active=true]:bg-sky-950/40",
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    iconTone: "group-data-[active=true]:text-sky-600",
  },
  Other: {
    Icon: Layers,
    activeTone:
      "data-[active=true]:border-slate-400 data-[active=true]:bg-slate-100 dark:data-[active=true]:bg-slate-800/60",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    iconTone: "group-data-[active=true]:text-slate-600",
  },
};

// ---------------------------------------------------------------------------
// Per-case grouping (same key shape as DocumentReadinessPanel).

type CaseGroup = {
  key: string;
  bucket: AncillaryBucket;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  rowByType: Map<string, CaseDocumentReadiness>;
  noteByType: Map<string, ProcedureNote>;
};

const PASSING_REPORT_STATUSES = new Set([
  "uploaded",
  "generated",
  "completed",
  "approved",
]);

function statusTone(status: string): { className: string; label: string } {
  switch (status) {
    case "approved":
    case "completed":
    case "uploaded":
    case "generated":
    case "finalized":
      return {
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        label: status,
      };
    case "pending":
    case "generating":
      return {
        className:
          "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        label: status,
      };
    case "blocked":
    case "failed":
      return {
        className:
          "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
        label: status,
      };
    default:
      return {
        className:
          "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
        label: "Not generated",
      };
  }
}

// ---------------------------------------------------------------------------
// Report upload (canonical two-step: /api/portal/uploads → …/complete)

function ReportUploadControl({
  group,
  onDone,
}: {
  group: CaseGroup;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a file first");
      const fd = new FormData();
      fd.append("file", file);
      if (group.patientScreeningId != null)
        fd.append("patientScreeningId", String(group.patientScreeningId));
      if (group.executionCaseId != null)
        fd.append("executionCaseId", String(group.executionCaseId));
      fd.append("kind", "report");
      fd.append("serviceType", group.serviceType);
      const upRes = await fetch("/api/portal/uploads", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Upload failed (${upRes.status})`,
        );
      }
      const uploaded = (await upRes.json()) as {
        id?: number;
        storageKey?: string;
      };

      const markRes = await fetch("/api/case-document-readiness/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionCaseId: group.executionCaseId,
          patientScreeningId: group.patientScreeningId,
          serviceType: group.serviceType,
          documentType: "report",
          documentStatus: "uploaded",
          documentId: uploaded.id ?? null,
          storageKey: uploaded.storageKey ?? null,
        }),
      });
      if (!markRes.ok) {
        const body = await markRes.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Readiness update failed (${markRes.status})`,
        );
      }
      return markRes.json();
    },
    onSuccess: () => {
      toast({
        title: "Report uploaded",
        description:
          "Readiness updated — order note, procedure note, and billing lanes are now unlocked.",
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    },
    onError: (err: Error) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="max-w-[180px] text-[11px] file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200"
        data-testid={`input-report-file-${group.key}`}
      />
      <Button
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        disabled={!file || mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid={`button-upload-report-${group.key}`}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Upload className="h-3 w-3" />
        )}
        Upload
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note viewer dialog

function NoteViewerDialog({
  note,
  title,
  onClose,
}: {
  note: ProcedureNote;
  title: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-note-viewer">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {note.generatedText ?? "No text available."}
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              navigator.clipboard
                .writeText(note.generatedText ?? "")
                .then(() => toast({ title: "Copied to clipboard" }));
            }}
            data-testid="button-copy-note-text"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Document lane row — one per downstream doc (order / procedure / billing)

function DocLane({
  group,
  icon: Icon,
  label,
  docType,
  reportReady,
  note,
  onView,
}: {
  group: CaseGroup;
  icon: typeof FileText;
  label: string;
  docType: "order_note" | "post_procedure_note" | "billing_document";
  reportReady: boolean;
  note: ProcedureNote | null;
  onView: (note: ProcedureNote, title: string) => void;
}) {
  const row = group.rowByType.get(docType);
  // Prefer the procedure note's generation status when it is further along.
  let status = row?.documentStatus ?? "missing";
  if (note) {
    const rank: Record<string, number> = {
      missing: 0,
      pending: 1,
      generating: 2,
      failed: 1,
      blocked: 0,
      uploaded: 3,
      generated: 3,
      completed: 3,
      approved: 4,
    };
    if ((rank[note.generationStatus] ?? 0) > (rank[status] ?? 0)) {
      status = note.generationStatus;
    }
  }
  const tone = statusTone(status);
  const hasViewableNote = note != null && !!note.generatedText;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
        reportReady
          ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          : "border-dashed border-slate-200 bg-slate-50/60 opacity-70 dark:border-slate-800 dark:bg-slate-900/40"
      }`}
      data-testid={`lane-${docType}-${group.key}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {!reportReady ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <Lock className="h-3 w-3" />
          Awaiting report
        </span>
      ) : (
        <>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize ${tone.className}`}
            data-testid={`status-${docType}-${group.key}`}
          >
            {tone.label}
          </span>
          {hasViewableNote ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => onView(note!, `${label} — ${group.patientName}`)}
              data-testid={`button-view-${docType}-${group.key}`}
            >
              <Eye className="h-3 w-3" />
              View
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case card

function CaseDocumentCard({
  group,
  onRefresh,
  onView,
}: {
  group: CaseGroup;
  onRefresh: () => void;
  onView: (note: ProcedureNote, title: string) => void;
}) {
  const meta = BUCKET_META[group.bucket];
  const reportRow = group.rowByType.get("report");
  const reportStatus = reportRow?.documentStatus ?? "missing";
  const reportReady = PASSING_REPORT_STATUSES.has(reportStatus);
  const reportTone = statusTone(reportStatus);

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      data-testid={`card-doc-case-${group.key}`}
    >
      {/* Identity */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4
            className="truncate text-sm font-semibold text-slate-900 dark:text-white"
            data-testid={`text-doc-patient-${group.key}`}
          >
            {group.patientName}
          </h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {group.patientDob ? <span>DOB {group.patientDob}</span> : null}
            {group.facilityId ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {group.facilityId}
              </span>
            ) : null}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}
        >
          {group.serviceType}
        </span>
      </div>

      {/* Report lane — the gate */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Report
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize ${reportTone.className}`}
            data-testid={`status-report-${group.key}`}
          >
            {reportTone.label}
          </span>
        </div>
        <ReportUploadControl group={group} onDone={onRefresh} />
      </div>

      {/* Downstream lanes, unlocked by the report */}
      <div className="mt-2 grid gap-1.5">
        <DocLane
          group={group}
          icon={ClipboardList}
          label="Order Note"
          docType="order_note"
          reportReady={reportReady}
          note={group.noteByType.get("order_note") ?? null}
          onView={onView}
        />
        <DocLane
          group={group}
          icon={StickyNote}
          label="Procedure Note"
          docType="post_procedure_note"
          reportReady={reportReady}
          note={group.noteByType.get("post_procedure_note") ?? null}
          onView={onView}
        />
        <DocLane
          group={group}
          icon={Receipt}
          label="Billing Document"
          docType="billing_document"
          reportReady={reportReady}
          note={null}
          onView={onView}
        />
      </div>
      {!reportReady ? (
        <p className="mt-1.5 text-[10px] text-slate-400">
          Upload the report to unlock the order note, procedure note, and
          billing document lanes.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main surface

export function EngagementDocuments() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<AncillaryBucket>("BrainWave");
  const [viewer, setViewer] = useState<{
    note: ProcedureNote;
    title: string;
  } | null>(null);

  const readinessQuery = useQuery<CaseDocumentReadiness[]>({
    queryKey: caseDocumentReadinessQueryKey({ limit: 500 }),
    queryFn: () => fetchCaseDocumentReadiness({ limit: 500 }),
    staleTime: 15_000,
  });

  const notesQuery = useQuery<ProcedureNote[]>({
    queryKey: procedureNotesQueryKey({ limit: 500 }),
    queryFn: () => fetchProcedureNotes({ limit: 500 }),
    staleTime: 15_000,
  });

  const readinessRows = readinessQuery.data ?? [];
  const noteRows = notesQuery.data ?? [];

  const groups = useMemo<CaseGroup[]>(() => {
    const map = new Map<string, CaseGroup>();
    for (const row of readinessRows) {
      const key = `${row.patientScreeningId ?? row.executionCaseId ?? "?"}::${row.serviceType}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          bucket: ancillaryBucket(row.serviceType),
          patientName: row.patientName ?? "Unknown patient",
          patientDob: row.patientDob,
          facilityId: row.facilityId,
          serviceType: row.serviceType,
          executionCaseId: row.executionCaseId,
          patientScreeningId: row.patientScreeningId,
          rowByType: new Map(),
          noteByType: new Map(),
        };
        map.set(key, g);
      }
      if (g.executionCaseId == null && row.executionCaseId != null)
        g.executionCaseId = row.executionCaseId;
      g.rowByType.set(row.documentType, row);
    }
    for (const note of noteRows) {
      for (const g of map.values()) {
        if (
          g.patientScreeningId != null &&
          note.patientScreeningId === g.patientScreeningId &&
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

  const countByBucket = useMemo(() => {
    const counts: Record<AncillaryBucket, number> = {
      BrainWave: 0,
      VitalWave: 0,
      Ultrasound: 0,
      PGx: 0,
      Other: 0,
    };
    for (const g of groups) counts[g.bucket] += 1;
    return counts;
  }, [groups]);

  const activeGroups = useMemo(
    () => groups.filter((g) => g.bucket === active),
    [groups, active],
  );

  function refresh() {
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        (query.queryKey[0] === "/api/case-document-readiness" ||
          query.queryKey[0] === "/api/procedure-notes" ||
          query.queryKey[0] === "/api/billing-readiness-checks" ||
          query.queryKey[0] === "/api/billing-document-requests" ||
          query.queryKey[0] === "/api/engagement/baskets" ||
          query.queryKey[0] === "/api/patient-journey-events"),
    });
  }

  const isLoading = readinessQuery.isLoading || notesQuery.isLoading;

  return (
    <div className="space-y-4" data-testid="engagement-documents">
      {/* Ancillary tile grid — same visual language as Baskets */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
        data-testid="engagement-documents-tiles"
      >
        {BUCKET_ORDER.map((b) => {
          const meta = BUCKET_META[b];
          const Icon = meta.Icon;
          return (
            <button
              key={b}
              type="button"
              data-active={active === b}
              onClick={() => setActive(b)}
              className={`group flex flex-col items-start gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-left transition-all hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 ${meta.activeTone}`}
              data-testid={`tile-doc-bucket-${b.toLowerCase()}`}
            >
              <Icon
                className={`h-4 w-4 text-slate-400 ${meta.iconTone}`}
              />
              <span
                className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white"
                data-testid={`count-doc-bucket-${b.toLowerCase()}`}
              >
                {countByBucket[b]}
              </span>
              <span className="text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-300">
                {b}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active bucket header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {active} documents
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Report upload drives readiness — order note, procedure note, and
            billing document unlock once the report is in.
          </p>
        </div>
        <span className="text-xs text-slate-400">
          {activeGroups.length} case{activeGroups.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Cases */}
      {readinessQuery.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          Could not load document readiness. Please retry.
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
            />
          ))}
        </div>
      ) : activeGroups.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40"
          data-testid="empty-doc-bucket"
        >
          <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            No {active} cases with document tracking yet.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Cases appear here once a procedure is completed and document
            readiness tracking begins.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {activeGroups.map((g) => (
            <CaseDocumentCard
              key={g.key}
              group={g}
              onRefresh={refresh}
              onView={(note, title) => setViewer({ note, title })}
            />
          ))}
        </div>
      )}

      {viewer ? (
        <NoteViewerDialog
          note={viewer.note}
          title={viewer.title}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}
