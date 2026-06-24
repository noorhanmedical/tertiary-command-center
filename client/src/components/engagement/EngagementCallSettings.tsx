import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Loader2,
  Phone,
  PlaneTakeoff,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
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
  useUpdateCallConfig,
  type CallSettingsMember,
  type CallSettingsPatch,
  type EngagementCallConfig,
  type EngagementTeam,
  type RoundingMode,
  type WorkdayTier,
} from "@/hooks/api/engagementCallSettings";

// Client-side mirror of server target math
// (callSettingsService.computeCallTargets) so calculated targets update live
// as the admin edits, before saving. Must stay in lockstep with the server.
function applyRounding(mode: RoundingMode, n: number): number {
  if (mode === "floor") return Math.floor(n);
  if (mode === "ceil") return Math.ceil(n);
  return Math.round(n);
}

function previewTargets(
  d: {
    callWorkdayPercent: number;
    visitPercent: number | null;
    explicitCompletedCallKpi: number | null;
    explicitScheduledKpi: number | null;
    maxDailyCapacity: number | null;
  },
  config: EngagementCallConfig,
) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n || 0));
  const workday = clamp(d.callWorkdayPercent);
  const round = (n: number) => applyRounding(config.roundingMode, n);

  let completedCallKpi: number;
  if (d.explicitCompletedCallKpi != null && d.explicitCompletedCallKpi >= 0) {
    completedCallKpi = Math.floor(d.explicitCompletedCallKpi);
  } else {
    const tier = config.workdayTiers.find((t) => t.workdayPercent === workday);
    completedCallKpi =
      tier != null
        ? Math.max(0, Math.floor(tier.completedCallKpi))
        : Math.floor(
            (Math.max(0, config.fullDayCompletedCallTarget) * workday) / 100,
          );
  }

  let scheduledKpi: number;
  if (d.explicitScheduledKpi != null && d.explicitScheduledKpi >= 0) {
    scheduledKpi = Math.floor(d.explicitScheduledKpi);
  } else {
    scheduledKpi = round(
      (completedCallKpi * clamp(config.scheduledPatientTargetPercent)) / 100,
    );
  }

  const effectiveVisitPercent = clamp(
    d.visitPercent ?? config.defaultVisitCallPercent,
  );
  const visitTarget = Math.min(
    completedCallKpi,
    Math.max(0, round((completedCallKpi * effectiveVisitPercent) / 100)),
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
    effectiveVisitPercent,
    effectiveOutreachPercent: 100 - effectiveVisitPercent,
  };
}

type OverrideValue = "auto" | "working" | "off";

interface Draft {
  team: EngagementTeam;
  callWorkdayPercent: number;
  visitPercent: number | null;
  explicitCompletedCallKpi: number | null;
  explicitScheduledKpi: number | null;
  facilitiesCovered: string[] | null;
  maxDailyCapacity: number | null;
  manualWorkingToday: boolean | null;
  active: boolean;
}

