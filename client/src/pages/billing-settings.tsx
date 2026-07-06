// Billing Settings Center — Phase 4 PR 4.1.
//
// Admin/biller-gated page that shows the effective billing policy
// for a (facility, testType) scope + the underlying admin_settings
// rows so admins can edit values. Reads from canonical
// /api/billing-policy/* — no fake state.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchEffectiveBillingPolicy,
  fetchBillingPolicySettings,
  patchBillingPolicy,
  type EffectiveBillingPolicy,
  type BillingPolicyRow,
} from "@/lib/billingPolicyApi";

function sourceTone(src: string): "default" | "secondary" | "outline" {
  if (src === "test_type" || src === "facility") return "default";
  if (src === "user") return "secondary";
  return "outline";
}

export default function BillingSettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [facilityId, setFacilityId] = useState("");
  const [testType, setTestType] = useState("");

  const scopeArgs = { facilityId: facilityId.trim() || null, testType: testType.trim() || null };

  const { data: effective, isLoading: effLoading, isError: effError } = useQuery<EffectiveBillingPolicy>({
    queryKey: ["billing-policy-effective", scopeArgs],
    queryFn: () => fetchEffectiveBillingPolicy(scopeArgs),
  });

  const { data: rows = [] } = useQuery<BillingPolicyRow[]>({
    queryKey: ["billing-policy-settings", scopeArgs],
    queryFn: () => fetchBillingPolicySettings({
      facilityId: scopeArgs.facilityId ?? undefined,
      testType: scopeArgs.testType ?? undefined,
    }),
  });

  const patchMutation = useMutation({
    mutationFn: async (args: { id: number; settingValue: Record<string, unknown> }) =>
      patchBillingPolicy(args.id, { settingValue: args.settingValue }),
    onSuccess: () => {
      toast({ title: "Setting saved" });
      queryClient.invalidateQueries({ queryKey: ["billing-policy-effective"] });
      queryClient.invalidateQueries({ queryKey: ["billing-policy-settings"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    const out: Record<string, BillingPolicyRow[]> = {};
    for (const r of rows) {
      const group = r.settingKey.split("_")[0];
      if (!out[group]) out[group] = [];
      out[group].push(r);
    }
    return out;
  }, [rows]);

  if (effLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500" data-testid="billing-settings-loading">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading billing policy…
      </div>
    );
  }
  if (effError || !effective) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-rose-700" data-testid="billing-settings-error">
        <AlertCircle className="h-4 w-4 mr-2" /> Failed to load billing policy.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6" data-testid="billing-settings-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold text-slate-900">Billing Settings</h2>
          ) : (
            <h1 className="text-xl font-semibold text-slate-900">Billing Settings</h1>
          )}
          <p className="text-xs text-slate-500">
            Settings-driven invoice schedule, recipients, pricing,
            readiness rules, approval, and payment terms.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Facility</div>
            <Input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} placeholder="(global)" className="h-8 w-[160px] text-xs" data-testid="billing-settings-facility-input" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Test type</div>
            <Input value={testType} onChange={(e) => setTestType(e.target.value)} placeholder="(any)" className="h-8 w-[160px] text-xs" data-testid="billing-settings-testtype-input" />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["billing-policy-effective"] });
              queryClient.invalidateQueries({ queryKey: ["billing-policy-settings"] });
            }}
            data-testid="billing-settings-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-4 bg-white" data-testid="billing-settings-effective-bundle">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Effective policy</h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Resolved by precedence: test_type → facility → user → global → default.
          Badges show which override won.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <EffField label="Invoice frequency" value={effective.schedule.frequency} source={effective.sources["schedule_frequency"]} />
          <EffField label="Cutoff window" value={effective.schedule.cutoffWindow} source={effective.sources["schedule_cutoff_window"]} />
          <EffField label="Cutoff hour (local)" value={String(effective.schedule.cutoffHourLocal)} source={effective.sources["schedule_cutoff_hour_local"]} />
          <EffField label="Timezone" value={effective.schedule.timezone} source={effective.sources["schedule_timezone"]} />
          <EffField label="Primary email" value={effective.recipients.primaryEmail ?? "(unset)"} source={effective.sources["primary_email"]} />
          <EffField label="CC emails" value={effective.recipients.ccEmails.length ? effective.recipients.ccEmails.join(", ") : "(none)"} source={effective.sources["cc_emails"]} />
          <EffField label="Delivery method" value={effective.recipients.deliveryMethod} source={effective.sources["delivery_method"]} />
          <EffField label="Per-test price" value={effective.pricing.perTestPrice == null ? "(unset — blocks invoicing)" : `$${effective.pricing.perTestPrice}`} source={effective.sources["per_test_price"]} />
          <EffField label="Approval requirement" value={effective.approval.requirement} source={effective.sources["approval_requirement"]} />
          <EffField label="Payment term" value={effective.paymentTerms.term} source={effective.sources["payment_term"]} />
          <EffField label="Reminder interval (days)" value={String(effective.paymentTerms.reminderIntervalDays)} source={effective.sources["reminder_interval_days"]} />
          <EffField label="Hold missing report" value={String(effective.readiness.holdMissingReport)} source={effective.sources["hold_missing_report"]} />
          <EffField label="Hold pending physician signature" value={String(effective.readiness.holdPendingPhysicianSignature)} source={effective.sources["hold_pending_physician_signature"]} />
        </div>
      </Card>

      {Object.keys(grouped).sort().map((group) => (
        <Card key={group} className="p-4 bg-white" data-testid={`billing-settings-group-${group}`}>
          <h2 className="text-sm font-semibold text-slate-900 mb-2 capitalize">{group}</h2>
          <ul className="divide-y divide-slate-100">
            {grouped[group].map((row) => (
              <PolicyRow
                key={row.id}
                row={row}
                pending={patchMutation.isPending}
                onSave={(value) => patchMutation.mutate({ id: row.id, settingValue: value })}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function EffField({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50/40 p-2">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-sm font-medium text-slate-900" data-testid={`billing-effective-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</div>
      </div>
      {source ? (
        <Badge variant={sourceTone(source)} className="text-[10px] uppercase">{source}</Badge>
      ) : null}
    </div>
  );
}

function PolicyRow({
  row,
  pending,
  onSave,
}: {
  row: BillingPolicyRow;
  pending: boolean;
  onSave: (value: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(row.settingValue, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="py-3" data-testid={`billing-policy-row-${row.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900">{row.settingKey}</div>
          {row.description ? (
            <div className="text-[11px] text-slate-500">{row.description}</div>
          ) : null}
          <div className="text-[10px] text-slate-400 mt-1">
            {[
              row.facilityId ? `facility: ${row.facilityId}` : null,
              row.testType ? `test: ${row.testType}` : null,
            ].filter(Boolean).join(" · ") || "global default"}
          </div>
        </div>
        <div className="flex flex-col gap-1 w-[280px]">
          <Input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            className="font-mono text-[11px] h-7"
            data-testid={`billing-policy-row-value-${row.id}`}
          />
          {error ? <div className="text-[10px] text-rose-700">{error}</div> : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            try {
              const parsed = JSON.parse(draft);
              if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
                throw new Error("Setting value must be a JSON object");
              }
              setError(null);
              onSave(parsed as Record<string, unknown>);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Invalid JSON");
            }
          }}
          data-testid={`billing-policy-row-save-${row.id}`}
        >
          Save
        </Button>
      </div>
    </li>
  );
}
