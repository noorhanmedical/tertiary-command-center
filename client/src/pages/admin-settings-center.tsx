// Admin Settings Center — PR 2.1
//
// Real, visible, editable, persisted admin settings page. Renders
// the effective bundle (so admins can see the resolved value + the
// source) AND the underlying admin_settings rows (so admins can
// edit value, description, active flag).
//
// Read-only when the seed setting has no row; the "Restore default"
// button just creates a global-scope row with the same default value.
// Deactivation toggles the active flag (history is preserved).

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAdminSettings,
  fetchEffectiveAdminSettings,
  patchAdminSettingRow,
  type AdminSettingRow,
  type EffectiveAdminSettingsBundle,
} from "@/lib/adminSettingsApi";

function sourceTone(src: string): "default" | "secondary" | "outline" {
  if (src === "facility") return "default";
  if (src === "user") return "secondary";
  return "outline";
}

export default function AdminSettingsCenterPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: effective, isLoading: effectiveLoading, isError: effectiveError } = useQuery<EffectiveAdminSettingsBundle>({
    queryKey: ["admin-settings-effective"],
    queryFn: () => fetchEffectiveAdminSettings(),
  });

  const { data: rows = [], isLoading: rowsLoading } = useQuery<AdminSettingRow[]>({
    queryKey: ["admin-settings-list"],
    queryFn: () => fetchAdminSettings({ active: true }),
  });

  const grouped = useMemo(() => {
    const out: Record<string, AdminSettingRow[]> = {};
    for (const r of rows) {
      if (!out[r.settingDomain]) out[r.settingDomain] = [];
      out[r.settingDomain].push(r);
    }
    return out;
  }, [rows]);

  const patchMutation = useMutation({
    mutationFn: async (args: { id: number; settingValue: Record<string, unknown> }) =>
      patchAdminSettingRow(args.id, { settingValue: args.settingValue }),
    onSuccess: () => {
      toast({ title: "Setting updated" });
      queryClient.invalidateQueries({ queryKey: ["admin-settings-effective"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings-list"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not update", description: err.message, variant: "destructive" }),
  });

  if (effectiveLoading || rowsLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500" data-testid="admin-settings-loading">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading admin settings…
      </div>
    );
  }
  if (effectiveError || !effective) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-rose-700" data-testid="admin-settings-error">
        <AlertCircle className="h-4 w-4 mr-2" /> Failed to load admin settings.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-6" data-testid="admin-settings-center">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Admin Settings Center</h1>
          <p className="text-xs text-slate-500">
            Effective runtime values + per-row overrides. All call-result, scheduling,
            and assignment routing reads from these rows at runtime.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-settings-effective"] });
            queryClient.invalidateQueries({ queryKey: ["admin-settings-list"] });
          }}
          data-testid="admin-settings-refresh"
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </header>

      <Card className="p-4 bg-white" data-testid="admin-settings-effective-bundle">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Effective runtime values</h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Global scope (no facility / user override applied). Switch the
          Replit env or future scope picker to inspect facility / user
          overrides.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Callback default hours" value={String(effective.callResult.callbackDueHours)} source={effective.sources["scheduling_triage.default_callback_due_hours"]} />
          <Field label="No-answer re-queue hours" value={String(effective.callResult.noAnswerCallbackHours)} source={effective.sources["engagement_center.no_answer_callback_hours"]} />
          <Field label="LVM re-queue hours" value={String(effective.callResult.voicemailCallbackHours)} source={effective.sources["engagement_center.voicemail_callback_hours"]} />
          <Field label="Max call attempts" value={String(effective.callResult.maxCallAttempts)} source={effective.sources["engagement_center.max_call_attempts"]} />
          <Field label="Manager review creates a task" value={effective.callResult.managerReviewRequiresTask ? "Yes" : "No"} source={effective.sources["scheduling_triage.manager_review_requires_task"]} />
          <Field label="Preserve scheduler ownership" value={effective.callResult.preserveSchedulerOwnership ? "Yes" : "No"} source={effective.sources["engagement_center.preserve_scheduler_ownership"]} />
          <Field label="DNC is terminal" value={effective.callResult.dncIsTerminal ? "Yes" : "No"} source={effective.sources["engagement_center.dnc_is_terminal"]} />
          <Field label="Declined is terminal" value={effective.callResult.declinedIsTerminal ? "Yes" : "No"} source={effective.sources["engagement_center.declined_is_terminal"]} />
          <Field label="Ready-to-schedule → triage" value={effective.callResult.readyToScheduleRoutesToTriage ? "Yes" : "No"} source={effective.sources["engagement_center.ready_to_schedule_routes_to_triage"]} />
          <Field label="Scheduled closes assignment" value={effective.callResult.scheduledClosesAssignment ? "Yes" : "No"} source={effective.sources["engagement_center.scheduled_closes_assignment"]} />
          <Field label="Queue re-entry enabled" value={effective.callResult.queueReentryEnabled ? "Yes" : "No"} source={effective.sources["engagement_center.queue_reentry_enabled"]} />
          <Field label="Global schedule = source of truth" value={effective.scheduling.globalScheduleIsSourceOfTruth ? "Yes" : "No"} source={effective.sources["global_schedule.source_of_truth"]} />
          <Field label="PTO blocks assignment" value={effective.scheduling.ptoBlocksAssignment ? "Yes" : "No"} source={effective.sources["global_schedule.pto_blocks_assignment"]} />
          <Field label="Same-day add (if capacity)" value={effective.scheduling.sameDayAddAllowedIfCapacity ? "Yes" : "No"} source={effective.sources["global_schedule.same_day_add_allowed_if_capacity"]} />
          <Field label="Auto-assign enabled" value={effective.assignment.schedulerAutoAssignEnabled ? "Yes" : "No"} source={effective.sources["assignment.scheduler_auto_assign_enabled"]} />
          <Field label="PCS respects facility scope" value={effective.assignment.pcsAssignmentRespectsFacilityScope ? "Yes" : "No"} source={effective.sources["assignment.pcs_assignment_respects_facility_scope"]} />
          <Field label="ACS respects facility scope" value={effective.assignment.acsAssignmentRespectsFacilityScope ? "Yes" : "No"} source={effective.sources["assignment.acs_assignment_respects_facility_scope"]} />
        </div>
      </Card>

      {Object.keys(grouped).sort().map((domain) => (
        <Card key={domain} className="p-4 bg-white" data-testid={`admin-settings-domain-${domain}`}>
          <h2 className="text-sm font-semibold text-slate-900 mb-2 capitalize">{domain.replace(/_/g, " ")}</h2>
          <ul className="divide-y divide-slate-100">
            {grouped[domain].map((row) => (
              <SettingRow
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

function Field({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source?: "facility" | "user" | "global" | "default";
}) {
  return (
    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50/40 p-2">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-sm font-medium text-slate-900" data-testid={`effective-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
          {value}
        </div>
      </div>
      {source ? (
        <Badge variant={sourceTone(source)} className="text-[10px] uppercase">
          {source}
        </Badge>
      ) : null}
    </div>
  );
}

function SettingRow({
  row,
  pending,
  onSave,
}: {
  row: AdminSettingRow;
  pending: boolean;
  onSave: (value: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(row.settingValue, null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="py-3" data-testid={`admin-settings-row-${row.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900">{row.settingKey}</div>
          {row.description ? (
            <div className="text-[11px] text-slate-500">{row.description}</div>
          ) : null}
          <div className="text-[10px] text-slate-400 mt-1">
            {row.facilityId
              ? `facility: ${row.facilityId}`
              : row.userId
                ? `user: ${row.userId}`
                : "global default"}
          </div>
        </div>
        <div className="flex flex-col gap-1 w-[260px]">
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            className="font-mono text-[11px] h-7"
            data-testid={`admin-settings-row-value-${row.id}`}
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
          data-testid={`admin-settings-row-save-${row.id}`}
        >
          Save
        </Button>
      </div>
    </li>
  );
}
