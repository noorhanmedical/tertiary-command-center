import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Loader2,
  Phone,
  PlaneTakeoff,
  RotateCcw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useEngagementCallSettings,
  useUpdateCallSettings,
  type CallSettingsMember,
  type CallSettingsPatch,
  type EngagementTeam,
} from "@/hooks/api/engagementCallSettings";

// Client-side mirror of server target math (callSettingsService.computeCallTargets)
// so calculated targets update live as the admin edits, before saving.
function previewTargets(d: {
  callWorkdayPercent: number;
  visitPercent: number;
  baseCompletedCallKpi: number;
  scheduledKpiPercent: number;
  maxDailyCapacity: number | null;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n || 0));
  const base = Math.max(0, Math.floor(d.baseCompletedCallKpi || 0));
  const completedCallKpi = Math.floor((base * clamp(d.callWorkdayPercent)) / 100);
  const scheduledKpi = Math.round(
    (completedCallKpi * clamp(d.scheduledKpiPercent)) / 100,
  );
  const visitTarget = Math.round(
    (completedCallKpi * clamp(d.visitPercent)) / 100,
  );
  const outreachTarget = Math.max(0, completedCallKpi - visitTarget);
  const maxDailyCapacity =
    d.maxDailyCapacity != null && d.maxDailyCapacity >= 0
      ? d.maxDailyCapacity
      : completedCallKpi;
  return {
    completedCallKpi,
    scheduledKpi,
    visitTarget,
    outreachTarget,
    maxDailyCapacity,
  };
}

type OverrideValue = "auto" | "working" | "off";

interface Draft {
  team: EngagementTeam;
  callWorkdayPercent: number;
  visitPercent: number;
  baseCompletedCallKpi: number;
  scheduledKpiPercent: number;
  maxDailyCapacity: number | null;
  manualWorkingToday: boolean | null;
  active: boolean;
}

function memberToDraft(m: CallSettingsMember): Draft {
  return {
    team: m.team,
    callWorkdayPercent: m.callWorkdayPercent,
    visitPercent: m.visitPercent,
    baseCompletedCallKpi: m.baseCompletedCallKpi,
    scheduledKpiPercent: m.scheduledKpiPercent,
    maxDailyCapacity: m.maxDailyCapacity,
    manualWorkingToday: m.manualWorkingToday,
    active: m.active,
  };
}

function overrideToValue(v: boolean | null): OverrideValue {
  if (v == null) return "auto";
  return v ? "working" : "off";
}
function valueToOverride(v: OverrideValue): boolean | null {
  if (v === "auto") return null;
  return v === "working";
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.team === b.team &&
    a.callWorkdayPercent === b.callWorkdayPercent &&
    a.visitPercent === b.visitPercent &&
    a.baseCompletedCallKpi === b.baseCompletedCallKpi &&
    a.scheduledKpiPercent === b.scheduledKpiPercent &&
    a.maxDailyCapacity === b.maxDailyCapacity &&
    a.manualWorkingToday === b.manualWorkingToday &&
    a.active === b.active
  );
}

function NumberField({
  label,
  suffix,
  value,
  min = 0,
  max = 1000,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  suffix?: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="relative">
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0);
          }}
          className="h-8 pr-7 text-sm tabular-nums"
          data-testid={testId}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

function DerivedStat({
  label,
  value,
  tone = "slate",
  testId,
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "emerald" | "amber" | "indigo" | "rose";
  testId: string;
}) {
  const toneClass: Record<string, string> = {
    slate: "text-slate-900 dark:text-white",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    rose: "text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={`text-base font-semibold tabular-nums ${toneClass[tone]}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}

function WorkingBadge({ member }: { member: CallSettingsMember }) {
  if (member.manualOverrideActive) {
    return member.workingToday ? (
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Working · Override
      </Badge>
    ) : (
      <Badge className="gap-1 bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300">
        <CalendarOff className="h-3 w-3" /> Off · Override
      </Badge>
    );
  }
  if (member.calendarStatus === "pto") {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300">
        <PlaneTakeoff className="h-3 w-3" /> PTO today
      </Badge>
    );
  }
  if (member.calendarStatus === "working") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Working
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-slate-300 text-slate-500 dark:border-slate-700"
    >
      <AlertTriangle className="h-3 w-3" /> Calendar unavailable
    </Badge>
  );
}

