// Exception Settings Center — Phase 3 PR 3.1.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchEffectiveExceptionPolicy,
  fetchExceptionSettings,
  patchExceptionSetting,
  type EffectiveExceptionPolicy,
  type DetectorDefinition,
  type ExceptionSettingsRow,
} from "@/lib/exceptionSettingsApi";

function sourceTone(src: string): "default" | "secondary" | "outline" {
  if (src === "test_type" || src === "facility") return "default";
  if (src === "user") return "secondary";
  return "outline";
}

export default function ExceptionSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState("");
  const [testType, setTestType] = useState("");
  const scopeArgs = { facilityId: facilityId.trim() || null, testType: testType.trim() || null };

  const { data, isLoading, isError } = useQuery<{ policy: EffectiveExceptionPolicy; registry: DetectorDefinition[] }>({
    queryKey: ["exception-policy", scopeArgs],
    queryFn: () => fetchEffectiveExceptionPolicy(scopeArgs),
  });

  const { data: rows = [] } = useQuery<ExceptionSettingsRow[]>({
    queryKey: ["exception-settings", scopeArgs],
    queryFn: () => fetchExceptionSettings({ facilityId: scopeArgs.facilityId ?? undefined, testType: scopeArgs.testType ?? undefined }),
  });

  const patchMut = useMutation({
    mutationFn: async (args: { id: number; settingValue: Record<string, unknown> }) => patchExceptionSetting(args.id, { settingValue: args.settingValue }),
    onSuccess: () => {
      toast({ title: "Setting saved" });
      queryClient.invalidateQueries({ queryKey: ["exception-policy"] });
      queryClient.invalidateQueries({ queryKey: ["exception-settings"] });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const groupedDetectors = useMemo(() => {
    const out: Record<string, DetectorDefinition[]> = {};
    for (const d of data?.registry ?? []) {
      (out[d.category] ||= []).push(d);
    }
    return out;
  }, [data?.registry]);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading exception policy…</div>;
  }
  if (isError || !data) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-rose-700"><AlertCircle className="h-4 w-4 mr-2" /> Failed to load exception policy.</div>;
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6" data-testid="exception-settings-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Exception Settings</h1>
          <p className="text-xs text-slate-500">
            Detector thresholds, severity, and owner roles.
            Phase 3 contract: <strong>human_review_required = true</strong>,
            <strong> auto_actions_enabled = false</strong>.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} placeholder="(global)" className="h-8 w-[160px] text-xs" data-testid="exception-facility-input" />
          <Input value={testType} onChange={(e) => setTestType(e.target.value)} placeholder="(any test)" className="h-8 w-[160px] text-xs" data-testid="exception-testtype-input" />
          <Button variant="outline" size="sm" onClick={() => { queryClient.invalidateQueries({ queryKey: ["exception-policy"] }); queryClient.invalidateQueries({ queryKey: ["exception-settings"] }); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-4 bg-white" data-testid="exception-effective-bundle">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Effective policy</h2>
        <p className="text-[11px] text-slate-500 mb-3">Resolved by precedence test_type → facility → user → global → default.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge variant={data.policy.humanReviewRequired ? "default" : "outline"} className="text-[10px]" data-testid="effective-human-review-required">human_review_required: {String(data.policy.humanReviewRequired)}</Badge>
          <Badge variant={data.policy.autoActionsEnabled ? "default" : "outline"} className="text-[10px]" data-testid="effective-auto-actions-enabled">auto_actions_enabled: {String(data.policy.autoActionsEnabled)}</Badge>
        </div>
        {Object.entries(groupedDetectors).sort().map(([category, list]) => (
          <div key={category} className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{category}</div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {list.map((d) => {
                const eff = data.policy.detectors[d.exceptionType];
                return (
                  <li key={d.exceptionType} className="text-[11px] flex items-center justify-between rounded border border-slate-100 bg-slate-50/40 p-2" data-testid={`exception-detector-${d.exceptionType}`}>
                    <div>
                      <div className="font-medium text-slate-900">{d.title}</div>
                      <div className="text-slate-500">{eff?.thresholdValue} {eff?.thresholdUnit} · {eff?.severity} · → {eff?.ownerRole}</div>
                    </div>
                    {eff?.source ? <Badge variant={sourceTone(eff.source)} className="text-[10px] uppercase">{eff.source}</Badge> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>

      <Card className="p-4 bg-white">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Settings rows</h2>
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <SettingRow key={row.id} row={row} pending={patchMut.isPending} onSave={(value) => patchMut.mutate({ id: row.id, settingValue: value })} />
          ))}
          {rows.length === 0 ? <li className="text-xs text-slate-500 italic py-3">No rows scoped to this filter. Phase 3 seeds globals by default.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

function SettingRow({ row, pending, onSave }: { row: ExceptionSettingsRow; pending: boolean; onSave: (value: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(row.settingValue, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="py-3" data-testid={`exception-row-${row.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900">{row.settingKey}</div>
          {row.description ? <div className="text-[11px] text-slate-500">{row.description}</div> : null}
          <div className="text-[10px] text-slate-400 mt-1">{[row.facilityId ? `facility: ${row.facilityId}` : null, row.testType ? `test: ${row.testType}` : null].filter(Boolean).join(" · ") || "global default"}</div>
        </div>
        <div className="flex flex-col gap-1 w-[280px]">
          <Input value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} className="font-mono text-[11px] h-7" data-testid={`exception-row-value-${row.id}`} />
          {error ? <div className="text-[10px] text-rose-700">{error}</div> : null}
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => {
          try {
            const parsed = JSON.parse(draft);
            if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error("Setting value must be a JSON object");
            setError(null);
            onSave(parsed as Record<string, unknown>);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid JSON");
          }
        }} data-testid={`exception-row-save-${row.id}`}>Save</Button>
      </div>
    </li>
  );
}
