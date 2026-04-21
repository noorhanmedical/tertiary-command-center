import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Maximize2, Megaphone, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AuthUser } from "@/App";
import type { OutreachCallItem } from "./types";

type MarketingMaterialItem = {
  id: number;
  title: string;
  description: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
};

function iconForMaterial(contentType: string) {
  if (contentType === "application/pdf") return FileText;
  if (contentType.startsWith("image/")) return Megaphone;
  return FileText;
}

export function MaterialsPanel({
  selectedItem, onExpand, fullWidth = false,
}: {
  selectedItem: OutreachCallItem | null;
  onExpand?: () => void;
  fullWidth?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data: currentUser } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"], staleTime: 5 * 60 * 1000 });
  const isAdmin = currentUser?.role === "admin";

  const { data: materials = [], isLoading } = useQuery<MarketingMaterialItem[]>({
    queryKey: ["/api/marketing-materials"],
    staleTime: 60_000,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!uploadTitle.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!uploadFile) {
      toast({ title: "File required", description: "Pick a PDF or image to upload.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("title", uploadTitle.trim());
      fd.append("description", uploadDesc.trim());
      fd.append("file", uploadFile);
      const res = await fetch("/api/marketing-materials", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Upload failed (${res.status})`);
      }
      toast({ title: "Material added", description: uploadTitle.trim() });
      setUploadTitle("");
      setUploadDesc("");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["/api/marketing-materials"] });
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(m: MarketingMaterialItem) {
    if (!confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    try {
      const res = await apiRequest("DELETE", `/api/marketing-materials/${m.id}`);
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`);
      toast({ title: "Material deleted" });
      await qc.invalidateQueries({ queryKey: ["/api/marketing-materials"] });
    } catch (e: unknown) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const sendMaterialMutation = useMutation({
    mutationFn: async ({ materialId }: { materialId: string; title: string }) => {
      if (!selectedItem) throw new Error("No patient selected");
      const res = await apiRequest("POST", "/api/outreach/send-material", {
        patientScreeningId: selectedItem.patientId,
        materialId,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: "Material sent", description: `${vars.title} sent to ${selectedItem?.patientName ?? "patient"}.` });
    },
    onError: (err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      const cleaned = raw.replace(/^\d+:\s*/, "");
      let description = cleaned;
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed?.error) description = String(parsed.error);
      } catch { /* not JSON */ }
      toast({ title: "Material failed", description, variant: "destructive" });
    },
    onSettled: () => setPendingId(null),
  });

  function handleSend(materialId: string, title: string) {
    if (!selectedItem) {
      toast({ title: "No patient selected", description: "Pick a patient from the call list first.", variant: "destructive" });
      return;
    }
    setPendingId(materialId);
    sendMaterialMutation.mutate({ materialId, title });
  }

  const cols = fullWidth ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1";
  const items = fullWidth ? materials : materials.slice(0, 3);

  return (
    <div className="space-y-2" data-testid="materials-panel">
      {!fullWidth && onExpand && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onExpand}
            title="Expand materials"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50"
            data-testid="hub-expand-materials"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-[11px] text-slate-400 px-1 py-2" data-testid="materials-loading">
          Loading materials…
        </div>
      )}

      {!isLoading && materials.length === 0 && (
        <div
          className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-[11px] text-slate-500"
          data-testid="materials-empty"
        >
          No materials yet.{isAdmin ? " Upload one below to get started." : " Ask an admin to upload your team's brochures."}
        </div>
      )}

      <div className={`grid gap-2 ${cols}`}>
        {items.map((m) => {
          const Icon = iconForMaterial(m.contentType);
          return (
            <div
              key={m.id}
              className="rounded-xl border border-slate-200 bg-white p-2.5 hover:border-amber-300 hover:bg-amber-50/40 transition"
              data-testid={`material-card-${m.id}`}
            >
              <div className="flex items-start gap-2">
                {m.thumbnailUrl ? (
                  <img
                    src={m.thumbnailUrl}
                    alt={m.title}
                    className="h-12 w-12 rounded-lg border border-amber-100 object-cover shrink-0 bg-white"
                    data-testid={`material-thumbnail-${m.id}`}
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-amber-100 bg-amber-50 text-amber-600 shrink-0"
                    data-testid={`material-thumbnail-${m.id}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate" data-testid={`material-title-${m.id}`}>{m.title}</p>
                  {m.description && (
                    <p className="text-[10px] text-slate-500 line-clamp-2">{m.description}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">{m.filename}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                <a
                  href={m.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center h-7 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 hover:bg-slate-50"
                  data-testid={`material-download-${m.id}`}
                >
                  <FileText className="h-3 w-3 mr-1" /> Open
                </a>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(m)}
                    title="Delete material"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-rose-500 hover:border-rose-300 hover:bg-rose-50"
                    data-testid={`material-delete-${m.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSend(String(m.id), m.title)}
                  disabled={pendingId === String(m.id)}
                  className="h-7 rounded-full text-[11px]"
                  data-testid={`material-send-${m.id}`}
                >
                  <Send className="h-3 w-3 mr-1" /> {pendingId === String(m.id) ? "Sending..." : "Send to patient"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {!fullWidth && onExpand && materials.length > 0 && (
        <button
          type="button"
          onClick={onExpand}
          className="w-full text-center text-[11px] text-slate-500 hover:text-slate-700 underline"
          data-testid="hub-materials-see-all"
        >
          See all {materials.length} materials
        </button>
      )}

      {fullWidth && isAdmin && (
        <div
          className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 space-y-2"
          data-testid="materials-upload-form"
        >
          <div className="flex items-center gap-2 mb-1">
            <Megaphone className="h-3.5 w-3.5 text-amber-600" />
            <p className="text-xs font-semibold text-slate-800">Upload a new material</p>
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Title</Label>
            <Input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g. BrainWave Brochure"
              className="mt-1 h-8 text-sm rounded-xl"
              data-testid="material-upload-title"
            />
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Description</Label>
            <Textarea
              value={uploadDesc}
              onChange={(e) => setUploadDesc(e.target.value)}
              rows={2}
              placeholder="Optional patient-facing summary."
              className="mt-1 text-sm rounded-xl"
              data-testid="material-upload-description"
            />
          </div>
          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">File (PDF or image, max 25MB)</Label>
            <Input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="mt-1 h-9 text-sm rounded-xl"
              data-testid="material-upload-file"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={uploading}
              className="h-8 rounded-full"
              data-testid="material-upload-submit"
            >
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</>
              ) : (
                <><Send className="h-3.5 w-3.5 mr-1" /> Add to library</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
