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

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { VALID_FACILITIES } from "@shared/plexus";
import { Loader2, Upload, Users, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";

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
  rowIndex: number; name: string; dob: string | null; phone: string | null;
  mrn: string | null; facility: string | null; insurance: string | null;
  classification: Classification;
};
type PossibleMatchItem = {
  rowIndex: number;
  incoming: { name: string; dob: string | null; phone: string | null; mrn: string | null; facility: string | null; insurance: string | null };
  existingPatient: { screeningId: number; name: string; dob: string | null; phone: string | null; mrn: string | null; facility: string | null } | null;
  matchReason: string;
  decision: { decision: string; matchedScreeningId: number | null } | null;
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

export function BulkImportPatientsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [facility, setFacility] = useState<string>("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);

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

  const resetAll = () => {
    setFile(null); setFacility(""); setJobId(null); setUploading(false);
    setUploadError(null); setPreviewPage(0); setReviewOpen(false);
  };

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

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAll(); onOpenChange(v); }}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-bulk-import-patients">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="w-4 h-4" /> Bulk Import Patients</DialogTitle>
            <DialogDescription>
              Upload a patient file (CSV, TSV, or XLSX) to import into Plexus EHR. Large files are streamed and processed in the background — this is separate from Import Test History.
            </DialogDescription>
          </DialogHeader>

          {/* ── STEP 1: SELECT + UPLOAD ─────────────────────────────── */}
          {jobId == null && (
            <div className="space-y-3 py-1">
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

          {/* ── STEP 2/3: PROCESSING ────────────────────────────────── */}
          {jobId != null && (status === "uploaded" || status === "parsing" || status === "validating") && (
            <div className="py-6 flex flex-col items-center gap-2 text-sm text-muted-foreground" data-testid="state-bulk-import-processing">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{status === "validating" ? "Validating patients…" : "Parsing file…"}</span>
              {counts && counts.total > 0 && <span className="text-xs">{counts.total} rows detected</span>}
            </div>
          )}

          {/* ── STEP 4/5: PREVIEW ───────────────────────────────────── */}
          {jobId != null && status === "preview_ready" && counts && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-4 gap-2 text-center">
                <CountTile label="Total" value={counts.total} />
                <CountTile label="New" value={counts.new} tone="emerald" />
                <CountTile label="Existing" value={counts.existing} tone="sky" />
                <CountTile label="Possible" value={counts.possible} tone="amber" />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Invalid (won't import): <b>{counts.invalid}</b></span>
                {job?.facility && <span>Facility: <b>{job.facility}</b></span>}
                {job?.detectedSheet && <span>Sheet: <b>{job.detectedSheet}</b></span>}
                {Object.keys(job?.detectedColumns ?? {}).length > 0 && (
                  <span>Detected columns: <b>{Object.keys(job!.detectedColumns).join(", ")}</b></span>
                )}
              </div>
              {(job?.warnings?.length ?? 0) > 0 && (
                <div className="text-xs text-amber-700 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{job!.warnings.join(" · ")}</span>
                </div>
              )}
              {!facilityResolved && (
                <div className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> No facility detected in the file and none selected. Re-upload with a facility selected so patients are attributed correctly.
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setMappingOpen((v) => !v)} data-testid="button-edit-mapping" className="gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Edit Column Mapping
                </Button>
                {counts.possible > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)} data-testid="button-review-possible-matches" className="gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Review {counts.possible} Possible Match{counts.possible !== 1 ? "es" : ""}
                  </Button>
                )}
              </div>

              {mappingOpen && (
                <MappingEditor
                  jobId={jobId!}
                  headerFieldMapping={((job?.workbookInfo as { headerFieldMapping?: Array<{ header: string; field: string | null }> })?.headerFieldMapping) ?? []}
                  currentOverrides={(job?.columnOverrides as Record<string, string>) ?? {}}
                  onApplied={() => { setMappingOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/patient-import/large", jobId] }); }}
                />
              )}

              {/* Paginated preview table */}
              <div className="border rounded-md max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr className="text-left">
                      <th className="px-2 py-1">Name</th><th className="px-2 py-1">DOB</th>
                      <th className="px-2 py-1">Phone</th><th className="px-2 py-1">MRN</th>
                      <th className="px-2 py-1">Facility</th><th className="px-2 py-1">Class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewData?.rows ?? []).map((r) => (
                      <tr key={r.rowIndex} className="border-t" data-testid={`row-preview-${r.rowIndex}`}>
                        <td className="px-2 py-1">{r.name}</td><td className="px-2 py-1">{r.dob ?? "—"}</td>
                        <td className="px-2 py-1">{r.phone ?? "—"}</td><td className="px-2 py-1">{r.mrn ?? "—"}</td>
                        <td className="px-2 py-1">{r.facility ?? "—"}</td><td className="px-2 py-1">{badgeFor(r.classification)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(previewData?.total ?? 0) > PAGE && (
                <div className="flex items-center justify-between text-xs">
                  <Button size="sm" variant="ghost" disabled={previewPage === 0} onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}>Prev</Button>
                  <span>Showing {previewPage * PAGE + 1}–{Math.min((previewPage + 1) * PAGE, previewData!.total)} of {previewData!.total}</span>
                  <Button size="sm" variant="ghost" disabled={(previewPage + 1) * PAGE >= (previewData?.total ?? 0)} onClick={() => setPreviewPage((p) => p + 1)}>Next</Button>
                </div>
              )}
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

          {/* ── COMPLETE ────────────────────────────────────────────── */}
          {jobId != null && status === "completed" && counts && (
            <div className="py-4 space-y-2 text-sm" data-testid="state-bulk-import-complete">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="w-5 h-5" /> Import complete</div>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li><b>{counts.imported}</b> patients imported</li>
                <li><b>{counts.existing}</b> existing patients preserved</li>
                <li><b>{counts.possible}</b> possible matches (resolved per your review)</li>
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
            {jobId == null && (
              <>
                <Button variant="outline" size="sm" onClick={() => { resetAll(); onOpenChange(false); }}>Cancel</Button>
                <Button size="sm" disabled={!file || uploading} onClick={handleUpload} data-testid="button-bulk-import-upload">
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />} Upload & Parse
                </Button>
              </>
            )}
            {jobId != null && status === "preview_ready" && counts && (
              <>
                <Button variant="outline" size="sm" onClick={() => { resetAll(); }}>Start Over</Button>
                <Button size="sm" onClick={confirmImport} data-testid="button-bulk-import-confirm">
                  Confirm Import — {counts.new} new{counts.possible > 0 ? " + resolved possibles" : ""}
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
    </>
  );
}

function CountTile({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "sky" | "amber" }) {
  const toneCls = tone === "emerald" ? "text-emerald-700" : tone === "sky" ? "text-sky-700" : tone === "amber" ? "text-amber-700" : "text-slate-800";
  return (
    <div className="rounded-md border bg-white/60 py-2">
      <div className={`text-lg font-bold ${toneCls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
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
  { value: "email", label: "Email" }, { value: "mrn", label: "MRN" }, { value: "insurance", label: "Insurance" },
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

function IdentityBlock({ r }: { r: { name: string; dob: string | null; phone: string | null; mrn: string | null; facility: string | null } }) {
  return (
    <div className="space-y-0.5 text-slate-600">
      <div><b>{r.name}</b></div>
      <div>DOB: {r.dob ?? "—"}</div>
      <div>Phone: {r.phone ?? "—"}</div>
      <div>MRN: {r.mrn ?? "—"}</div>
      <div>Facility: {r.facility ?? "—"}</div>
    </div>
  );
}
