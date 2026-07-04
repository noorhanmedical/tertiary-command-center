import React, { useMemo, useState } from "react";
import { Megaphone, FileText, Send, Loader2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import { PopupPatientPicker, type PickedPatient } from "../components/PopupPatientPicker";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type MarketingMaterialItem = {
  id: number;
  title: string;
  description: string;
  filename: string;
  contentType: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
};

export function MarketingDockPopup() {
  const { profile } = useCommandCenter();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { data: materials = [], isLoading, isError } = useQuery<MarketingMaterialItem[]>({
    queryKey: ["/api/marketing-materials"],
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) => m.title.toLowerCase().includes(q) || (m.description ?? "").toLowerCase().includes(q),
    );
  }, [materials, search]);

  const sendMutation = useMutation({
    mutationFn: async (material: MarketingMaterialItem) => {
      if (!picked) throw new Error("Select a patient first");
      const res = await apiRequest("POST", "/api/outreach/send-material", {
        patientScreeningId: picked.patientScreeningId,
        materialId: String(material.id),
      });
      return res.json();
    },
    onSuccess: (_data, material) => {
      toast({ title: "Material sent", description: `${material.title} → ${picked?.name ?? "patient"}` });
    },
    onError: (err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      const cleaned = raw.replace(/^\d+:\s*/, "");
      let description = cleaned;
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed?.error) description = String(parsed.error);
      } catch {
        /* not JSON */
      }
      toast({ title: "Send failed", description, variant: "destructive" });
    },
    onSettled: () => setPendingId(null),
  });

  const context = {
    sourceSurface: profile.surface,
    componentType: "marketing" as const,
    patientName: picked?.name,
    title: "Marketing Library",
  };

  return (
    <PanelPopupCard title="Marketing" eyebrow="Library" icon={<Megaphone className="h-5 w-5" />} context={context}>
      <div className="space-y-3" data-testid="command-left-rail-marketing-panel">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder="Search materials"
          data-testid="marketing-search"
        />

        <PopupPatientPicker
          picked={picked}
          onPick={setPicked}
          onClear={() => setPicked(null)}
          placeholder="Search patient to send to…"
        />

        <div className="max-h-[40vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="px-1 py-3 text-xs text-slate-400">Loading materials…</div>
          ) : isError ? (
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">Could not load materials.</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              {materials.length === 0 ? "No materials in the library yet." : "No materials match your search."}
            </div>
          ) : (
            filtered.map((m) => (
              <div
                key={m.id}
                className="rounded-2xl border border-slate-200 bg-white p-3"
                data-testid={`marketing-item-${m.id}`}
              >
                <div className="flex items-start gap-2">
                  {m.thumbnailUrl ? (
                    <img
                      src={m.thumbnailUrl}
                      alt={m.title}
                      className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-500">
                      <FileText className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{m.title}</div>
                    {m.description ? (
                      <div className="line-clamp-2 text-xs text-slate-500">{m.description}</div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <a
                    href={m.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 hover:bg-slate-50"
                    data-testid={`marketing-open-${m.id}`}
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    disabled={!picked || pendingId === m.id}
                    onClick={() => {
                      setPendingId(m.id);
                      sendMutation.mutate(m);
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-blue-700 px-2.5 text-[11px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
                    data-testid={`marketing-send-${m.id}`}
                  >
                    {pendingId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    {picked ? "Send" : "Pick patient"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </PanelPopupCard>
  );
}
