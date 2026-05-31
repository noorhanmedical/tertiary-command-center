import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, FileText, Megaphone } from "lucide-react";
import {
  fetchMarketingMaterials,
  sendMarketingMaterial,
} from "@/lib/portal/commandCenterApi";
import { useToast } from "@/hooks/use-toast";

// Marketing tab — reads marketing materials from the Document Library
// (/api/outreach/materials) and sends them to a selected patient via
// the canonical /api/email/send-material route.
//
// If no SMS backend exists, the text option is intentionally disabled
// with a clear message rather than faking a send.

type MarketingMaterial = {
  id: string | number;
  title: string;
  description: string | null;
  filename: string;
};

export function PortalMarketingTab({
  selectedPatient,
}: {
  selectedPatient: {
    patientScreeningId: number;
    name: string;
    email?: string | null;
  } | null;
}) {
  const { toast } = useToast();
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | number | null>(null);
  const [overrideEmail, setOverrideEmail] = useState("");

  const { data: materials = [], isLoading, isError, error } = useQuery<MarketingMaterial[]>({
    queryKey: ["portal-marketing-materials"],
    queryFn: () => fetchMarketingMaterials(),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPatient || !selectedMaterialId) {
        throw new Error("Pick a patient + material first");
      }
      const to = overrideEmail.trim() || selectedPatient.email || undefined;
      if (!to) throw new Error("No email address on file for this patient");
      return sendMarketingMaterial({
        patientScreeningId: selectedPatient.patientScreeningId,
        materialId: selectedMaterialId,
        to,
      });
    },
    onSuccess: () => {
      toast({
        title: "Marketing email sent",
        description: `${selectedPatient?.name ?? "Patient"}`,
      });
      setSelectedMaterialId(null);
      setOverrideEmail("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Could not send marketing",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-4" data-testid="portal-marketing">
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Megaphone className="h-4 w-4 text-slate-500" />
          Marketing materials
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Materials are pulled from the Document Library (kind: marketing).
          Send via email through the canonical send route. Text/SMS send is
          not wired yet — disabled rather than faked.
        </div>
      </Card>

      <div className="grid flex-1 min-h-0 gap-3 lg:grid-cols-[1fr_280px] overflow-hidden">
        <Card className="p-3 bg-white overflow-y-auto" data-testid="portal-marketing-list">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading materials…
            </div>
          ) : isError ? (
            <div className="text-xs text-rose-700 py-2">
              {error instanceof Error ? error.message : "Failed to load materials"}
            </div>
          ) : materials.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-2">
              No marketing materials uploaded yet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {materials.map((m) => {
                const isSelected = selectedMaterialId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedMaterialId(m.id)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-slate-100 bg-slate-50/40 hover:bg-slate-50"
                      }`}
                      data-testid={`portal-marketing-row-${m.id}`}
                    >
                      <FileText className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-900 truncate">{m.title}</div>
                        {m.description ? (
                          <div className="text-[10px] text-slate-600 line-clamp-2">{m.description}</div>
                        ) : null}
                        <div className="text-[10px] text-slate-400 truncate">{m.filename}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-3 bg-white" data-testid="portal-marketing-send">
          <div className="text-xs font-semibold text-slate-900">Send to</div>
          {selectedPatient ? (
            <div className="mt-1 text-[11px] text-slate-700">
              <div className="font-medium">{selectedPatient.name}</div>
              <div className="text-[10px] text-slate-500">
                Patient #{selectedPatient.patientScreeningId}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-500 italic">
              Open a patient first to send marketing.
            </div>
          )}

          <div className="mt-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Email override
            </label>
            <Input
              value={overrideEmail}
              onChange={(e) => setOverrideEmail(e.target.value)}
              placeholder={selectedPatient?.email ?? "patient@example.com"}
              className="mt-1 h-8 text-xs"
              data-testid="input-portal-marketing-email"
            />
          </div>

          <Button
            type="button"
            size="sm"
            disabled={
              !selectedPatient ||
              !selectedMaterialId ||
              sendMutation.isPending
            }
            onClick={() => sendMutation.mutate()}
            className="mt-3 w-full gap-1.5"
            data-testid="button-portal-marketing-send"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            Send marketing
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            className="mt-1.5 w-full gap-1.5"
            title="Text/SMS send is not wired yet"
          >
            Text/SMS · not wired yet
          </Button>
        </Card>
      </div>
    </div>
  );
}