function MemberCard({
  member,
  canEdit,
}: {
  member: CallSettingsMember;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const update = useUpdateCallSettings();
  const [draft, setDraft] = useState<Draft>(() => memberToDraft(member));

  const serverDraft = useMemo(() => memberToDraft(member), [member]);
  const dirty = !draftsEqual(draft, serverDraft);

  // Re-sync local draft when the server row changes AND the user has no
  // pending edits, so refreshed/derived values stay accurate without
  // clobbering in-progress edits.
  const prevServerRef = useRef(serverDraft);
  useEffect(() => {
    const serverChanged = !draftsEqual(prevServerRef.current, serverDraft);
    if (serverChanged) {
      const hadPendingEdits = !draftsEqual(draft, prevServerRef.current);
      if (!hadPendingEdits) setDraft(serverDraft);
      prevServerRef.current = serverDraft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDraft]);

  const preview = previewTargets(draft);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    const patch: CallSettingsPatch = {
      team: draft.team,
      callWorkdayPercent: draft.callWorkdayPercent,
      visitPercent: draft.visitPercent,
      baseCompletedCallKpi: draft.baseCompletedCallKpi,
      scheduledKpiPercent: draft.scheduledKpiPercent,
      maxDailyCapacity: draft.maxDailyCapacity,
      manualWorkingToday: draft.manualWorkingToday,
      active: draft.active,
    };
    update.mutate(
      { schedulerId: member.schedulerId, patch },
      {
        onSuccess: () => toast({ title: `Saved ${member.name}'s call settings` }),
        onError: (err: unknown) =>
          toast({
            title: "Could not save",
            description:
              err instanceof Error ? err.message : "Please try again.",
            variant: "destructive",
          }),
      },
    );
  }

  const remainingPreview = Math.max(
    0,
    preview.completedCallKpi - member.carryover,
  );

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      data-testid={`call-settings-card-${member.schedulerId}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className="truncate text-sm font-semibold text-slate-900 dark:text-white"
              data-testid={`text-member-name-${member.schedulerId}`}
            >
              {member.name}
            </h3>
            {!member.active ? (
              <Badge variant="outline" className="text-[10px] text-slate-400">
                Inactive
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-slate-400">{member.facility}</div>
        </div>
        <WorkingBadge member={member} />
      </div>

      {/* Editable inputs */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Team
          </span>
          <Select
            value={draft.team}
            disabled={!canEdit}
            onValueChange={(v) => set("team", v as EngagementTeam)}
          >
            <SelectTrigger
              className="h-8 text-sm"
              data-testid={`select-team-${member.schedulerId}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PCS">PCS</SelectItem>
              <SelectItem value="ACS">ACS</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <NumberField
          label="Workday %"
          suffix="%"
          max={100}
          value={draft.callWorkdayPercent}
          disabled={!canEdit}
          onChange={(n) => set("callWorkdayPercent", n)}
          testId={`input-workday-${member.schedulerId}`}
        />
        <NumberField
          label="Visit %"
          suffix="%"
          max={100}
          value={draft.visitPercent}
          disabled={!canEdit}
          onChange={(n) => set("visitPercent", n)}
          testId={`input-visit-${member.schedulerId}`}
        />
        <NumberField
          label="Calls @ 100%"
          value={draft.baseCompletedCallKpi}
          disabled={!canEdit}
          onChange={(n) => set("baseCompletedCallKpi", n)}
          testId={`input-base-kpi-${member.schedulerId}`}
        />
        <NumberField
          label="Scheduled %"
          suffix="%"
          max={100}
          value={draft.scheduledKpiPercent}
          disabled={!canEdit}
          onChange={(n) => set("scheduledKpiPercent", n)}
          testId={`input-scheduled-pct-${member.schedulerId}`}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Max capacity
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            placeholder="Auto (= KPI)"
            value={draft.maxDailyCapacity ?? ""}
            disabled={!canEdit}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                set("maxDailyCapacity", null);
                return;
              }
              const n = Number.parseInt(raw, 10);
              set(
                "maxDailyCapacity",
                Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : null,
              );
            }}
            className="h-8 text-sm tabular-nums"
            data-testid={`input-max-capacity-${member.schedulerId}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Working today
          </span>
          <Select
            value={overrideToValue(draft.manualWorkingToday)}
            disabled={!canEdit}
            onValueChange={(v) =>
              set("manualWorkingToday", valueToOverride(v as OverrideValue))
            }
          >
            <SelectTrigger
              className="h-8 text-sm"
              data-testid={`select-override-${member.schedulerId}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (calendar)</SelectItem>
              <SelectItem value="working">Force working</SelectItem>
              <SelectItem value="off">Force off</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Derived targets */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <DerivedStat
          label="Calls KPI"
          value={preview.completedCallKpi}
          tone="indigo"
          testId={`stat-completed-kpi-${member.schedulerId}`}
        />
        <DerivedStat
          label="Scheduled"
          value={preview.scheduledKpi}
          tone="emerald"
          testId={`stat-scheduled-kpi-${member.schedulerId}`}
        />
        <DerivedStat
          label="Visit"
          value={preview.visitTarget}
          testId={`stat-visit-target-${member.schedulerId}`}
        />
        <DerivedStat
          label="Outreach"
          value={preview.outreachTarget}
          testId={`stat-outreach-target-${member.schedulerId}`}
        />
        <DerivedStat
          label="Carryover"
          value={member.carryover}
          tone={member.carryover > 0 ? "amber" : "slate"}
          testId={`stat-carryover-${member.schedulerId}`}
        />
        <DerivedStat
          label="Remaining"
          value={dirty ? remainingPreview : member.remainingCapacity}
          tone="rose"
          testId={`stat-remaining-${member.schedulerId}`}
        />
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2">
          <Switch
            checked={draft.active}
            disabled={!canEdit}
            onCheckedChange={(v) => set("active", v)}
            data-testid={`switch-active-${member.schedulerId}`}
          />
          <span className="text-xs text-slate-500">Active for distribution</span>
        </label>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => setDraft(serverDraft)}
                data-testid={`button-reset-${member.schedulerId}`}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            ) : null}
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!dirty || update.isPending}
              onClick={save}
              data-testid={`button-save-${member.schedulerId}`}
            >
              {update.isPending &&
              update.variables?.schedulerId === member.schedulerId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EngagementCallSettings() {
  const { data, isLoading, isError, error } = useEngagementCallSettings();
  const me = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const canEdit = me.data?.role === "admin";

  const members = data?.members ?? [];

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-20 text-slate-400"
        data-testid="call-settings-loading"
      >
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading call settings…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
        data-testid="call-settings-error"
      >
        {error instanceof Error ? error.message : "Failed to load call settings."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section intro + boundary notices */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Phone className="h-4 w-4 text-indigo-500" /> Call Settings
          </h2>
          <p className="text-xs text-slate-500">
            Per-team-member call capacity, KPIs, and visit/outreach split.
            Targets calculate live from each member's workday %.
          </p>
        </div>
        {!canEdit ? (
          <Badge variant="outline" className="text-[10px] text-slate-400">
            Read-only · admin required to edit
          </Badge>
        ) : null}
      </div>

      {!data?.calendarAvailable ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="call-settings-calendar-notice"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Platform calendar schedule unavailable — working status is based on
            platform PTO and roster presence only. Use the manual "Working
            today" override per member as needed. (No Google Calendar.)
          </span>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900"
          data-testid="call-settings-calendar-notice"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Working status uses platform PTO + roster presence. Shift-level
            schedule times are not wired yet — override manually if needed.
          </span>
        </div>
      )}

      {members.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400 dark:border-slate-700"
          data-testid="call-settings-empty"
        >
          No team members on the roster yet. Add schedulers to configure call
          settings.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {members.map((m) => (
            <MemberCard key={m.schedulerId} member={m} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
