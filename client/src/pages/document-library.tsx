import { useState, useRef, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useDocumentLibrary,
  useDocumentLibraryMeta,
  useDocumentVersions,
  useUploadDocument,
  useDeleteDocument,
  useSupersedeDocument,
  useAddDocumentAssignment,
  useRemoveDocumentAssignment,
  type LibraryDoc,
} from "@/hooks/api/documents-library";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Library,
  Upload,
  FileText,
  Trash2,
  History,
  ExternalLink,
  Loader2,
  RefreshCw,
  Tag,
  Plus,
  X,
  PenLine,
  BookOpen,
} from "lucide-react";

const KIND_LABELS: Record<string, string> = {
  informed_consent: "Informed Consent",
  screening_form: "Screening Form",
  marketing: "Marketing",
  training: "Training",
  reference: "Reference",
  clinician_pdf: "Clinician PDF",
  report: "Report",
  other: "Other",
};

const KIND_ORDER = [
  "informed_consent",
  "screening_form",
  "marketing",
  "training",
  "reference",
  "clinician_pdf",
  "report",
  "other",
];

// Spine color palettes per kind, applied in light & dark via tailwind.
const KIND_SPINE: Record<string, { light: string; dark: string; accent: string }> = {
  informed_consent: { light: "bg-rose-200 text-rose-900", dark: "dark:bg-rose-900 dark:text-rose-100", accent: "bg-rose-500" },
  screening_form: { light: "bg-amber-200 text-amber-900", dark: "dark:bg-amber-900 dark:text-amber-100", accent: "bg-amber-500" },
  marketing: { light: "bg-pink-200 text-pink-900", dark: "dark:bg-pink-900 dark:text-pink-100", accent: "bg-pink-500" },
  training: { light: "bg-emerald-200 text-emerald-900", dark: "dark:bg-emerald-900 dark:text-emerald-100", accent: "bg-emerald-500" },
  reference: { light: "bg-sky-200 text-sky-900", dark: "dark:bg-sky-900 dark:text-sky-100", accent: "bg-sky-500" },
  clinician_pdf: { light: "bg-violet-200 text-violet-900", dark: "dark:bg-violet-900 dark:text-violet-100", accent: "bg-violet-500" },
  report: { light: "bg-teal-200 text-teal-900", dark: "dark:bg-teal-900 dark:text-teal-100", accent: "bg-teal-500" },
  other: { light: "bg-slate-200 text-slate-800", dark: "dark:bg-slate-700 dark:text-slate-100", accent: "bg-slate-500" },
};

const SURFACE_LABELS: Record<string, string> = {
  tech_consent_picker: "Technician Consent Picker",
  scheduler_resources: "Scheduler Resources",
  patient_chart: "Patient Chart",
  liaison_drawer: "Liaison Drawer",
  marketing_hub: "Marketing Hub",
  training_library: "Training Library",
  internal_reference: "Internal Reference",
};

