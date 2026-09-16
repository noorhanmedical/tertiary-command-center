// Bulk Import Patients — Plexus EHR entry point for the large-file patient
// ingestion backend. DISTINCT from "Import Test History". Wires ONLY to the
// already-built endpoints; no parsing/import logic lives here.
//
//   POST   /api/patient-import/large                                (upload)
//   GET    /api/patient-import/large/:id                            (status/poll)
//   GET    /api/patient-import/large/:id/preview                    (paginated rows)
//   GET    /api/patient-import/large/:id/possible-matches           (review list)
//   POST   /api/patient-import/large/:id/possible-matches/:row/resolve
//   POST   /api/patient-import/large/:id/confirm                    (start import)

import { useState, useMemo, Fragment, type ReactNode, type ChangeEvent } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { VALID_FACILITIES } from "@shared/plexus";
import {
  reconcileImportCounts,
  tallyRemovedByClass,
  invalidRowIndexes,
  type PreviewClassification,
} from "@shared/patientImportPreview";
import { Loader2, Upload, Users, AlertTriangle, CheckCircle2, FileSpreadsheet, ClipboardList, Sparkles, ArrowRight, Search, ChevronDown, ChevronRight, Settings2, Trash2, Pencil, RotateCcw, XCircle } from "lucide-react";

type Classification = "NEW" | "EXISTING_MATCH" | "POSSIBLE_MATCH" | "INVALID";

type JobCounts = {
  total: number; valid: number; invalid: number; duplicate: number;
  new: number; existing: number; possible: number; imported: number;
};
type JobStatus = {
  jobId: number;
  status: "uploaded" | "parsing" | "validating" | "preview_ready" | "importing" | "completed" | "failed" | "cancelled";
  fileFormat: string | null;
  originalFilename: string | null;
  byteSize: number | null;
  facility: string | null;
  facilitySource: string | null;
  detectedSheet: string | null;
  detectedColumns: Record<string, string>;
  columnOverrides?: Record<string, string>;
  rowOverrides?: Record<string, Record<string, unknown>>;
  workbookInfo:
    | {
        sheets?: Array<{ name: string; rowCount: number; chosen: boolean }>;
        chosenSheet?: string | null;
        headerFieldMapping?: Array<{ header: string; field: string | null }>;
        sourceHeaders?: string[];
      }
    | null;
  counts: JobCounts;
  progress: { processedChunks: number; totalChunks: number; cursorRow: number };
  preview: unknown[];
  warnings: string[];
  error: { type: string; message: string; retryable: boolean } | null;
  batchId: number | null;
};
type PreviewRow = {
  rowIndex: number; name: string; dob: string | null; gender?: string | null; phone: string | null;
  email?: string | null; mrn: string | null; patientId: string | null;
  facility: string | null; provider?: string | null; insurance: string | null;
  diagnoses?: string | null; medications?: string | null; history?: string | null;
  classification: Classification; matchTier?: string | null; reasons?: string[];
};
type PossibleMatchItem = {
  rowIndex: number;
  incoming: { name: string; dob: string | null; phone: string | null; mrn: string | null; patientId: string | null; facility: string | null; insurance: string | null };
  existingPatient: { screeningId: number; name: string; dob: string | null; phone: string | null; mrn: string | null; facility: string | null } | null;
  matchReason: string;
  decision: { decision: string; matchedScreeningId: number | null } | null;
};

type IqProgress = {
  jobId: number;
  batchId: number | null;
  imported: number;
  phase: "not_started" | "queued" | "running" | "complete" | "failed";
  analysis: { id?: number; status: string; completedPatients: number; totalPatients: number; errorMessage?: string | null };
  counts: { total: number; qualified: number; notQualified: number; failed: number; pending: number };
};

const ACTIVE_STATUSES = new Set(["uploaded", "parsing", "validating", "importing"]);
const PAGE = 50;

function badgeFor(c: Classification) {
  switch (c) {
    case "NEW": return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">New</Badge>;
    case "EXISTING_MATCH": return <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Existing</Badge>;
    case "POSSIBLE_MATCH": return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Possible</Badge>;
    case "INVALID": return <Badge variant="secondary" className="text-muted-foreground">Invalid</Badge>;
  }
}

