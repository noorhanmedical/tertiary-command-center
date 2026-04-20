import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
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
} from "lucide-react";

type LibraryDoc = {
  id: number;
  title: string;
  description: string;
  kind: string;
  signatureRequirement: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  version: number;
  supersededByDocumentId: number | null;
  isCurrent: boolean;
  createdAt: string;
  surfaces: string[];
  downloadUrl: string;
  thumbnailUrl: string | null;
};

type LibraryMeta = {
  kinds: string[];
  signatureRequirements: string[];
  surfaces: string[];
};

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

export default function DocumentLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);

  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterSurface, setFilterSurface] = useState<string>("all");
  const [filterPatientId, setFilterPatientId] = useState<string>("");

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

  const { data: meta } = useQuery<LibraryMeta>({
    queryKey: ["/api/document-library/meta"],
  });

  const { data: docs = [], isLoading } = useQuery<LibraryDoc[]>({
    queryKey: ["/api/document-library", filterKind, filterSurface, filterPatientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterSurface !== "all") params.set("surface", filterSurface);
      else if (filterKind !== "all") params.set("kind", filterKind);
      const trimmedPid = filterPatientId.trim();
      if (trimmedPid && /^\d+$/.test(trimmedPid)) params.set("patientId", trimmedPid);
      const res = await fetch(`/api/document-library?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  // When filtering by surface, the server already pre-filters; we still
  // honor an additional client-side kind filter for combined selection.
  const visibleDocs = useMemo(() => {
    if (filterSurface !== "all" && filterKind !== "all") {
      return docs.filter((d) => d.kind === filterKind);
    }
    return docs;
  }, [docs, filterKind, filterSurface]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !title.trim() || !kind) throw new Error("title, kind, and file are required");
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("kind", kind);
      fd.append("signatureRequirement", sigReq);
      fd.append("surfaces", JSON.stringify(surfaces));
      const trimmedPid = uploadPatientId.trim();
      if (trimmedPid && /^\d+$/.test(trimmedPid)) fd.append("patientScreeningId", trimmedPid);
      const trimmedFac = uploadFacility.trim();
      if (trimmedFac) fd.append("facility", trimmedFac);
      fd.append("file", file);
      const res = await fetch("/api/document-library", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-library"] });
      toast({ title: "Document uploaded" });
      setTitle("");
      setDescription("");
      setKind("");
      setSigReq("none");
      setSurfaces([]);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/document-library/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-library"] });
      toast({ title: "Document deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const supersedeMutation = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/document-library/${id}/supersede`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Replace failed" }));
        throw new Error(err.error || "Replace failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-library"] });
      setReplaceTargetId(null);
      if (replaceFileRef.current) replaceFileRef.current.value = "";
      toast({ title: "New version uploaded" });
    },
    onError: (e: Error) => toast({ title: "Replace failed", description: e.message, variant: "destructive" }),
  });

  const addAssignmentMutation = useMutation({
    mutationFn: async ({ id, surface }: { id: number; surface: string }) => {
      const res = await fetch(`/api/document-library/${id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ surface }),
      });
      if (!res.ok) throw new Error("Failed to add assignment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-library"] });
    },
    onError: (e: Error) => toast({ title: "Assign failed", description: e.message, variant: "destructive" }),
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: async ({ id, surface }: { id: number; surface: string }) => {
      const res = await fetch(`/api/document-library/${id}/assignments/${surface}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove assignment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-library"] });
    },
    onError: (e: Error) => toast({ title: "Unassign failed", description: e.message, variant: "destructive" }),
  });

  function toggleSurface(s: string) {
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[hsl(210,35%,96%)]">
      <div className="max-w-6xl mx-auto px-5 py-8">
        <PageHeader
          eyebrow="PLEXUS · ADMIN"
          icon={Library}
          iconAccent="bg-indigo-100 text-indigo-700"
          title="Document Library"
          subtitle="Upload any file once. Tag it with a kind and signature requirement. Assign it to one or more surfaces (technician consent picker, scheduler resources, patient chart, etc.)."
          className="mb-6"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Upload form ───────────────────────────────────────── */}
          <Card className="lg:col-span-1 p-5 rounded-2xl border-slate-200 h-fit" data-testid="upload-card">
            <div className="flex items-center gap-2 mb-4">
              <Upload className="w-4 h-4 text-indigo-600" />
              <h2 className="font-semibold text-slate-800">Upload New Document</h2>
            </div>

            <div className="space-y-3">
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
                <Label>Signature Requirement</Label>
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
                            : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
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
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                  data-testid="input-file"
                />
                {file && <p className="text-xs text-slate-400 truncate">{file.name} · {formatBytes(file.size)}</p>}
              </div>

              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={!file || !title.trim() || !kind || uploadMutation.isPending}
                className="w-full mt-1"
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" />Upload to Library</>
                )}
              </Button>
            </div>
          </Card>

          {/* ── Library list ──────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 rounded-2xl border-slate-200 flex flex-wrap items-center gap-3" data-testid="filter-bar">
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filter</span>
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
              <span className="text-xs text-slate-400 ml-auto">{visibleDocs.length} document{visibleDocs.length !== 1 ? "s" : ""}</span>
            </Card>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            ) : visibleDocs.length === 0 ? (
              <Card className="p-10 text-center rounded-2xl border-dashed border-slate-200">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No documents in this view</p>
                <p className="text-sm text-slate-400 mt-1">Upload a file on the left to populate the library.</p>
              </Card>
            ) : (
              <div className="space-y-3" data-testid="document-list">
                {visibleDocs.map((doc) => (
                  <Card key={doc.id} className="p-4 rounded-2xl border-slate-200" data-testid={`doc-row-${doc.id}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-800 truncate">{doc.title}</h3>
                          <Badge variant="outline" className="text-[10px]">v{doc.version}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[doc.kind] ?? doc.kind}</Badge>
                          {doc.signatureRequirement !== "none" && (
                            <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
                              {SIG_LABELS[doc.signatureRequirement]}
                            </Badge>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-sm text-slate-500 mt-1">{doc.description}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          {doc.filename} · {formatBytes(doc.sizeBytes)} · uploaded {formatDate(doc.createdAt)}
                        </p>

                        {/* Surfaces */}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-1">Surfaces:</span>
                          {doc.surfaces.length === 0 && (
                            <span className="text-xs text-slate-400 italic">unassigned</span>
                          )}
                          {doc.surfaces.map((s) => (
                            <span
                              key={s}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100"
                              data-testid={`assigned-surface-${doc.id}-${s}`}
                            >
                              {SURFACE_LABELS[s] ?? s}
                              <button
                                onClick={() => removeAssignmentMutation.mutate({ id: doc.id, surface: s })}
                                className="text-indigo-400 hover:text-indigo-700"
                                title="Remove assignment"
                                data-testid={`remove-surface-${doc.id}-${s}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                          <Select
                            value=""
                            onValueChange={(v) => v && addAssignmentMutation.mutate({ id: doc.id, surface: v })}
                          >
                            <SelectTrigger className="h-6 px-2 w-auto text-[11px] border-dashed text-slate-500" data-testid={`add-surface-${doc.id}`}>
                              <Plus className="w-3 h-3 mr-1" /> Add
                            </SelectTrigger>
                            <SelectContent>
                              {(meta?.surfaces ?? [])
                                .filter((s) => !doc.surfaces.includes(s))
                                .map((s) => (
                                  <SelectItem key={s} value={s}>{SURFACE_LABELS[s] ?? s}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {versionsOpenFor === doc.id && (
                          <VersionList docId={doc.id} />
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <a
                          href={doc.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                          data-testid={`button-download-${doc.id}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setVersionsOpenFor(versionsOpenFor === doc.id ? null : doc.id)}
                          data-testid={`button-versions-${doc.id}`}
                        >
                          <History className="w-3.5 h-3.5 mr-1" /> Versions
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            setReplaceTargetId(doc.id);
                            replaceFileRef.current?.click();
                          }}
                          data-testid={`button-replace-${doc.id}`}
                        >
                          <Upload className="w-3.5 h-3.5 mr-1" /> Replace
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm(`Delete "${doc.title}"? This removes the file and its assignments.`)) {
                              deleteMutation.mutate(doc.id);
                            }
                          }}
                          data-testid={`button-delete-${doc.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hidden file input for "Replace" flow */}
        <input
          ref={replaceFileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && replaceTargetId !== null) {
              supersedeMutation.mutate({ id: replaceTargetId, file: f });
            }
          }}
        />
      </div>
    </main>
  );
}

function VersionList({ docId }: { docId: number }) {
  const { data: versions = [], isLoading } = useQuery<LibraryDoc[]>({
    queryKey: ["/api/document-library", docId, "versions"],
    queryFn: async () => {
      const res = await fetch(`/api/document-library/${docId}/versions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load versions");
      return res.json();
    },
  });
  return (
    <div className="mt-3 border-t border-slate-100 pt-3" data-testid={`versions-${docId}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Version History</p>
      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : versions.length <= 1 ? (
        <p className="text-xs text-slate-400 italic">Only one version exists.</p>
      ) : (
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px]">v{v.version}</Badge>
              <span className="text-slate-600 flex-1 truncate">{v.filename}</span>
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