function memberToDraft(m: CallSettingsMember): Draft {
  return {
    team: m.team,
    callWorkdayPercent: m.callWorkdayPercent,
    visitPercent: m.visitPercent,
    explicitCompletedCallKpi: m.explicitCompletedCallKpi,
    explicitScheduledKpi: m.explicitScheduledKpi,
    facilitiesCovered: m.facilitiesCovered,
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

function arraysEqual(a: string[] | null, b: string[] | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  const sa = [...aa].sort();
  const sb = [...bb].sort();
  return sa.every((v, i) => v === sb[i]);
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.team === b.team &&
    a.callWorkdayPercent === b.callWorkdayPercent &&
    a.visitPercent === b.visitPercent &&
    a.explicitCompletedCallKpi === b.explicitCompletedCallKpi &&
    a.explicitScheduledKpi === b.explicitScheduledKpi &&
    arraysEqual(a.facilitiesCovered, b.facilitiesCovered) &&
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

// Optional integer field: empty string means "auto / inherit" (null).
function OptionalNumberField({
  label,
  placeholder,
  value,
  min = 0,
  max = 1000,
  suffix,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (n: number | null) => void;
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
          placeholder={placeholder}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(null);
              return;
            }
            const n = Number.parseInt(raw, 10);
            onChange(
              Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null,
            );
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

// ─── Facilities multi-select chips ──────────────────────────────────────────
function FacilitiesField({
  selected,
  options,
  disabled,
  onChange,
  schedulerId,
}: {
  selected: string[] | null;
  options: string[];
  disabled?: boolean;
  onChange: (next: string[] | null) => void;
  schedulerId: number;
}) {
  const chosen = selected ?? [];
  const available = options.filter((o) => !chosen.includes(o));

  function add(name: string) {
    const next = [...chosen, name];
    onChange(next);
  }
  function remove(name: string) {
    const next = chosen.filter((c) => c !== name);
    onChange(next.length === 0 ? null : next);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Facilities covered
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {chosen.length === 0 ? (
          <span className="text-xs text-slate-400">
            All facilities (none restricted)
          </span>
        ) : (
          chosen.map((f) => (
            <Badge
              key={f}
              variant="outline"
              className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300"
              data-testid={`chip-facility-${schedulerId}-${f}`}
            >
              {f}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => remove(f)}
                  className="rounded-full hover:text-rose-500"
                  data-testid={`button-remove-facility-${schedulerId}-${f}`}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          ))
        )}
        {!disabled && available.length > 0 ? (
          <Select value="" onValueChange={(v) => v && add(v)}>
            <SelectTrigger
              className="h-7 w-auto gap-1 border-dashed px-2 text-xs"
              data-testid={`select-add-facility-${schedulerId}`}
            >
              <Plus className="h-3 w-3" /> Add
            </SelectTrigger>
            <SelectContent>
              {available.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  canEdit,
  config,
  facilityOptions,
}: {
  member: CallSettingsMember;
  canEdit: boolean;
  config: EngagementCallConfig;
  facilityOptions: string[];
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

  const preview = previewTargets(draft, config);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    const visit = draft.visitPercent;
    const patch: CallSettingsPatch = {
      team: draft.team,
      callWorkdayPercent: draft.callWorkdayPercent,
      visitPercent: visit,
      // Keep the stored split coherent: outreach is the complement of visit.
      outreachPercent: visit == null ? null : 100 - visit,
      explicitCompletedCallKpi: draft.explicitCompletedCallKpi,
      explicitScheduledKpi: draft.explicitScheduledKpi,
      facilitiesCovered: draft.facilitiesCovered,
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
        <OptionalNumberField
          label="Visit %"
          suffix="%"
          max={100}
          placeholder={`Default ${config.defaultVisitCallPercent}%`}
          value={draft.visitPercent}
          disabled={!canEdit}
          onChange={(n) => set("visitPercent", n)}
          testId={`input-visit-${member.schedulerId}`}
        />
        <OptionalNumberField
          label="Calls KPI override"
          placeholder="Auto (tier)"
          value={draft.explicitCompletedCallKpi}
          disabled={!canEdit}
          onChange={(n) => set("explicitCompletedCallKpi", n)}
          testId={`input-explicit-completed-${member.schedulerId}`}
        />
        <OptionalNumberField
          label="Scheduled override"
          placeholder="Auto (%)"
          value={draft.explicitScheduledKpi}
          disabled={!canEdit}
          onChange={(n) => set("explicitScheduledKpi", n)}
          testId={`input-explicit-scheduled-${member.schedulerId}`}
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

      {/* Facilities */}
      <div className="mt-3">
        <FacilitiesField
          selected={draft.facilitiesCovered}
          options={facilityOptions}
          disabled={!canEdit}
          onChange={(next) => set("facilitiesCovered", next)}
          schedulerId={member.schedulerId}
        />
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
          label={`Visit (${preview.effectiveVisitPercent}%)`}
          value={preview.visitTarget}
          testId={`stat-visit-target-${member.schedulerId}`}
        />
        <DerivedStat
          label={`Outreach (${preview.effectiveOutreachPercent}%)`}
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

// ─── Global config panel (defaults + workday tiers + rounding) ──────────────
interface ConfigDraft {
  fullDayCompletedCallTarget: number;
  scheduledPatientTargetPercent: number;
  defaultVisitCallPercent: number;
  roundingMode: RoundingMode;
  workdayTiers: WorkdayTier[];
}

function configToDraft(c: EngagementCallConfig): ConfigDraft {
  return {
    fullDayCompletedCallTarget: c.fullDayCompletedCallTarget,
    scheduledPatientTargetPercent: c.scheduledPatientTargetPercent,
    defaultVisitCallPercent: c.defaultVisitCallPercent,
    roundingMode: c.roundingMode,
    workdayTiers: c.workdayTiers.map((t) => ({ ...t })),
  };
}

function configDraftsEqual(a: ConfigDraft, b: ConfigDraft): boolean {
  if (
    a.fullDayCompletedCallTarget !== b.fullDayCompletedCallTarget ||
    a.scheduledPatientTargetPercent !== b.scheduledPatientTargetPercent ||
    a.defaultVisitCallPercent !== b.defaultVisitCallPercent ||
    a.roundingMode !== b.roundingMode ||
    a.workdayTiers.length !== b.workdayTiers.length
  ) {
    return false;
  }
  const sa = [...a.workdayTiers].sort(
    (x, y) => y.workdayPercent - x.workdayPercent,
  );
  const sb = [...b.workdayTiers].sort(
    (x, y) => y.workdayPercent - x.workdayPercent,
  );
  return sa.every(
    (t, i) =>
      t.workdayPercent === sb[i].workdayPercent &&
      t.completedCallKpi === sb[i].completedCallKpi,
  );
}

function GlobalConfigPanel({
  config,
  canEdit,
}: {
  config: EngagementCallConfig;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const update = useUpdateCallConfig();
  const [draft, setDraft] = useState<ConfigDraft>(() => configToDraft(config));

  const serverDraft = useMemo(() => configToDraft(config), [config]);
  const dirty = !configDraftsEqual(draft, serverDraft);

  const prevServerRef = useRef(serverDraft);
  useEffect(() => {
    const serverChanged = !configDraftsEqual(prevServerRef.current, serverDraft);
    if (serverChanged) {
      const hadPendingEdits = !configDraftsEqual(draft, prevServerRef.current);
      if (!hadPendingEdits) setDraft(serverDraft);
      prevServerRef.current = serverDraft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDraft]);

  function setTier(idx: number, patch: Partial<WorkdayTier>) {
    setDraft((d) => ({
      ...d,
      workdayTiers: d.workdayTiers.map((t, i) =>
        i === idx ? { ...t, ...patch } : t,
      ),
    }));
  }
  function addTier() {
    setDraft((d) => ({
      ...d,
      workdayTiers: [...d.workdayTiers, { workdayPercent: 0, completedCallKpi: 0 }],
    }));
  }
  function removeTier(idx: number) {
    setDraft((d) => ({
      ...d,
      workdayTiers: d.workdayTiers.filter((_, i) => i !== idx),
    }));
  }

  function save() {
    update.mutate(
      {
        fullDayCompletedCallTarget: draft.fullDayCompletedCallTarget,
        scheduledPatientTargetPercent: draft.scheduledPatientTargetPercent,
        defaultVisitCallPercent: draft.defaultVisitCallPercent,
        defaultOutreachCallPercent: 100 - draft.defaultVisitCallPercent,
        roundingMode: draft.roundingMode,
        workdayTiers: draft.workdayTiers,
      },
      {
        onSuccess: () => toast({ title: "Saved global call config" }),
        onError: (err: unknown) =>
          toast({
            title: "Could not save config",
            description: err instanceof Error ? err.message : "Please try again.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div
      className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm dark:border-indigo-900/40 dark:bg-indigo-950/20"
      data-testid="call-config-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Settings2 className="h-4 w-4 text-indigo-500" /> Global call config
          </h3>
          <p className="text-xs text-slate-500">
            Defaults and rounding apply to every member unless overridden.
            Workday tiers map a member's workday % to a fixed completed-call KPI.
          </p>
        </div>
        {!canEdit ? (
          <Badge variant="outline" className="text-[10px] text-slate-400">
            Read-only
          </Badge>
        ) : null}
      </div>

      {/* Global defaults */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label="Full-day calls"
          value={draft.fullDayCompletedCallTarget}
          disabled={!canEdit}
          onChange={(n) => setDraft((d) => ({ ...d, fullDayCompletedCallTarget: n }))}
          testId="input-config-fullday"
        />
        <NumberField
          label="Scheduled %"
          suffix="%"
          max={100}
          value={draft.scheduledPatientTargetPercent}
          disabled={!canEdit}
          onChange={(n) =>
            setDraft((d) => ({ ...d, scheduledPatientTargetPercent: n }))
          }
          testId="input-config-scheduled-pct"
        />
        <NumberField
          label="Default visit %"
          suffix="%"
          max={100}
          value={draft.defaultVisitCallPercent}
          disabled={!canEdit}
          onChange={(n) =>
            setDraft((d) => ({ ...d, defaultVisitCallPercent: n }))
          }
          testId="input-config-visit-pct"
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Rounding mode
          </span>
          <Select
            value={draft.roundingMode}
            disabled={!canEdit}
            onValueChange={(v) =>
              setDraft((d) => ({ ...d, roundingMode: v as RoundingMode }))
            }
          >
            <SelectTrigger
              className="h-8 text-sm"
              data-testid="select-config-rounding"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round">Round (nearest)</SelectItem>
              <SelectItem value="floor">Floor (down)</SelectItem>
              <SelectItem value="ceil">Ceil (up)</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        Default outreach % = {100 - draft.defaultVisitCallPercent}% (complement
        of visit). Rounding applies to scheduled KPI + visit split; completed-call
        KPI always floors.
      </p>

      {/* Workday tiers */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Workday tiers
          </span>
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={addTier}
              data-testid="button-add-tier"
            >
              <Plus className="h-3.5 w-3.5" /> Add tier
            </Button>
          ) : null}
        </div>
        <div className="space-y-1.5">
          {draft.workdayTiers.length === 0 ? (
            <p className="text-xs text-slate-400">
              No tiers — completed-call KPI uses floor(full-day × workday %).
            </p>
          ) : (
            draft.workdayTiers.map((t, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2"
                data-testid={`tier-row-${idx}`}
              >
                <div className="relative w-24">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={t.workdayPercent}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setTier(idx, {
                        workdayPercent: Math.max(
                          0,
                          Math.min(100, Number.parseInt(e.target.value, 10) || 0),
                        ),
                      })
                    }
                    className="h-8 pr-6 text-sm tabular-nums"
                    data-testid={`input-tier-workday-${idx}`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    %
                  </span>
                </div>
                <span className="text-xs text-slate-400">→</span>
                <div className="relative w-28">
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    value={t.completedCallKpi}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setTier(idx, {
                        completedCallKpi: Math.max(
                          0,
                          Math.min(
                            1000,
                            Number.parseInt(e.target.value, 10) || 0,
                          ),
                        ),
                      })
                    }
                    className="h-8 pr-12 text-sm tabular-nums"
                    data-testid={`input-tier-kpi-${idx}`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    calls
                  </span>
                </div>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-rose-500"
                    onClick={() => removeTier(idx)}
                    data-testid={`button-remove-tier-${idx}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      {canEdit ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setDraft(serverDraft)}
              data-testid="button-config-reset"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          ) : null}
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!dirty || update.isPending}
            onClick={save}
            data-testid="button-config-save"
          >
            {update.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save config
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function EngagementCallSettings() {
  const { data, isLoading, isError, error } = useEngagementCallSettings();
  const me = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const canEdit = me.data?.role === "admin";

  const members = data?.members ?? [];
  const config = data?.config;

  // Distinct facility names across the roster, for the per-member chip picker.
  const facilityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) {
      if (m.facility) set.add(m.facility);
    }
    return Array.from(set).sort();
  }, [members]);

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

  if (isError || !config) {
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
            Global defaults + per-team-member call capacity, KPIs, and
            visit/outreach split. Targets calculate live from each member's
            workday %.
          </p>
        </div>
        {!canEdit ? (
          <Badge variant="outline" className="text-[10px] text-slate-400">
            Read-only · admin required to edit
          </Badge>
        ) : null}
      </div>

      <GlobalConfigPanel config={config} canEdit={canEdit} />

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
            <MemberCard
              key={m.schedulerId}
              member={m}
              canEdit={canEdit}
              config={config}
              facilityOptions={facilityOptions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