// The AI parse-preview endpoint caps input at 50,000 chars per call (and one
// huge call is unreliable anyway). Split a large paste into chunks UNDER that
// budget, preserving patient boundaries: prefer blank-line-separated blocks,
// else split by line. An oversized single unit is hard-split as a last resort.
// Smaller chunks keep each LLM call fast (it must GENERATE structured JSON for
// every patient in the chunk — the slow part — so fewer patients per call =
// quicker return + no truncation). Well under the 50k endpoint cap. Chunks are
// parsed with bounded concurrency (PARSE_CONCURRENCY) so many run at once.
const PARSE_CHUNK_BUDGET = 8000;
const PARSE_CONCURRENCY = 4;
function chunkPasteText(text: string, budget: number = PARSE_CHUNK_BUDGET): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return [trimmed];
  const hasBlankLines = /\n\s*\n/.test(trimmed);
  const units = hasBlankLines ? trimmed.split(/\n\s*\n/) : trimmed.split(/\n/);
  const sep = hasBlankLines ? "\n\n" : "\n";
  const chunks: string[] = [];
  let cur = "";
  for (const raw of units) {
    const u = raw.trim();
    if (!u) continue;
    if (u.length > budget) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < u.length; i += budget) chunks.push(u.slice(i, i + budget));
      continue;
    }
    if (cur && cur.length + u.length + sep.length > budget) {
      chunks.push(cur);
      cur = u;
    } else {
      cur = cur ? cur + sep + u : u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function BulkImportPatientsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Intake mode: upload a file OR paste tabular rows (e.g. copied from a
  // spreadsheet). Paste is turned into a synthetic CSV/TSV file so it flows
  // through the SAME parse → validate → preview → import pipeline.
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [facility, setFacility] = useState<string>("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  // FILE-mode structured review surface: search box, classification filter chip,
  // and the currently expanded row (rowIndex) for the inline detail panel.
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewFilter, setPreviewFilter] = useState<"ALL" | Classification>("ALL");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Row selection + removal (Step 1). Removal only excludes rows from THIS
  // job (persisted as a per-row "skip" decision the importer honors); it never
  // deletes an existing patient/screening/identity. `removedClass` remembers
  // each removed row's classification so the reconciliation strip balances even
  // after the row scrolls out of the loaded page.
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [removedRows, setRemovedRows] = useState<Set<number>>(new Set());
  const [removedClass, setRemovedClass] = useState<Map<number, PreviewClassification>>(new Map());
  const [removing, setRemoving] = useState(false);
  const [confirmRemoveInvalid, setConfirmRemoveInvalid] = useState(false);
  // Inline identity edit (Step 2) — only for rows needing review.
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; dob: string; mrn: string; patientId: string; insurance: string }>({ name: "", dob: "", mrn: "", patientId: "", insurance: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // PASTE mode uses the AI free-form parser (handles natural / headerless text),
  // NOT the tabular CSV importer. Flow: parse → review → create (create
  // auto-runs Plexus IQ per patient).
  type ParsedPatient = {
    name: string; dob?: string | null; gender?: string | null; phoneNumber?: string | null;
    email?: string | null; insurance?: string | null; diagnoses?: string | null;
    medications?: string | null; history?: string | null; notes?: string | null;
    confidence?: string | null;
  };
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<string | null>(null);
  const [parsedPatients, setParsedPatients] = useState<ParsedPatient[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [pasteResult, setPasteResult] = useState<{ created: number; failed: number; batchId: number | null } | null>(null);

  // Poll job status while active.
  const { data: job } = useQuery<JobStatus>({
    queryKey: ["/api/patient-import/large", jobId],
    queryFn: async () => (await apiRequest("GET", `/api/patient-import/large/${jobId}`)).json(),
    enabled: jobId != null && open,
    refetchInterval: (q) => {
      const s = (q.state.data as JobStatus | undefined)?.status;
      return s && ACTIVE_STATUSES.has(s) ? 1200 : false;
    },
  });

  // Paginated preview once preview_ready.
  const { data: previewData } = useQuery<{ rows: PreviewRow[]; total: number }>({
    queryKey: ["/api/patient-import/large", jobId, "preview", previewPage],
    queryFn: async () =>
      (await apiRequest("GET", `/api/patient-import/large/${jobId}/preview?offset=${previewPage * PAGE}&limit=${PAGE}`)).json(),
    enabled: jobId != null && open && (job?.status === "preview_ready" || job?.status === "importing"),
  });

  // Post-import Plexus IQ progress (Step 3). Auto-IQ is enqueued server-side on
  // import completion, so we just watch REAL analysis-job + screening state.
  const { data: iqProgress } = useQuery<IqProgress>({
    queryKey: ["/api/patient-import/large", jobId, "iq-progress"],
    queryFn: async () => (await apiRequest("GET", `/api/patient-import/large/${jobId}/iq-progress`)).json(),
    enabled: jobId != null && open && job?.status === "completed",
    refetchInterval: (q) => {
      const p = (q.state.data as IqProgress | undefined)?.phase;
      return p === "complete" || p === "failed" ? false : 1500;
    },
  });

  const resetAll = () => {
    setMode("file"); setPasteText("");
    setFile(null); setFacility(""); setJobId(null); setUploading(false);
    setUploadError(null); setPreviewPage(0); setReviewOpen(false);
    setPreviewSearch(""); setPreviewFilter("ALL"); setExpandedRow(null);
    setSelectedRows(new Set()); setRemovedRows(new Set()); setRemovedClass(new Map());
    setRemoving(false); setConfirmRemoveInvalid(false);
    setEditingRow(null); setSavingEdit(false); setRefreshed(false);
    setParsing(false); setParseProgress(null); setParsedPatients(null); setCreating(false); setPasteResult(null);
  };

  // PASTE mode — parse free-form / pasted text with the AI parser (same engine
  // as "Add Patient"). Handles natural text, headerless rows, and messy input.
  const parsePasteText = async () => {
    const text = pasteText.trim();
    if (!text) return;
    if (!facility) {
      setUploadError("Select a facility before parsing.");
      return;
    }
    setParsing(true); setUploadError(null);
    try {
      // Chunk large pastes under the 50k endpoint cap, then parse the chunks with
      // BOUNDED CONCURRENCY (PARSE_CONCURRENCY at a time) so many LLM calls run in
      // parallel instead of one-after-another — far faster for large pastes.
      const chunks = chunkPasteText(text);
      const all: ParsedPatient[] = [];
      const errors: string[] = [];
      let completed = 0;
      const parseChunk = async (chunk: string) => {
        try {
          const resp = await apiRequest("POST", "/api/plexus-ehr/patients/parse-preview", { text: chunk });
          const result = await resp.json();
          const patients: ParsedPatient[] = Array.isArray(result.patients) ? result.patients : [];
          all.push(...patients);
        } catch (chunkErr) {
          errors.push(chunkErr instanceof Error ? chunkErr.message : "chunk failed");
        } finally {
          completed += 1;
          if (chunks.length > 1) setParseProgress(`Parsing ${completed} of ${chunks.length}…`);
        }
      };
      // Simple worker pool: PARSE_CONCURRENCY workers pull chunks from a shared cursor.
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunks.length) {
          const idx = cursor;
          cursor += 1;
          await parseChunk(chunks[idx]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PARSE_CONCURRENCY, chunks.length) }, () => worker()),
      );
      if (all.length === 0) {
        setUploadError(
          errors.length
            ? `Could not parse the pasted text: ${errors[0]}`
            : "No patients detected in the pasted text. Add more detail (name, DOB) and try again.",
        );
        return;
      }
      if (errors.length) {
        setUploadError(`Parsed ${all.length} patient${all.length === 1 ? "" : "s"}; ${errors.length} chunk${errors.length === 1 ? "" : "s"} failed and were skipped — review before adding.`);
      }
      setParsedPatients(all);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not parse the pasted text.");
    } finally {
      setParsing(false);
      setParseProgress(null);
    }
  };

  // Create each reviewed patient. /api/plexus-ehr/patients creates in a shared
  // daily "Plexus EHR" batch AND auto-enqueues Plexus IQ (qualification), so no
  // separate Run-IQ step is needed for paste.
  const createParsed = async () => {
    if (!parsedPatients || parsedPatients.length === 0) return;
    setCreating(true);
    let created = 0, failed = 0, batchId: number | null = null;
    for (const p of parsedPatients) {
      try {
        const resp = await apiRequest("POST", "/api/plexus-ehr/patients", {
          name: (p.name ?? "").trim(),
          dob: p.dob ?? null, gender: p.gender ?? null, phoneNumber: p.phoneNumber ?? null,
          email: p.email ?? null, insurance: p.insurance ?? null, diagnoses: p.diagnoses ?? null,
          medications: p.medications ?? null, history: p.history ?? null, notes: p.notes ?? null,
          facility,
        });
        const r = await resp.json();
        created += 1;
        if (batchId == null && r?.batchId) batchId = r.batchId;
      } catch {
        failed += 1;
      }
    }
    setCreating(false);
    setPasteResult({ created, failed, batchId });
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database/cooldown-summary"] });
    if (created > 0) {
      toast({ title: `Added ${created} patient${created === 1 ? "" : "s"} — Plexus IQ started`, description: "Qualification is running; view results in Plexus IQ." });
    }
    if (failed > 0) {
      toast({ title: `${failed} could not be added`, variant: "destructive" });
    }
  };

  // FILE mode only. Paste mode uses parsePasteText (AI parser) instead.
  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (facility) fd.append("facility", facility);
      // Stable idempotency key so an accidental re-submit reuses the same job.
      fd.append("idempotencyKey", `ehr-${file.name}-${file.size}-${file.lastModified}`);
      const res = await fetch("/api/patient-import/large", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 413 ? (body.error ?? "File exceeds the 250 MB limit.") : (body.error ?? `Upload failed (${res.status})`));
      }
      const { jobId: id } = await res.json();
      setJobId(id);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const confirmImport = async () => {
    if (!jobId) return;
    try {
      await apiRequest("POST", `/api/patient-import/large/${jobId}/confirm`, {});
      // Nudge a poll immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId] });
    } catch (e) {
      toast({ title: "Could not start import", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  };

  // Persist a "skip" decision for each row so the importer excludes it,
  // regardless of classification. Reuses the existing per-row resolve endpoint;
  // this only affects the current job and never deletes anything in the DB.
  const skipRowsOnServer = async (indexes: number[]) => {
    await Promise.all(
      indexes.map((rowIndex) =>
        apiRequest("POST", `/api/patient-import/large/${jobId}/possible-matches/${rowIndex}/resolve`, { decision: "skip" }),
      ),
    );
  };

  // Remove the given rows from THIS preview (client excluded set + persisted
  // skip decisions). `classByRow` lets the reconciliation strip stay balanced.
  const removeRows = async (rows: Array<{ rowIndex: number; classification: PreviewClassification }>) => {
    if (!jobId || rows.length === 0) return;
    setRemoving(true);
    try {
      await skipRowsOnServer(rows.map((r) => r.rowIndex));
      setRemovedRows((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.add(r.rowIndex);
        return next;
      });
      setRemovedClass((prev) => {
        const next = new Map(prev);
        for (const r of rows) next.set(r.rowIndex, r.classification);
        return next;
      });
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.rowIndex);
        return next;
      });
    } catch (e) {
      toast({ title: "Could not remove rows", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  // Restore a previously-removed row (clears its skip decision so it imports
  // per its classification again).
  const restoreRow = async (rowIndex: number) => {
    if (!jobId) return;
    setRemoving(true);
    try {
      await apiRequest("POST", `/api/patient-import/large/${jobId}/possible-matches/${rowIndex}/resolve`, { decision: "import_as_new" });
      setRemovedRows((prev) => { const n = new Set(prev); n.delete(rowIndex); return n; });
      setRemovedClass((prev) => { const n = new Map(prev); n.delete(rowIndex); return n; });
    } catch (e) {
      toast({ title: "Could not restore row", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  // Save an inline identity edit through the per-row override endpoint. The
  // server re-normalizes AND re-classifies the row (runAnalysis), so the status
  // reflects the edit after we re-fetch. Nothing is written to the canonical DB
  // before confirm.
  const saveRowEdit = async (rowIndex: number) => {
    if (!jobId) return;
    setSavingEdit(true);
    try {
      await apiRequest("PATCH", `/api/patient-import/large/${jobId}/rows/${rowIndex}`, {
        override: {
          name: editDraft.name.trim(),
          dob: editDraft.dob.trim(),
          mrn: editDraft.mrn.trim(),
          patientId: editDraft.patientId.trim(),
          insurance: editDraft.insurance.trim(),
        },
      });
      setEditingRow(null);
      // Re-analysis runs in the background; poll the job + refresh the preview
      // so the row's classification reflects the edit.
      queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId, "preview"] });
      toast({ title: "Row updated", description: "Re-checking this row against existing patients…" });
    } catch (e) {
      toast({ title: "Could not save edit", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const [retrying, setRetrying] = useState(false);
  const retryFailedIq = async () => {
    if (!jobId) return;
    setRetrying(true);
    try {
      await apiRequest("POST", `/api/patient-import/large/${jobId}/iq-retry`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId, "iq-progress"] });
      toast({ title: "Retrying failed analyses", description: "Re-running Plexus IQ for the failed patients only." });
    } catch (e) {
      toast({ title: "Could not retry", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  const viewInPlexusIq = () => {
    resetAll();
    onOpenChange(false);
    setLocation("/plexus-iq");
  };

  // On completion, refresh the canonical EHR roster (no second patient list).
  const [refreshed, setRefreshed] = useState(false);
  if (job?.status === "completed" && !refreshed) {
    setRefreshed(true);
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database"] });
    queryClient.invalidateQueries({ queryKey: ["/api/patients/database/cooldown-summary"] });
  }

  const counts = job?.counts;
  const facilityResolved = !!(job?.facility) || Object.values(job?.detectedColumns ?? {}).includes("Facility") || !!(job?.detectedColumns as Record<string, string>)?.facility;
  const status = job?.status;

  // Wide, structured review surface only for the FILE-upload preview state.
  const isWidePreview = jobId != null && status === "preview_ready";

  // Client-side search + classification filter over the loaded preview page.
  const previewRows = previewData?.rows ?? [];
  const filteredPreviewRows = useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    return previewRows.filter((r) => {
      if (previewFilter !== "ALL" && r.classification !== previewFilter) return false;
      if (!q) return true;
      return (
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.mrn ?? "").toLowerCase().includes(q) ||
        (r.patientId ?? "").toLowerCase().includes(q)
      );
    });
  }, [previewRows, previewSearch, previewFilter]);

  // Surface a warning when identity/clinical-relevant source headers mapped to
  // nothing — helps the user catch a column the auto-detector missed.
  const unmappedRelevantHeaders = useMemo(() => {
    const mapping = (job?.workbookInfo as { headerFieldMapping?: Array<{ header: string; field: string | null }> })?.headerFieldMapping ?? [];
    const RELEVANT = /\b(mrn|patient\s*id|dob|birth|insurance|appointment|provider|diagnos)/i;
    return mapping.filter((m) => !m.field && RELEVANT.test(m.header)).map((m) => m.header);
  }, [job?.workbookInfo]);

  // Row-count reconciliation for the preview strip. Always balances:
  //   parsed = ready + existing + possible + invalid + removed
  const reconciled = counts
    ? reconcileImportCounts(
        { total: counts.total, new: counts.new, existing: counts.existing, possible: counts.possible, invalid: counts.invalid },
        tallyRemovedByClass(removedRows, removedClass),
      )
    : null;
  // Classification of each currently-loaded preview row (for select/remove).
  const classOfLoaded = useMemo(
    () => new Map(previewRows.map((r) => [r.rowIndex, r.classification as PreviewClassification])),
    [previewRows],
  );
  // Selectable = loaded rows not already removed. Drives select-all-visible.
  const selectableVisible = filteredPreviewRows.filter((r) => !removedRows.has(r.rowIndex));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selectedRows.has(r.rowIndex));
  const toggleSelectAllVisible = () => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) { for (const r of selectableVisible) next.delete(r.rowIndex); }
      else { for (const r of selectableVisible) next.add(r.rowIndex); }
      return next;
    });
  };
  const toggleSelectRow = (rowIndex: number) => {
    setSelectedRows((prev) => { const n = new Set(prev); if (n.has(rowIndex)) n.delete(rowIndex); else n.add(rowIndex); return n; });
  };
  const removeSelected = () => {
    const rows = Array.from(selectedRows).map((rowIndex) => ({ rowIndex, classification: (classOfLoaded.get(rowIndex) ?? "NEW") as PreviewClassification }));
    void removeRows(rows);
  };
  const removeInvalid = () => {
    const rows = invalidRowIndexes(previewRows.map((r) => ({ rowIndex: r.rowIndex, classification: r.classification as PreviewClassification })))
      .map((rowIndex) => ({ rowIndex, classification: "INVALID" as PreviewClassification }));
    setConfirmRemoveInvalid(false);
    void removeRows(rows);
  };
  const startEdit = (r: PreviewRow) => {
    setEditDraft({ name: r.name ?? "", dob: r.dob ?? "", mrn: r.mrn ?? "", patientId: r.patientId ?? "", insurance: r.insurance ?? "" });
    setEditingRow(r.rowIndex);
    setExpandedRow(r.rowIndex);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAll(); onOpenChange(v); }}>
        <DialogContent
          className={isWidePreview ? "flex flex-col w-[90vw] max-w-[1500px] h-[85vh] max-h-[85vh] overflow-hidden" : "sm:max-w-2xl"}
          data-testid="dialog-bulk-import-patients"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="w-4 h-4" /> Bulk Import Patients</DialogTitle>
            <DialogDescription>
              Add patients to Plexus EHR — upload a file (CSV, TSV, XLSX) for large lists, or paste patients in any format (AI-parsed). Separate from Import Test History.
            </DialogDescription>
          </DialogHeader>

          {/* ── STEP 1: SELECT + UPLOAD ─────────────────────────────── */}
          {jobId == null && parsedPatients == null && pasteResult == null && (
            <div className="space-y-3 py-1">
              {/* Intake mode toggle — Upload a file OR paste rows. */}
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => { setMode("file"); setUploadError(null); }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === "file" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-500 hover:text-slate-700"}`}
                  data-testid="button-bulk-mode-file"
                >
                  <Upload className="h-3.5 w-3.5" /> Upload file
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("paste"); setUploadError(null); }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === "paste" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-500 hover:text-slate-700"}`}
                  data-testid="button-bulk-mode-paste"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Quick Add from Text (AI)
                </button>
              </div>

              {mode === "file" ? (
                <div>
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Patient file</Label>
                  <input
                    type="file"
                    accept=".csv,.tsv,.tab,.xlsx,.xls,.xlsm"
                    className="mt-1 block w-full text-xs"
                    data-testid="input-bulk-import-file"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadError(null); }}
                  />
                  {file && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <FileSpreadsheet className="w-3 h-3" /> {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Paste patients</Label>
                  <Textarea
                    value={pasteText}
                    onChange={(e) => { setPasteText(e.target.value); setUploadError(null); }}
                    rows={10}
                    className="mt-1 text-xs font-mono"
                    data-testid="textarea-bulk-import-paste"
                    placeholder={"Paste patients in ANY format — AI parses it. One per block or line:\n\nJane Doe, DOB 1958-03-12, 555-0100, Medicare, Dx: HTN, T2DM\nJohn Roe 1962-11-02 M 555-0111 Aetna hyperlipidemia, CAD\n\nOr paste a free-form note, or spreadsheet rows. Names + DOB help accuracy."}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground" data-testid="text-bulk-paste-note">
                    Best for a few free-form / unstructured records — this uses the same AI parser as “Add Patient”. It does <b>not</b> capture MRN or Patient ID; for a structured spreadsheet with identifiers, use <b>Upload file</b>. Pick a facility, then Parse.
                  </p>
                </div>
              )}
              <div>
                <Label htmlFor="bulk-import-facility" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Facility <span className="normal-case font-normal text-muted-foreground">(leave blank if the file has a Facility column)</span>
                </Label>
                <Select value={facility} onValueChange={setFacility}>
                  <SelectTrigger id="bulk-import-facility" className="mt-1 h-9" data-testid="select-bulk-import-facility">
                    <SelectValue placeholder="Select a facility…" />
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_FACILITIES.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              {uploadError && (
                <div className="text-xs text-red-600 flex items-center gap-1" data-testid="text-bulk-import-upload-error">
                  <AlertTriangle className="w-3 h-3" /> {uploadError}
                </div>
              )}
            </div>
          )}

          {/* ── PASTE: REVIEW parsed patients ───────────────────────── */}
          {parsedPatients != null && pasteResult == null && (
            <div className="space-y-2 py-1" data-testid="state-bulk-paste-review">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Parsed {parsedPatients.length} patient{parsedPatients.length === 1 ? "" : "s"}
                </div>
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">AI-parsed</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Review names and DOBs, remove any bad rows, then add them to <b>{facility || "the facility"}</b>. Each patient is auto-run through Plexus IQ.
              </p>
              <div className="max-h-[46vh] overflow-y-auto space-y-2">
                {parsedPatients.map((p, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-md border border-slate-200 p-2" data-testid={`paste-review-row-${idx}`}>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          value={p.name ?? ""}
                          onChange={(e) => setParsedPatients((prev) => prev!.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                          className="h-8 flex-1 rounded border border-slate-200 px-2 text-sm font-medium"
                          data-testid={`paste-review-name-${idx}`}
                        />
                        {p.confidence === "low" && (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-300">low confidence</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                        <span>DOB:&nbsp;
                          <input
                            value={p.dob ?? ""}
                            placeholder="YYYY-MM-DD"
                            onChange={(e) => setParsedPatients((prev) => prev!.map((x, i) => i === idx ? { ...x, dob: e.target.value || null } : x))}
                            className="inline-block h-6 w-28 rounded border border-slate-200 px-1 text-[11px]"
                            data-testid={`paste-review-dob-${idx}`}
                          />
                        </span>
                        {p.gender && <span>Sex: {p.gender}</span>}
                        {p.phoneNumber && <span>Phone: {p.phoneNumber}</span>}
                        {p.insurance && <span>Ins: {p.insurance}</span>}
                        {p.diagnoses && <span className="w-full truncate">Dx: {p.diagnoses}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-500"
                      onClick={() => setParsedPatients((prev) => prev!.filter((_, i) => i !== idx))}
                      data-testid={`paste-review-remove-${idx}`}
                    >
                      <AlertTriangle className="hidden" />×
                    </Button>
                  </div>
                ))}
                {parsedPatients.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-500">All rows removed. Go back to paste again.</p>
                )}
              </div>
            </div>
          )}

          {/* ── PASTE: COMPLETE ─────────────────────────────────────── */}
          {pasteResult != null && (
            <div className="py-4 space-y-3 text-sm" data-testid="state-bulk-paste-complete">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="w-5 h-5" /> {pasteResult.created} patient{pasteResult.created === 1 ? "" : "s"} added</div>
              {pasteResult.failed > 0 && (
                <div className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {pasteResult.failed} could not be added</div>
              )}
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Plexus IQ is qualifying these patients
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Each added patient was auto-queued for Plexus IQ. Watch them move to Qualified / Not Qualified in Plexus IQ.
                </p>
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={viewInPlexusIq} data-testid="button-bulk-paste-view-iq" className="gap-1.5">
                    View in Plexus IQ <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2/3: PROCESSING ────────────────────────────────── */}
          {jobId != null && (status === "uploaded" || status === "parsing" || status === "validating") && (
            <div className="py-6 flex flex-col items-center gap-2 text-sm text-muted-foreground" data-testid="state-bulk-import-processing">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{status === "validating" ? "Validating patients…" : "Parsing file…"}</span>
              {counts && counts.total > 0 && <span className="text-xs">{counts.total} rows detected</span>}
            </div>
          )}

          {/* ── STEP 4/5: STRUCTURED REVIEW (FILE upload) ───────────── */}
          {jobId != null && status === "preview_ready" && counts && (
            <div className="flex flex-1 min-h-0 flex-col gap-3 py-1" data-testid="state-bulk-import-preview">
              {/* Summary strip — big numbers, short labels (iOS-like). */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-white/70 px-4 py-2.5 dark:bg-slate-900/40" data-testid="preview-summary-strip">
                <SummaryStat label="Parsed" value={reconciled!.parsed} />
                <SummaryStat label="Ready" value={reconciled!.ready} tone="emerald" />
                <SummaryStat label="Existing" value={reconciled!.existing} tone="sky" />
                <SummaryStat label="Possible" value={reconciled!.possible} tone="amber" />
                <SummaryStat label="Invalid" value={reconciled!.invalid} tone="rose" />
                {reconciled!.removed > 0 && <SummaryStat label="Removed" value={reconciled!.removed} tone="slate" />}
                <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span
                    className={reconciled!.balanced ? "text-emerald-600" : "text-rose-600"}
                    data-testid="reconcile-balance"
                    title={`parsed ${reconciled!.parsed} = ready ${reconciled!.ready} + existing ${reconciled!.existing} + possible ${reconciled!.possible} + invalid ${reconciled!.invalid} + removed ${reconciled!.removed}`}
                  >
                    {reconciled!.balanced ? "Rows reconciled ✓" : "Row count mismatch"}
                  </span>
                  {job?.facility && <span>Facility: <b className="text-slate-700 dark:text-slate-200">{job.facility}</b></span>}
                  {job?.detectedSheet && <span>Sheet: <b className="text-slate-700 dark:text-slate-200">{job.detectedSheet}</b></span>}
                </div>
              </div>

              {/* Compact warnings row. */}
              {((job?.warnings?.length ?? 0) > 0 || !facilityResolved || unmappedRelevantHeaders.length > 0) && (
                <div className="shrink-0 space-y-1">
                  {!facilityResolved && (
                    <div className="text-[11px] text-amber-700 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> No facility detected in the file and none selected — re-upload with a facility so patients are attributed correctly.
                    </div>
                  )}
                  {unmappedRelevantHeaders.length > 0 && (
                    <div className="text-[11px] text-amber-700 flex items-start gap-1" data-testid="warning-unmapped-columns">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>Unmapped column{unmappedRelevantHeaders.length > 1 ? "s" : ""} that look important: <b>{unmappedRelevantHeaders.join(", ")}</b>. Use Edit Column Mapping to assign them.</span>
                    </div>
                  )}
                  {(job?.warnings?.length ?? 0) > 0 && (
                    <div className="text-[11px] text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{job!.warnings.join(" · ")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Toolbar — search, filter chips, mapping + possible-match controls. */}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    placeholder="Search name, MRN, Patient ID…"
                    className="h-8 w-64 rounded-md border border-slate-200 pl-7 pr-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    data-testid="input-preview-search"
                  />
                </div>
                <div className="flex items-center gap-1" data-testid="preview-filter-chips">
                  <FilterChip label="All" active={previewFilter === "ALL"} onClick={() => setPreviewFilter("ALL")} testid="chip-filter-all" />
                  <FilterChip label="New" active={previewFilter === "NEW"} onClick={() => setPreviewFilter("NEW")} testid="chip-filter-new" />
                  <FilterChip label="Existing" active={previewFilter === "EXISTING_MATCH"} onClick={() => setPreviewFilter("EXISTING_MATCH")} testid="chip-filter-existing" />
                  <FilterChip label="Possible" active={previewFilter === "POSSIBLE_MATCH"} onClick={() => setPreviewFilter("POSSIBLE_MATCH")} testid="chip-filter-possible" />
                  <FilterChip label="Invalid" active={previewFilter === "INVALID"} onClick={() => setPreviewFilter("INVALID")} testid="chip-filter-invalid" />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {selectedRows.size > 0 && (
                    <Button size="sm" variant="outline" onClick={removeSelected} disabled={removing} data-testid="button-remove-selected" className="gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50">
                      {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove Selected ({selectedRows.size})
                    </Button>
                  )}
                  {reconciled!.invalid > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setConfirmRemoveInvalid(true)} disabled={removing} data-testid="button-remove-invalid" className="gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50">
                      <Trash2 className="w-3.5 h-3.5" /> Remove Invalid ({reconciled!.invalid})
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setMappingOpen((v) => !v)} data-testid="button-edit-mapping" className="gap-1.5">
                    <Settings2 className="w-3.5 h-3.5" /> Edit Column Mapping
                  </Button>
                  {counts.possible > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)} data-testid="button-review-possible-matches" className="gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Review {counts.possible} Possible Match{counts.possible !== 1 ? "es" : ""}
                    </Button>
                  )}
                </div>
              </div>

              {mappingOpen && (
                <div className="shrink-0">
                  <MappingEditor
                    jobId={jobId!}
                    headerFieldMapping={((job?.workbookInfo as { headerFieldMapping?: Array<{ header: string; field: string | null }> })?.headerFieldMapping) ?? []}
                    currentOverrides={(job?.columnOverrides as Record<string, string>) ?? {}}
                    onApplied={() => { setMappingOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId] }); }}
                  />
                </div>
              )}

              {/* Review TABLE — flexes to fill, scrolls internally, sticky header. */}
              <div className="flex-1 min-h-0 overflow-auto rounded-md border" data-testid="preview-table-region">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="text-left [&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-semibold [&>th]:text-slate-600 dark:[&>th]:text-slate-300">
                      <th className="w-6">
                        <input
                          type="checkbox"
                          aria-label="Select all visible rows"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          className="h-3.5 w-3.5 cursor-pointer align-middle"
                          data-testid="checkbox-select-all"
                        />
                      </th>
                      <th className="w-6"></th>
                      <th>Status</th>
                      <th>Patient</th>
                      <th>DOB</th>
                      <th>MRN</th>
                      <th>Patient ID</th>
                      <th>Insurance</th>
                      <th>Phone</th>
                      <th>Issues</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.map((r) => {
                      const expanded = expandedRow === r.rowIndex;
                      const removed = removedRows.has(r.rowIndex);
                      const selected = selectedRows.has(r.rowIndex);
                      // Inline identity edit is offered ONLY for rows needing review.
                      const needsReview = r.classification === "POSSIBLE_MATCH" || r.classification === "INVALID";
                      return (
                        <Fragment key={r.rowIndex}>
                          <tr
                            className={`cursor-pointer border-t hover:bg-slate-50 dark:hover:bg-slate-800/40 ${removed ? "opacity-50" : ""} ${selected ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}
                            onClick={() => setExpandedRow(expanded ? null : r.rowIndex)}
                            data-testid={`row-preview-${r.rowIndex}`}
                          >
                            <td className="px-2 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Select row ${r.rowIndex}`}
                                checked={selected}
                                disabled={removed}
                                onChange={() => toggleSelectRow(r.rowIndex)}
                                className="h-3.5 w-3.5 cursor-pointer align-middle"
                                data-testid={`checkbox-row-${r.rowIndex}`}
                              />
                            </td>
                            <td className="px-2 py-1.5 align-middle text-slate-400">
                              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </td>
                            <td className="px-2 py-1.5 align-middle">
                              {removed
                                ? <Badge variant="secondary" className="text-muted-foreground" data-testid={`badge-removed-${r.rowIndex}`}>Removed</Badge>
                                : badgeFor(r.classification)}
                            </td>
                            <td className={`px-2 py-1.5 align-middle font-medium text-slate-800 dark:text-slate-100 ${removed ? "line-through" : ""}`}>{r.name || <span className="text-rose-500">(no name)</span>}</td>
                            <td className={`px-2 py-1.5 align-middle whitespace-nowrap ${removed ? "line-through" : ""}`}>{r.dob ?? "—"}</td>
                            <td className={`px-2 py-1.5 align-middle whitespace-nowrap font-mono ${removed ? "line-through" : ""}`} data-testid={`cell-mrn-${r.rowIndex}`}>{r.mrn ?? "—"}</td>
                            <td className={`px-2 py-1.5 align-middle whitespace-nowrap font-mono ${removed ? "line-through" : ""}`} data-testid={`cell-patientid-${r.rowIndex}`}>{r.patientId ?? "—"}</td>
                            <td className={`px-2 py-1.5 align-middle max-w-[160px] truncate ${removed ? "line-through" : ""}`}>{r.insurance ?? "—"}</td>
                            <td className={`px-2 py-1.5 align-middle whitespace-nowrap ${removed ? "line-through" : ""}`}>{r.phone ?? "—"}</td>
                            <td className="px-2 py-1.5 align-middle">{issueSummary(r) ?? <span className="text-slate-300">—</span>}</td>
                            <td className="px-2 py-1.5 align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {removed ? (
                                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => restoreRow(r.rowIndex)} disabled={removing} data-testid={`button-restore-${r.rowIndex}`}>
                                    <RotateCcw className="h-3 w-3" />
                                  </Button>
                                ) : (
                                  <>
                                    {needsReview && (
                                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => startEdit(r)} data-testid={`button-edit-row-${r.rowIndex}`}>
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                    )}
                                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-rose-600" onClick={() => removeRows([{ rowIndex: r.rowIndex, classification: r.classification as PreviewClassification }])} disabled={removing} data-testid={`button-remove-row-${r.rowIndex}`}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="border-t bg-slate-50/70 dark:bg-slate-900/40" data-testid={`row-detail-${r.rowIndex}`}>
                              <td></td>
                              <td colSpan={10} className="px-3 py-2">
                                {editingRow === r.rowIndex ? (
                                  <IdentityEditForm
                                    draft={editDraft}
                                    onChange={setEditDraft}
                                    onCancel={() => setEditingRow(null)}
                                    onSave={() => saveRowEdit(r.rowIndex)}
                                    saving={savingEdit}
                                  />
                                ) : (
                                  <PreviewDetail r={r} onEdit={needsReview && !removed ? () => startEdit(r) : undefined} />
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {filteredPreviewRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-3 py-8 text-center text-xs text-muted-foreground">
                          {previewRows.length === 0 ? "No preview rows." : "No rows match this search / filter."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination + result count. */}
              <div className="flex shrink-0 items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Showing {filteredPreviewRows.length} of {previewRows.length} loaded
                  {(previewData?.total ?? 0) > previewRows.length ? ` · ${previewData?.total} total` : ""}
                </span>
                {(previewData?.total ?? 0) > PAGE && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" disabled={previewPage === 0} onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}>Prev</Button>
                    <span>{previewPage * PAGE + 1}–{Math.min((previewPage + 1) * PAGE, previewData!.total)} of {previewData!.total}</span>
                    <Button size="sm" variant="ghost" disabled={(previewPage + 1) * PAGE >= (previewData?.total ?? 0)} onClick={() => setPreviewPage((p) => p + 1)}>Next</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 8: IMPORTING ───────────────────────────────────── */}
          {jobId != null && status === "importing" && (
            <div className="py-6 flex flex-col items-center gap-2 text-sm" data-testid="state-bulk-import-importing">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Importing patients…</span>
              <span className="text-xs text-muted-foreground">{counts?.imported ?? 0} imported</span>
            </div>
          )}

          {/* ── COMPLETE → PLEXUS IQ PROGRESS ───────────────────────── */}
          {jobId != null && status === "completed" && counts && (
            <div className="py-4 space-y-4 text-sm" data-testid="state-bulk-import-complete">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-5 h-5" /> Imported {counts.imported}/{counts.imported} — Plexus IQ {iqPhaseLabel(iqProgress?.phase)}
              </div>

              {/* Big-number progress. Auto-IQ runs on import; no manual click. */}
              <div className="grid grid-cols-3 gap-3" data-testid="iq-progress-grid">
                <IqStat label="Qualified" value={iqProgress?.counts.qualified ?? 0} tone="emerald" />
                <IqStat label="Not Qualified" value={iqProgress?.counts.notQualified ?? 0} tone="slate" />
                <IqStat label="Failed" value={iqProgress?.counts.failed ?? 0} tone="rose" testid="iq-stat-failed" />
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Plexus IQ qualification
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="iq-progress-line">
                  {iqProgress
                    ? `${iqPhaseLabel(iqProgress.phase)} — ${iqProgress.analysis.completedPatients}/${iqProgress.analysis.totalPatients || iqProgress.imported} analyzed`
                    : "Starting Plexus IQ…"}
                  {(iqProgress?.counts.pending ?? 0) > 0 ? ` · ${iqProgress?.counts.pending} pending` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(iqProgress?.counts.failed ?? 0) > 0 && (
                    <Button size="sm" variant="outline" onClick={retryFailedIq} disabled={retrying} data-testid="button-bulk-import-retry-failed" className="gap-1.5">
                      {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Retry Failed ({iqProgress?.counts.failed})
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={viewInPlexusIq} data-testid="button-bulk-import-view-iq" className="gap-1.5">
                    View in Plexus IQ <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                <li><b>{counts.existing}</b> existing patients preserved (not re-imported)</li>
                <li><b>{counts.invalid}</b> invalid rows skipped</li>
              </ul>
            </div>
          )}

          {/* ── ERROR / CANCELLED ───────────────────────────────────── */}
          {jobId != null && (status === "failed" || status === "cancelled") && (
            <div className="py-4 text-sm" data-testid="state-bulk-import-error">
              <div className="flex items-center gap-2 text-red-600 font-semibold"><AlertTriangle className="w-5 h-5" /> {status === "cancelled" ? "Import cancelled" : "Import failed"}</div>
              {job?.error && <p className="text-xs text-muted-foreground mt-1">{job.error.type}: {job.error.message}</p>}
              <p className="text-xs text-muted-foreground mt-1">No partial patient data was left in an inconsistent state.</p>
            </div>
          )}

          <DialogFooter>
            {jobId == null && parsedPatients == null && pasteResult == null && (
              <>
                <Button variant="outline" size="sm" onClick={() => { resetAll(); onOpenChange(false); }}>Cancel</Button>
                {mode === "paste" ? (
                  <Button size="sm" disabled={!pasteText.trim() || parsing} onClick={parsePasteText} data-testid="button-bulk-import-parse-paste">
                    {parsing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ClipboardList className="w-3 h-3 mr-1" />} {parsing ? (parseProgress ?? "Parsing…") : "Parse Patients"}
                  </Button>
                ) : (
                  <Button size="sm" disabled={!file || uploading} onClick={handleUpload} data-testid="button-bulk-import-upload">
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />} Upload & Parse
                  </Button>
                )}
              </>
            )}
            {/* Paste review footer */}
            {parsedPatients != null && pasteResult == null && (
              <>
                <Button variant="outline" size="sm" onClick={() => setParsedPatients(null)} disabled={creating}>Back</Button>
                <Button
                  size="sm"
                  disabled={creating || parsedPatients.length === 0 || parsedPatients.some((p) => !(p.name ?? "").trim())}
                  onClick={createParsed}
                  data-testid="button-bulk-paste-create"
                >
                  {creating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                  Add {parsedPatients.length} & Run IQ
                </Button>
              </>
            )}
            {/* Paste complete footer */}
            {pasteResult != null && (
              <Button size="sm" onClick={() => { resetAll(); onOpenChange(false); }} data-testid="button-bulk-paste-done">Done</Button>
            )}
            {jobId != null && status === "preview_ready" && counts && (
              <>
                <Button variant="outline" size="sm" onClick={() => { resetAll(); }}>Start Over</Button>
                <Button size="sm" onClick={confirmImport} disabled={(reconciled?.ready ?? 0) === 0} data-testid="button-bulk-import-confirm">
                  Import {reconciled?.ready ?? counts.new} Ready Patient{(reconciled?.ready ?? counts.new) === 1 ? "" : "s"}
                </Button>
              </>
            )}
            {jobId != null && (status === "completed" || status === "failed" || status === "cancelled") && (
              <Button size="sm" onClick={() => { resetAll(); onOpenChange(false); }} data-testid="button-bulk-import-done">Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Possible-match review sub-dialog */}
      {jobId != null && (
        <PossibleMatchReview open={reviewOpen} onOpenChange={setReviewOpen} jobId={jobId} />
      )}

      {/* Remove-Invalid confirmation */}
      <Dialog open={confirmRemoveInvalid} onOpenChange={setConfirmRemoveInvalid}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-remove-invalid">
          <DialogHeader>
            <DialogTitle>Remove invalid rows?</DialogTitle>
            <DialogDescription>
              {reconciled?.invalid ?? 0} invalid row{(reconciled?.invalid ?? 0) === 1 ? "" : "s"} will be excluded from this import. This only affects this preview — no existing patient is deleted, and invalid rows never import anyway.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setConfirmRemoveInvalid(false)} data-testid="button-cancel-remove-invalid">Cancel</Button>
            <Button size="sm" onClick={removeInvalid} disabled={removing} data-testid="button-confirm-remove-invalid" className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Remove {reconciled?.invalid ?? 0} Invalid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Phase → short human label for the progress view.
function iqPhaseLabel(phase?: string): string {
  switch (phase) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "complete": return "Complete";
    case "failed": return "Failed";
    default: return "Queued";
  }
}

// Large-number IQ stat tile (short label under a big number).
function IqStat({ label, value, tone, testid }: { label: string; value: number; tone: "emerald" | "slate" | "rose"; testid?: string }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-600" :
    tone === "rose" ? "text-rose-600" : "text-slate-600 dark:text-slate-300";
  return (
    <div className="flex flex-col items-center rounded-xl border bg-white/70 py-3 dark:bg-slate-900/40" data-testid={testid ?? `iq-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className={`text-3xl font-semibold tabular-nums ${toneCls}`}>{value}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

// Summary-strip stat — big number + short label (iOS-like, not a dashboard card).
function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "sky" | "amber" | "rose" | "slate" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-600" :
    tone === "sky" ? "text-sky-600" :
    tone === "amber" ? "text-amber-600" :
    tone === "rose" ? "text-rose-600" :
    tone === "slate" ? "text-slate-500" : "text-slate-800 dark:text-slate-100";
  return (
    <div className="flex flex-col items-center leading-none" data-testid={`summary-stat-${label.toLowerCase()}`}>
      <span className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function FilterChip({ label, active, onClick, testid }: { label: string; active: boolean; onClick: () => void; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

// Short, non-bloating issue text for the table's Issues column. Full reasons
// live in the expansion.
function issueSummary(r: PreviewRow): ReactNode {
  const reasons = (r.reasons ?? []).filter((c) => c !== "missing_dob_warning");
  const hasDobWarn = (r.reasons ?? []).includes("missing_dob_warning");
  const parts: string[] = [];
  if (reasons.length > 0) parts.push(prettifyReason(reasons[0]) + (reasons.length > 1 ? ` +${reasons.length - 1}` : ""));
  else if (hasDobWarn) parts.push("No DOB");
  if (parts.length === 0) return null;
  const tone = r.classification === "INVALID" ? "text-rose-600" : "text-amber-600";
  return <span className={`text-[11px] ${tone}`}>{parts.join(" · ")}</span>;
}

function prettifyReason(code: string): string {
  const map: Record<string, string> = {
    missing_name: "Missing name",
    provider_name_not_patient: "Looks like a provider, not a patient",
    missing_dob_warning: "No DOB",
    duplicate_within_file: "Duplicate row in this file",
  };
  return map[code] ?? code.replace(/_/g, " ");
}

// Inline detail panel — all parsed fields + full diagnoses/meds/history +
// classification reasons for one preview row. Rendered only when expanded.
function PreviewDetail({ r, onEdit }: { r: PreviewRow; onEdit?: () => void }) {
  const field = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs text-slate-700 dark:text-slate-200 break-words">{value == null || value === "" ? "—" : value}</div>
    </div>
  );
  const reasons = r.reasons ?? [];
  return (
    <div className="space-y-2" data-testid={`preview-detail-${r.rowIndex}`}>
      {onEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={onEdit} data-testid={`button-edit-detail-${r.rowIndex}`}>
            <Pencil className="h-3 w-3" /> Edit identity fields
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {field("Patient ID", r.patientId)}
        {field("MRN", r.mrn)}
        {field("DOB", r.dob)}
        {field("Sex", r.gender)}
        {field("Phone", r.phone)}
        {field("Email", r.email)}
        {field("Insurance", r.insurance)}
        {field("Facility", r.facility)}
        {field("Provider", r.provider)}
        {field("Source row", `#${r.rowIndex}`)}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-3">
        {field("Diagnoses", r.diagnoses)}
        {field("Medications", r.medications)}
        {field("History", r.history)}
      </div>
      {reasons.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Classification notes</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {reasons.map((code, i) => (
              <span key={i} className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">{prettifyReason(code)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline editor for review-required identity fields. Persists through the
// per-row override endpoint, which re-normalizes AND re-classifies the row
// server-side — never a client-only status change.
function IdentityEditForm({
  draft, onChange, onCancel, onSave, saving,
}: {
  draft: { name: string; dob: string; mrn: string; patientId: string; insurance: string };
  onChange: (d: { name: string; dob: string; mrn: string; patientId: string; insurance: string }) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = (k: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [k]: e.target.value });
  const inputCls = "h-8 w-full rounded-md border border-slate-200 px-2 text-xs dark:border-slate-700 dark:bg-slate-900";
  const cell = (label: string, k: keyof typeof draft, mono = false, testid?: string) => (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <input value={draft[k]} onChange={set(k)} className={`${inputCls} ${mono ? "font-mono" : ""}`} data-testid={testid} />
    </div>
  );
  return (
    <div className="space-y-2" data-testid="identity-edit-form">
      <div className="text-[11px] text-muted-foreground">
        Correct this row, then re-check. The row is re-normalized and re-classified against existing patients — nothing is written until you confirm the import.
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {cell("Name", "name", false, "edit-input-name")}
        {cell("DOB", "dob", false, "edit-input-dob")}
        {cell("MRN", "mrn", true, "edit-input-mrn")}
        {cell("Patient ID", "patientId", true, "edit-input-patientid")}
        {cell("Insurance", "insurance", false, "edit-input-insurance")}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving} data-testid="button-save-row-edit" className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save &amp; Re-check
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving} data-testid="button-cancel-row-edit">Cancel</Button>
      </div>
    </div>
  );
}

function PossibleMatchReview({ open, onOpenChange, jobId }: { open: boolean; onOpenChange: (v: boolean) => void; jobId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const { data } = useQuery<{ total: number; items: PossibleMatchItem[] }>({
    queryKey: ["/api/patient-import/large", jobId, "possible-matches", page],
    queryFn: async () =>
      (await apiRequest("GET", `/api/patient-import/large/${jobId}/possible-matches?offset=${page * PAGE}&limit=${PAGE}`)).json(),
    enabled: open,
  });

  const resolve = async (item: PossibleMatchItem, decision: "use_existing" | "import_as_new" | "skip") => {
    try {
      await apiRequest("POST", `/api/patient-import/large/${jobId}/possible-matches/${item.rowIndex}/resolve`, {
        decision,
        matchedScreeningId: decision === "use_existing" ? item.existingPatient?.screeningId : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId, "possible-matches"] });
    } catch (e) {
      toast({ title: "Could not save decision", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  };

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="dialog-possible-matches">
        <DialogHeader>
          <DialogTitle>Review Possible Matches</DialogTitle>
          <DialogDescription>
            These rows weakly match an existing patient. Nothing here is imported until you decide. Unresolved rows are never auto-imported.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {items.map((item) => (
            <div key={item.rowIndex} className="border rounded-md p-2 text-xs" data-testid={`possible-match-${item.rowIndex}`}>
              <div className="text-[10px] uppercase tracking-wider text-amber-700 mb-1">{item.matchReason}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="font-semibold text-slate-700 mb-0.5">Incoming</div>
                  <IdentityBlock r={item.incoming} />
                </div>
                <div>
                  <div className="font-semibold text-slate-700 mb-0.5">Potential existing</div>
                  {item.existingPatient ? <IdentityBlock r={item.existingPatient} /> : <div className="text-muted-foreground">Duplicate within this file</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant={item.decision?.decision === "use_existing" ? "default" : "outline"} disabled={!item.existingPatient} onClick={() => resolve(item, "use_existing")} data-testid={`btn-use-existing-${item.rowIndex}`}>Use Existing</Button>
                <Button size="sm" variant={item.decision?.decision === "import_as_new" ? "default" : "outline"} onClick={() => resolve(item, "import_as_new")} data-testid={`btn-import-new-${item.rowIndex}`}>Import As New</Button>
                <Button size="sm" variant={item.decision?.decision === "skip" ? "default" : "outline"} onClick={() => resolve(item, "skip")} data-testid={`btn-skip-${item.rowIndex}`}>Skip</Button>
                {item.decision && <span className="text-[10px] text-emerald-700 ml-auto">Saved: {item.decision.decision.replace("_", " ")}</span>}
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-muted-foreground py-4 text-center">No possible matches to review.</div>}
        </div>
        {(data?.total ?? 0) > PAGE && (
          <div className="flex items-center justify-between text-xs">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
            <span>Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, data!.total)} of {data!.total}</span>
            <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)} data-testid="button-close-possible-matches">Done Reviewing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Canonical field vocabulary offered in the mapping editor (+ Ignore).
const MAPPING_FIELDS: Array<{ value: string; label: string }> = [
  { value: "__auto__", label: "Auto-detect" },
  { value: "name", label: "Name" }, { value: "firstName", label: "First Name" }, { value: "lastName", label: "Last Name" },
  { value: "dob", label: "DOB" }, { value: "gender", label: "Sex" }, { value: "phone", label: "Phone" },
  { value: "email", label: "Email" }, { value: "mrn", label: "MRN" }, { value: "patientId", label: "Patient ID" }, { value: "insurance", label: "Insurance" },
  { value: "memberId", label: "Member ID" }, { value: "facility", label: "Facility" }, { value: "provider", label: "Provider" },
  { value: "address", label: "Address" }, { value: "diagnoses", label: "Diagnoses" }, { value: "medications", label: "Medications" },
  { value: "history", label: "History" }, { value: "allergies", label: "Allergies" }, { value: "notes", label: "Notes" },
  { value: "ignore", label: "Ignore" },
];

function MappingEditor({ jobId, headerFieldMapping, currentOverrides, onApplied }: {
  jobId: number;
  headerFieldMapping: Array<{ header: string; field: string | null }>;
  currentOverrides: Record<string, string>;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [sel, setSel] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const { header, field } of headerFieldMapping) init[header] = currentOverrides[header] ?? field ?? "__auto__";
    return init;
  });
  const [applying, setApplying] = useState(false);

  const apply = async () => {
    setApplying(true);
    try {
      // Only send explicit overrides (a real field or "ignore"); "__auto__" is omitted.
      const columnOverrides: Record<string, string> = {};
      for (const { header } of headerFieldMapping) {
        const v = sel[header];
        if (v && v !== "__auto__") columnOverrides[header] = v;
      }
      await apiRequest("PATCH", `/api/patient-import/large/${jobId}/mapping`, { columnOverrides });
      toast({ title: "Mapping applied", description: "Re-normalizing the entire import…" });
      onApplied();
    } catch (e) {
      toast({ title: "Could not apply mapping", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-md border p-2 space-y-2" data-testid="mapping-editor">
      <div className="text-xs font-semibold">Detected column mapping — correct any column, then apply to the entire import</div>
      <div className="max-h-48 overflow-auto space-y-1">
        {headerFieldMapping.map(({ header }) => (
          <div key={header} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate font-mono">{header}</span>
            <span className="text-muted-foreground">→</span>
            <select
              className="border rounded px-1 py-0.5 text-xs"
              value={sel[header] ?? "__auto__"}
              onChange={(e) => setSel((s) => ({ ...s, [header]: e.target.value }))}
              data-testid={`map-${header}`}
            >
              {MAPPING_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={apply} disabled={applying} data-testid="button-apply-mapping">
        {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Apply to Entire Import
      </Button>
    </div>
  );
}

function IdentityBlock({ r }: { r: { name: string; dob: string | null; phone: string | null; mrn: string | null; patientId?: string | null; facility: string | null } }) {
  return (
    <div className="space-y-0.5 text-slate-600">
      <div><b>{r.name}</b></div>
      <div>DOB: {r.dob ?? "—"}</div>
      <div>Phone: {r.phone ?? "—"}</div>
      <div>MRN: {r.mrn ?? "—"}</div>
      {r.patientId !== undefined && <div>Patient ID: {r.patientId ?? "—"}</div>}
      <div>Facility: {r.facility ?? "—"}</div>
    </div>
  );
}
