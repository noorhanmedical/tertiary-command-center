import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Loader2,
  Phone,
  Plus,
  PlaneTakeoff,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
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
import { CoverageSummary } from "./CoverageSummary";
import {
  useEngagementCallSettings,
  useUpdateCallSettings,
  useUpdateGlobalCallConfig,
  type CallSettingsMember,
  type CallSettingsPatch,
  type EngagementTeam,
  type GlobalCallConfig,
  type RoundingMode,
  type WorkdayTier,
} from "@/hooks/api/engagementCallSettings";

// ─── Client-side mirror of server target math ───────────────────────────────
// Mirrors callSettingsService.computeCallTargets so previews update live as the
// admin edits, before saving. Priority: explicit override → workday tier →
// global formula. Rounding mode is configurable. Outreach = completed − visit
// so the split always sums to the completed-call KPI.
function applyRounding(value: number, mode: RoundingMode): number {
  if (!Number.isFinite(value)) return 0;
  if (mode === "floor") return Math.floor(value);
  if (mode === "ceil") return Math.ceil(value);
  return Math.round(value);
}
const clampPct = (n: number) => Math.max(0, Math.min(100, n || 0));

function previewTargets(
  d: {
    callWorkdayPercent: number;
    visitPercent: number | null;
    explicitCompletedKpi: number | null;
    explicitScheduledKpi: number | null;
    maxDailyCapacity: number | null;
  },
  config: GlobalCallConfig,
  tiers: WorkdayTier[],
) {
  const mode = config.roundingMode;
  const workday = clampPct(d.callWorkdayPercent);
  const visitPct = clampPct(d.visitPercent ?? config.defaultVisitPercent);
  const scheduledPct = clampPct(config.scheduledKpiPercent);
  const fullDay = Math.max(0, Math.floor(config.fullDayCompletedTarget || 0));

  let completedCallKpi: number;
  if (d.explicitCompletedKpi != null && d.explicitCompletedKpi >= 0) {
    completedCallKpi = Math.floor(d.explicitCompletedKpi);
  } else {
    const tier = tiers.find((t) => clampPct(t.workdayPercent) === workday);
    completedCallKpi =
      tier != null
        ? Math.max(0, Math.floor(tier.completedKpi))
        : Math.max(0, applyRounding((fullDay * workday) / 100, mode));
  }

  const scheduledKpi =
    d.explicitScheduledKpi != null && d.explicitScheduledKpi >= 0
      ? Math.floor(d.explicitScheduledKpi)
      : Math.max(0, applyRounding((completedCallKpi * scheduledPct) / 100, mode));

  const visitTarget = Math.min(
    completedCallKpi,
    Math.max(0, applyRounding((completedCallKpi * visitPct) / 100, mode)),
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
  visitPercent: number | null;
  baseCompletedCallKpi: number;
  scheduledKpiPercent: number;
  maxDailyCapacity: number | null;
  explicitCompletedKpi: number | null;
  explicitScheduledKpi: number | null;
  facilitiesCovered: string[] | null;
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
    explicitCompletedKpi: m.explicitCompletedKpi,
    explicitScheduledKpi: m.explicitScheduledKpi,
    facilitiesCovered: m.facilitiesCovered,
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

function facilitiesEqual(a: string[] | null, b: string[] | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.team === b.team &&
    a.callWorkdayPercent === b.callWorkdayPercent &&
    a.visitPercent === b.visitPercent &&
    a.baseCompletedCallKpi === b.baseCompletedCallKpi &&
    a.scheduledKpiPercent === b.scheduledKpiPercent &&
    a.maxDailyCapacity === b.maxDailyCapacity &&
    a.explicitCompletedKpi === b.explicitCompletedKpi &&
    a.explicitScheduledKpi === b.explicitScheduledKpi &&
    facilitiesEqual(a.facilitiesCovered, b.facilitiesCovered) &&
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
  placeholder,
  onChange,
  testId,
}: {
  label: string;
  suffix?: string;
  value: number | null;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  onChange: (n: number | null) => void;
  testId: string;
}) {
  const nullable = placeholder != null;
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
          value={value == null ? "" : Number.isFinite(value) ? value : 0}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(nullable ? null : 0);
              return;
            }
            const n = Number.parseInt(raw, 10);
            onChange(
              Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : nullable ? null : 0,
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

// ─── Global defaults + workday-tier table ───────────────────────────────────
function GlobalDefaultsPanel({
  config,
  tiers,
  canEdit,
}: {
  config: GlobalCallConfig;
  tiers: WorkdayTier[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const update = useUpdateGlobalCallConfig();
  const [cfg, setCfg] = useState<GlobalCallConfig>(config);
  const [tierDraft, setTierDraft] = useState<WorkdayTier[]>(tiers);

  // Resync when server values change and there are no pending local edits.
  const serverKey = useMemo(
    () => JSON.stringify({ config, tiers }),
    [config, tiers],
  );
  const prevServerKey = useRef(serverKey);
  const dirty =
    JSON.stringify(cfg) !== JSON.stringify(config) ||
    JSON.stringify(tierDraft) !== JSON.stringify(tiers);
  useEffect(() => {
    if (prevServerKey.current !== serverKey) {
      const hadEdits =
        JSON.stringify(cfg) !== JSON.stringify(JSON.parse(prevServerKey.current).config) ||
        JSON.stringify(tierDraft) !==
          JSON.stringify(JSON.parse(prevServerKey.current).tiers);
      if (!hadEdits) {
        setCfg(config);
        setTierDraft(tiers);
      }
      prevServerKey.current = serverKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  function setVisit(v: number) {
    const visit = clampPct(v);
    setCfg((c) => ({
      ...c,
      defaultVisitPercent: visit,
      defaultOutreachPercent: 100 - visit,
    }));
  }
  function setOutreach(v: number) {
    const outreach = clampPct(v);
    setCfg((c) => ({
      ...c,
      defaultOutreachPercent: outreach,
      defaultVisitPercent: 100 - outreach,
    }));
  }

  function setTier(idx: number, key: keyof WorkdayTier, value: number) {
    setTierDraft((rows) =>
      rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              [key]:
                key === "workdayPercent"
                  ? clampPct(value)
                  : Math.max(0, Math.min(1000, value || 0)),
            }
          : r,
      ),
    );
  }
  function addTier() {
    setTierDraft((rows) => [...rows, { workdayPercent: 0, completedKpi: 0 }]);
  }
  function removeTier(idx: number) {
    setTierDraft((rows) => rows.filter((_, i) => i !== idx));
  }

  const duplicateWorkday = useMemo(() => {
    const seen = new Set<number>();
    for (const t of tierDraft) {
      if (seen.has(t.workdayPercent)) return true;
      seen.add(t.workdayPercent);
    }
    return false;
  }, [tierDraft]);

  function save() {
    if (cfg.defaultVisitPercent + cfg.defaultOutreachPercent !== 100) {
      toast({
        title: "Visit % and outreach % must sum to 100",
        variant: "destructive",
      });
      return;
    }
    if (duplicateWorkday) {
      toast({ title: "Workday tiers must be unique", variant: "destructive" });
      return;
    }
    const sorted = [...tierDraft].sort(
      (a, b) => b.workdayPercent - a.workdayPercent,
    );
    update.mutate(
      { config: cfg, tiers: sorted },
      {
        onSuccess: () => toast({ title: "Saved global call settings" }),
        onError: (err: unknown) =>
          toast({
            title: "Could not save",
            description: err instanceof Error ? err.message : "Please try again.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      data-testid="global-defaults-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Sliders className="h-4 w-4 text-indigo-500" /> Global defaults
        </h3>
        {canEdit && dirty ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                setCfg(config);
                setTierDraft(tiers);
              }}
              data-testid="button-reset-global"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={update.isPending}
              onClick={save}
              data-testid="button-save-global"
            >
              {update.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save defaults
            </Button>
          </div>
        ) : null}
      </div>

      {/* Global numeric defaults */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <NumberField
          label="Full-day calls"
          value={cfg.fullDayCompletedTarget}
          disabled={!canEdit}
          onChange={(n) =>
            setCfg((c) => ({ ...c, fullDayCompletedTarget: n ?? 0 }))
          }
          testId="input-global-fullday"
        />
        <NumberField
          label="Scheduled %"
          suffix="%"
          max={100}
          value={cfg.scheduledKpiPercent}
          disabled={!canEdit}
          onChange={(n) =>
            setCfg((c) => ({ ...c, scheduledKpiPercent: clampPct(n ?? 0) }))
          }
          testId="input-global-scheduled-pct"
        />
        <NumberField
          label="Default visit %"
          suffix="%"
          max={100}
          value={cfg.defaultVisitPercent}
          disabled={!canEdit}
          onChange={(n) => setVisit(n ?? 0)}
          testId="input-global-visit-pct"
        />
        <NumberField
          label="Default outreach %"
          suffix="%"
          max={100}
          value={cfg.defaultOutreachPercent}
          disabled={!canEdit}
          onChange={(n) => setOutreach(n ?? 0)}
          testId="input-global-outreach-pct"
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Rounding
          </span>
          <Select
            value={cfg.roundingMode}
            disabled={!canEdit}
            onValueChange={(v) =>
              setCfg((c) => ({ ...c, roundingMode: v as RoundingMode }))
            }
          >
            <SelectTrigger
              className="h-8 text-sm"
              data-testid="select-global-rounding"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round">Round</SelectItem>
              <SelectItem value="floor">Floor</SelectItem>
              <SelectItem value="ceil">Ceil</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Workday tiers */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Workday tiers (workday % → completed-call KPI)
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
        <div className="mt-2 space-y-1.5" data-testid="tier-list">
          {tierDraft.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 py-3 text-center text-xs text-slate-400 dark:border-slate-700">
              No tiers — falls back to full-day target × workday %.
            </div>
          ) : (
            tierDraft.map((t, idx) => (
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
                      setTier(idx, "workdayPercent", Number.parseInt(e.target.value, 10))
                    }
                    className="h-8 pr-6 text-sm tabular-nums"
                    data-testid={`input-tier-workday-${idx}`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    %
                  </span>
                </div>
                <span className="text-xs text-slate-400">→</span>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  value={t.completedKpi}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setTier(idx, "completedKpi", Number.parseInt(e.target.value, 10))
                  }
                  className="h-8 w-24 text-sm tabular-nums"
                  data-testid={`input-tier-kpi-${idx}`}
                />
                <span className="text-xs text-slate-400">calls</span>
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
        {duplicateWorkday ? (
          <p className="mt-2 text-xs text-rose-500" data-testid="tier-duplicate-warning">
            Workday percentages must be unique.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  config,
  tiers,
  canEdit,
}: {
  member: CallSettingsMember;
  config: GlobalCallConfig;
  tiers: WorkdayTier[];
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

  const preview = previewTargets(
    {
      callWorkdayPercent: draft.callWorkdayPercent,
      visitPercent: draft.visitPercent,
      explicitCompletedKpi: draft.explicitCompletedKpi,
      explicitScheduledKpi: draft.explicitScheduledKpi,
      maxDailyCapacity: draft.maxDailyCapacity,
    },
    config,
    tiers,
  );

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Effective visit % shown in the field (member override or global default).
  const effectiveVisit = draft.visitPercent ?? config.defaultVisitPercent;

  function save() {
    const patch: CallSettingsPatch = {
      team: draft.team,
      callWorkdayPercent: draft.callWorkdayPercent,
      visitPercent: effectiveVisit,
      baseCompletedCallKpi: draft.baseCompletedCallKpi,
      scheduledKpiPercent: draft.scheduledKpiPercent,
      maxDailyCapacity: draft.maxDailyCapacity,
      explicitCompletedKpi: draft.explicitCompletedKpi,
      explicitScheduledKpi: draft.explicitScheduledKpi,
      outreachPercent: 100 - effectiveVisit,
      facilitiesCovered: draft.facilitiesCovered,
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
          onChange={(n) => set("callWorkdayPercent", clampPct(n ?? 0))}
          testId={`input-workday-${member.schedulerId}`}
        />
        <NumberField
          label="Visit %"
          suffix="%"
          max={100}
          value={effectiveVisit}
          disabled={!canEdit}
          onChange={(n) => set("visitPercent", n == null ? null : clampPct(n))}
          testId={`input-visit-${member.schedulerId}`}
        />
        <NumberField
          label="Explicit calls"
          placeholder="Auto"
          value={draft.explicitCompletedKpi}
          disabled={!canEdit}
          onChange={(n) => set("explicitCompletedKpi", n)}
          testId={`input-explicit-calls-${member.schedulerId}`}
        />
        <NumberField
          label="Explicit sched."
          placeholder="Auto"
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
        <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Facilities covered (comma-separated)
          </span>
          <Input
            type="text"
            placeholder="e.g. Clinic A, Clinic B"
            value={(draft.facilitiesCovered ?? []).join(", ")}
            disabled={!canEdit}
            onChange={(e) => {
              const parts = e.target.value
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              set("facilitiesCovered", parts.length ? parts : null);
            }}
            className="h-8 text-sm"
            data-testid={`input-facilities-${member.schedulerId}`}
          />
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
  const config = data?.config;
  const tiers = data?.tiers ?? [];

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
            Configure the distribution model: global defaults, workday tiers, and
            per-member overrides. Targets calculate live from these settings.
          </p>
        </div>
        {!canEdit ? (
          <Badge variant="outline" className="text-[10px] text-slate-400">
            Read-only · admin required to edit
          </Badge>
        ) : null}
      </div>

      <GlobalDefaultsPanel config={config} tiers={tiers} canEdit={canEdit} />

      {members.length > 0 ? <CoverageSummary members={members} /> : null}

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
              config={config}
              tiers={tiers}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