const SIG_LABELS: Record<string, string> = {
  none: "No signature",
  patient: "Patient signature",
  clinician: "Clinician signature",
  both: "Patient + Clinician",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Deterministic pseudo-random book height so the shelf looks varied.
function bookHeight(id: number): number {
  const heights = [180, 200, 196, 208, 188, 212, 192, 204];
  return heights[id % heights.length];
}

export default function DocumentLibraryPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);

  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterSurface, setFilterSurface] = useState<string>("all");
  const [filterPatientId, setFilterPatientId] = useState<string>("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<string>("");
  const [sigReq, setSigReq] = useState<string>("none");
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPatientId, setUploadPatientId] = useState<string>("");
  const [uploadFacility, setUploadFacility] = useState<string>("");

  const [versionsOpenFor, setVersionsOpenFor] = useState<number | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<number | null>(null);

  const { data: meta } = useDocumentLibraryMeta();

  const { data: docs = [], isLoading } = useDocumentLibrary({
    kind: filterKind,
    surface: filterSurface,
    patientId: filterPatientId,
  });

  const visibleDocs = useMemo(() => {
    if (filterSurface !== "all" && filterKind !== "all") {
      return docs.filter((d) => d.kind === filterKind);
    }
    return docs;
  }, [docs, filterKind, filterSurface]);

  // Build the list of shelves to render. We always show the canonical kinds,
  // plus any unexpected kind found in the data. When the user filters by a
  // single kind we only show that shelf.
  const shelves = useMemo(() => {
    const fromMeta = meta?.kinds ?? [];
    const ordered = [
      ...KIND_ORDER,
      ...fromMeta.filter((k) => !KIND_ORDER.includes(k)),
    ];
    const unexpected = Array.from(new Set(visibleDocs.map((d) => d.kind))).filter(
      (k) => !ordered.includes(k),
    );
    const allKinds = [...ordered, ...unexpected];
    const filteredKinds = filterKind === "all" ? allKinds : allKinds.filter((k) => k === filterKind);
    return filteredKinds.map((k) => ({
      kind: k,
      label: KIND_LABELS[k] ?? k,
      docs: visibleDocs.filter((d) => d.kind === k),
    }));
  }, [meta, visibleDocs, filterKind]);

  const uploadMutation = useUploadDocument();
  const deleteMutation = useDeleteDocument();
  const supersedeMutation = useSupersedeDocument();
  const addAssignmentMutation = useAddDocumentAssignment();
  const removeAssignmentMutation = useRemoveDocumentAssignment();

  function handleUpload() {
    if (!file || !title.trim() || !kind) {
      toast({
        title: "Upload failed",
        description: "title, kind, and file are required",
        variant: "destructive",
      });
      return;
    }
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("description", description.trim());
    fd.append("kind", kind);
    fd.append("signatureRequirement", sigReq);
    fd.append("surfaces", JSON.stringify(surfaces));
    const trimmedPid = uploadPatientId.trim();
    if (trimmedPid && /^\d+$/.test(trimmedPid))
      fd.append("patientScreeningId", trimmedPid);
    const trimmedFac = uploadFacility.trim();
    if (trimmedFac) fd.append("facility", trimmedFac);
    fd.append("file", file);
    uploadMutation.mutate(fd, {
      onSuccess: () => {
        toast({ title: "Document uploaded" });
        setTitle("");
        setDescription("");
        setKind("");
        setSigReq("none");
        setSurfaces([]);
        setFile(null);
        setUploadPatientId("");
        setUploadFacility("");
        if (fileRef.current) fileRef.current.value = "";
        setUploadOpen(false);
      },
      onError: (e: Error) =>
        toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
    });
  }

  function handleDelete(id: number) {
    deleteMutation.mutate(id, {
      onSuccess: () => toast({ title: "Document deleted" }),
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    });
  }

  function handleSupersede(id: number, replacementFile: File) {
    supersedeMutation.mutate(
      { id, file: replacementFile },
      {
        onSuccess: () => {
          setReplaceTargetId(null);
          if (replaceFileRef.current) replaceFileRef.current.value = "";
          toast({ title: "New version uploaded" });
        },
        onError: (e: Error) =>
          toast({ title: "Replace failed", description: e.message, variant: "destructive" }),
      },
    );
  }

  function handleAddAssignment(id: number, surface: string) {
    addAssignmentMutation.mutate(
      { id, surface },
      {
        onError: (e: Error) =>
          toast({ title: "Assign failed", description: e.message, variant: "destructive" }),
      },
    );
  }

  function handleRemoveAssignment(id: number, surface: string) {
    removeAssignmentMutation.mutate(
      { id, surface },
      {
        onError: (e: Error) =>
          toast({ title: "Unassign failed", description: e.message, variant: "destructive" }),
      },
    );
  }

  function toggleSurface(s: string) {
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[hsl(210,35%,96%)] dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-5 py-8">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <PageHeader
            eyebrow="PLEXUS · ADMIN"
            icon={Library}
            iconAccent="bg-indigo-100 text-indigo-700"
            title="Document Library"
            subtitle="Browse documents on shelves grouped by kind. Add new books to the library from the top-right."
            className="flex-1 min-w-[260px]"
          />
          <Button
            onClick={() => setUploadOpen(true)}
            className="shrink-0 mt-2"
            data-testid="button-open-upload"
          >
            <Plus className="w-4 h-4 mr-2" /> Add Document
          </Button>
        </div>

        {/* ── Filter bar ──────────────────────────────────────────── */}
        <Card
          className="p-4 rounded-2xl border-slate-200 dark:border-slate-800 dark:bg-slate-900 flex flex-wrap items-center gap-3 mb-6"
          data-testid="filter-bar"
        >
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Filter</span>
          </div>
          <Select value={filterKind} onValueChange={setFilterKind}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="filter-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {(meta?.kinds ?? []).map((k) => (
                <SelectItem key={k} value={k}>{KIND_LABELS[k] ?? k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSurface} onValueChange={setFilterSurface}>
            <SelectTrigger className="w-56 h-8 text-xs" data-testid="filter-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All surfaces</SelectItem>
              {(meta?.surfaces ?? []).map((s) => (
                <SelectItem key={s} value={s}>{SURFACE_LABELS[s] ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Patient ID"
            value={filterPatientId}
            onChange={(e) => setFilterPatientId(e.target.value)}
            className="w-32 h-8 text-xs"
            data-testid="filter-patient-id"
          />
          <span className="text-xs text-slate-400 ml-auto">
            {visibleDocs.length} document{visibleDocs.length !== 1 ? "s" : ""}
          </span>
        </Card>

        {/* ── Bookshelves ─────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : (
          <div className="space-y-8" data-testid="bookshelf">
            {shelves.map((shelf) => (
              <section key={shelf.kind} data-testid={`shelf-${shelf.kind}`}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 tracking-wide uppercase">
                      {shelf.label}
                    </h2>
                    <Badge variant="secondary" className="text-[10px]">
                      {shelf.docs.length}
                    </Badge>
                  </div>
                </div>

                <div className="relative">
                  {/* Books row */}
                  <div
                    className="flex items-end gap-2 flex-wrap min-h-[140px] px-3 pt-4 pb-2 rounded-t-xl bg-gradient-to-b from-amber-50/40 to-transparent dark:from-slate-900/60 dark:to-transparent"
                  >
                    {shelf.docs.length === 0 ? (
                      <div
                        className="w-full text-center text-xs italic text-slate-400 dark:text-slate-500 py-6"
                        data-testid={`shelf-empty-${shelf.kind}`}
                      >
                        Shelf is empty — add a {shelf.label.toLowerCase()} document to fill it.
                      </div>
                    ) : (
                      shelf.docs.map((doc) => (
                        <BookSpine
                          key={doc.id}
                          doc={doc}
                          metaSurfaces={meta?.surfaces ?? []}
                          onAddSurface={(surface) => handleAddAssignment(doc.id, surface)}
                          onRemoveSurface={(surface) => handleRemoveAssignment(doc.id, surface)}
                          onDelete={() => {
                            if (confirm(`Delete "${doc.title}"? This removes the file and its assignments.`)) {
                              handleDelete(doc.id);
                            }
                          }}
                          onReplace={() => {
                            setReplaceTargetId(doc.id);
                            replaceFileRef.current?.click();
                          }}
                          onToggleVersions={() =>
                            setVersionsOpenFor(versionsOpenFor === doc.id ? null : doc.id)
                          }
                          versionsOpen={versionsOpenFor === doc.id}
                        />
                      ))
                    )}
                  </div>
                  {/* Wooden shelf baseline */}
                  <div className="h-2.5 rounded-b-md bg-gradient-to-b from-amber-700 to-amber-900 dark:from-amber-800 dark:to-amber-950 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.45)]" />
                  <div className="h-1 mx-3 bg-amber-950/40 dark:bg-black/40 rounded-b-sm" />
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Hidden file input for "Replace" flow */}
        <input
          ref={replaceFileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && replaceTargetId !== null) {
              handleSupersede(replaceTargetId, f);
            }
          }}
        />
      </div>

      {/* ── Upload dialog ─────────────────────────────────────────── */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) {
            setTitle("");
            setDescription("");
            setKind("");
            setSigReq("none");
            setSurfaces([]);
            setFile(null);
            setUploadPatientId("");
            setUploadFacility("");
            if (fileRef.current) fileRef.current.value = "";
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="upload-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-600" /> Add Document to Library
            </DialogTitle>
            <DialogDescription>
              Upload a file once. Tag it with a kind, signature requirement, and the surfaces where it should appear.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3" data-testid="upload-form">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. BrainWave Informed Consent v2"
                data-testid="input-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about this document"
                rows={2}
                data-testid="input-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger data-testid="select-kind">
                    <SelectValue placeholder="Select kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.kinds ?? []).map((k) => (
                      <SelectItem key={k} value={k}>{KIND_LABELS[k] ?? k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Signature</Label>
                <Select value={sigReq} onValueChange={setSigReq}>
                  <SelectTrigger data-testid="select-signature">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.signatureRequirements ?? ["none", "patient", "clinician", "both"]).map((s) => (
                      <SelectItem key={s} value={s}>{SIG_LABELS[s] ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Surfaces</Label>
              <div className="flex flex-wrap gap-1.5">
                {(meta?.surfaces ?? []).map((s) => {
                  const active = surfaces.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSurface(s)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
                      }`}
                      data-testid={`toggle-surface-${s}`}
                    >
                      {SURFACE_LABELS[s] ?? s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Patient ID (optional)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 1856"
                  value={uploadPatientId}
                  onChange={(e) => setUploadPatientId(e.target.value)}
                  data-testid="input-upload-patient-id"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Facility (optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g. Main Clinic"
                  value={uploadFacility}
                  onChange={(e) => setUploadFacility(e.target.value)}
                  data-testid="input-upload-facility"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>File</Label>
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-100 hover:file:bg-slate-200 dark:hover:file:bg-slate-600 cursor-pointer"
                data-testid="input-file"
              />
              {file && <p className="text-xs text-slate-400 truncate">{file.name} · {formatBytes(file.size)}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setUploadOpen(false)} data-testid="button-cancel-upload">
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || !title.trim() || !kind || uploadMutation.isPending}
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" />Upload</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// ── BookSpine ────────────────────────────────────────────────────────
type BookSpineProps = {
  doc: LibraryDoc;
  metaSurfaces: string[];
  onAddSurface: (surface: string) => void;
  onRemoveSurface: (surface: string) => void;
  onDelete: () => void;
  onReplace: () => void;
  onToggleVersions: () => void;
  versionsOpen: boolean;
};

function BookSpine({
  doc,
  metaSurfaces,
  onAddSurface,
  onRemoveSurface,
  onDelete,
  onReplace,
  onToggleVersions,
  versionsOpen,
}: BookSpineProps) {
  const palette = KIND_SPINE[doc.kind] ?? KIND_SPINE.other;
  const height = bookHeight(doc.id);
  const needsSig = doc.signatureRequirement !== "none";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={{ height }}
          className={`group relative w-9 sm:w-10 rounded-t-sm rounded-b-[2px] shadow-md hover:-translate-y-1 hover:shadow-lg transition-all border border-black/10 dark:border-white/10 ${palette.light} ${palette.dark} flex flex-col justify-between items-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500`}
          title={doc.title}
          data-testid={`book-${doc.id}`}
        >
          {/* Top bar */}
          <span className={`mt-1 h-1 w-5 rounded-full ${palette.accent} opacity-80`} />

          {/* Vertical title */}
          <span
            className="flex-1 flex items-center justify-center text-[10px] sm:text-[11px] font-semibold tracking-tight px-0.5 leading-tight overflow-hidden"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            <span className="truncate max-h-full">{doc.title}</span>
          </span>

          {/* Bottom indicator */}
          <span className="mb-1 flex flex-col items-center gap-0.5">
            {needsSig && <PenLine className="w-2.5 h-2.5 opacity-80" />}
            <span className="text-[8px] opacity-60">v{doc.version}</span>
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="start" data-testid={`book-popover-${doc.id}`}>
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 leading-tight" data-testid={`text-title-${doc.id}`}>
                {doc.title}
              </h3>
              <div className="flex items-center gap-1 flex-wrap mt-1">
                <Badge variant="outline" className="text-[10px]">v{doc.version}</Badge>
                <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[doc.kind] ?? doc.kind}</Badge>
                {needsSig && (
                  <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100 dark:border-amber-800">
                    {SIG_LABELS[doc.signatureRequirement]}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {doc.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{doc.description}</p>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {doc.filename} · {formatBytes(doc.sizeBytes)} · uploaded {formatDate(doc.createdAt)}
          </p>

          {/* Surfaces */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold mb-1.5">
              Surfaces
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {doc.surfaces.length === 0 && (
                <span className="text-xs text-slate-400 italic">unassigned</span>
              )}
              {doc.surfaces.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900"
                  data-testid={`assigned-surface-${doc.id}-${s}`}
                >
                  {SURFACE_LABELS[s] ?? s}
                  <button
                    onClick={() => onRemoveSurface(s)}
                    className="text-indigo-400 hover:text-indigo-700"
                    title="Remove assignment"
                    data-testid={`remove-surface-${doc.id}-${s}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <Select value="" onValueChange={(v) => v && onAddSurface(v)}>
                <SelectTrigger
                  className="h-6 px-2 w-auto text-[11px] border-dashed text-slate-500"
                  data-testid={`add-surface-${doc.id}`}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </SelectTrigger>
                <SelectContent>
                  {metaSurfaces
                    .filter((s) => !doc.surfaces.includes(s))
                    .map((s) => (
                      <SelectItem key={s} value={s}>{SURFACE_LABELS[s] ?? s}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
            <a
              href={doc.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 px-2 py-1 rounded hover-elevate"
              data-testid={`button-download-${doc.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open
            </a>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onToggleVersions}
              data-testid={`button-versions-${doc.id}`}
            >
              <History className="w-3.5 h-3.5 mr-1" /> Versions
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
              onClick={onReplace}
              data-testid={`button-replace-${doc.id}`}
            >
              <Upload className="w-3.5 h-3.5 mr-1" /> Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-red-500 hover:text-red-700 ml-auto"
              onClick={onDelete}
              data-testid={`button-delete-${doc.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          </div>

          {versionsOpen && <VersionList docId={doc.id} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VersionList({ docId }: { docId: number }) {
  const { data: versions = [], isLoading } = useDocumentVersions(docId);
  return (
    <div className="mt-1 border-t border-slate-100 dark:border-slate-800 pt-3" data-testid={`versions-${docId}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold mb-2">Version History</p>
      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : versions.length <= 1 ? (
        <p className="text-xs text-slate-400 italic">Only one version exists.</p>
      ) : (
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px]">v{v.version}</Badge>
              <span className="text-slate-600 dark:text-slate-300 flex-1 truncate">{v.filename}</span>
              <span className="text-slate-400">{formatDate(v.createdAt)}</span>
              <a href={v.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700">
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
