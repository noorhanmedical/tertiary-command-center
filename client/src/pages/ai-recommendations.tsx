// /admin/ai-recommendations — Phase 3 PR 3.4.
//
// Read-only inventory of every AI / rules recommendation the engine has
// proposed. Humans accept or reject; no auto-execution.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  fetchAiRecommendations, fetchAiSafetyPolicy,
  acceptAiRecommendation, rejectAiRecommendation,
  PROVIDER_TONE, CONFIDENCE_TONE,
  type AiRecommendation, type RecommendationStatus,
} from "@/lib/aiRecommendationsApi";

const STATUS_TABS: RecommendationStatus[] = ["proposed", "accepted", "rejected", "superseded"];

export default function AiRecommendationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<RecommendationStatus>("proposed");
  const [reasonById, setReasonById] = useState<Record<number, string>>({});

  const { data: policy } = useQuery({
    queryKey: ["ai-safety-policy"], queryFn: fetchAiSafetyPolicy,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ai-recommendations", status],
    queryFn: () => fetchAiRecommendations({ status }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["exceptions"] });
  };
  const acceptMut = useMutation({
    mutationFn: (id: number) => acceptAiRecommendation(id),
    onSuccess: () => { toast({ title: "Accepted" }); refresh(); },
    onError: (e: Error) => toast({ title: "Accept failed", description: e.message, variant: "destructive" }),
  });
  const rejectMut = useMutation({
    mutationFn: (vars: { id: number; reason: string }) => rejectAiRecommendation(vars.id, vars.reason),
    onSuccess: (_d, vars) => { toast({ title: "Rejected" }); setReasonById((m) => ({ ...m, [vars.id]: "" })); refresh(); },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => rows ?? [], [rows]);

  return (
    <div className="container mx-auto p-4 space-y-4" data-testid="ai-recommendations-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Recommendations</h1>
      </div>

      {policy && (
        <Card className="p-3 bg-white" data-testid="ai-safety-policy-card">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={PROVIDER_TONE[policy.effectiveModelProvider]} data-testid="policy-effective-provider">
              effective: {policy.effectiveModelProvider}
            </Badge>
            <span>allowed: {policy.allowedModelProviders.join(", ") || "—"}</span>
            <span>confidence: {policy.confidenceReportingMode}</span>
            <Badge variant="outline" data-testid="policy-human-review-required">human review required</Badge>
            <Badge variant="outline" data-testid="policy-auto-actions-disabled">auto actions disabled</Badge>
          </div>
        </Card>
      )}

      <Tabs value={status} onValueChange={(v) => setStatus(v as RecommendationStatus)}>
        <TabsList>
          {STATUS_TABS.map((s) => (
            <TabsTrigger key={s} value={s} data-testid={`ai-rec-tab-${s}`}>{s}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Card className="p-3 bg-white"><div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Card>
      ) : grouped.length === 0 ? (
        <Card className="p-3 bg-white text-xs text-slate-500" data-testid="ai-recommendations-empty">No recommendations in this status.</Card>
      ) : (
        <div className="space-y-3">
          {grouped.map((r: AiRecommendation) => (
            <Card key={r.id} className="p-4 bg-white" data-testid={`ai-recommendation-${r.id}`}>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={`text-[10px] ${PROVIDER_TONE[r.modelProvider]}`}>{r.modelProvider}</Badge>
                <Badge variant="outline" className={`text-[10px] ${CONFIDENCE_TONE[r.confidenceLabel]}`}>{r.confidenceLabel}</Badge>
                <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                <span className="text-xs text-slate-500">{r.recommendedAction}</span>
                {r.exceptionSnapshotId ? <span className="text-xs text-slate-500">exception #{r.exceptionSnapshotId}</span> : null}
              </div>
              <div className="text-sm font-semibold text-slate-900">{r.title}</div>
              <div className="text-[12px] text-slate-700 mb-2">{r.body}</div>
              <div className="text-[11px] text-slate-600 mb-2"><span className="text-slate-500">rationale: </span>{r.rationale}</div>
              {r.ruleIds.length > 0 ? (
                <div className="text-[10px] text-slate-500 mb-2">rules: {r.ruleIds.join(", ")}</div>
              ) : null}
              {r.status === "proposed" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => acceptMut.mutate(r.id)} disabled={acceptMut.isPending} data-testid={`ai-rec-accept-${r.id}`}>Accept</Button>
                  <Input
                    value={reasonById[r.id] ?? ""}
                    onChange={(e) => setReasonById((m) => ({ ...m, [r.id]: e.target.value }))}
                    placeholder="rejection reason"
                    className="h-8 flex-1 min-w-[200px] text-xs"
                    data-testid={`ai-rec-reject-reason-${r.id}`}
                  />
                  <Button size="sm" variant="ghost"
                    disabled={!(reasonById[r.id] ?? "").trim() || rejectMut.isPending}
                    onClick={() => rejectMut.mutate({ id: r.id, reason: reasonById[r.id] ?? "" })}
                    data-testid={`ai-rec-reject-${r.id}`}>Reject</Button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">
                  {r.status === "accepted" && r.acceptedAt ? `accepted ${new Date(r.acceptedAt).toLocaleString()}` : null}
                  {r.status === "rejected" && r.rejectedAt ? `rejected ${new Date(r.rejectedAt).toLocaleString()} — ${r.rejectionReason}` : null}
                  {r.status === "superseded" && r.supersededAt ? `superseded ${new Date(r.supersededAt).toLocaleString()}` : null}
                </div>
              )}
              <details className="mt-2 text-[11px]">
                <summary className="cursor-pointer text-slate-500">policy snapshot</summary>
                <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(r.policySnapshot, null, 2)}</pre>
              </details>
              <details className="mt-1 text-[11px]">
                <summary className="cursor-pointer text-slate-500">inputs</summary>
                <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(r.inputs, null, 2)}</pre>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
