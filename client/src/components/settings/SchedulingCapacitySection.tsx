// Scheduling / Equipment Capacity — Admin Settings (Facility panel).
//
// Native platform Settings UI (NOT Playground sketch styling). Lets an admin
// configure, per facility, each resource pool's machine count + duration
// (+ ultrasound minutes-per-study + patient turnover), and manage temporary
// date-range capacity overrides (machine outages). Mirrors the
// OrganizationSettingsSection pattern (useQuery + mutation + inline edit +
// toast). Server enforces admin for defaults; admin/PCS/ACS for overrides.

import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, Save, Trash2, AlertTriangle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useFacilities } from "@/hooks/api/organization";
import {
  useFacilityCapacity,
  useUpdateCapacity,
  useCreateOverride,
  useLiftOverride,
  type ResourceType,
  type ResourceCapacityConfig,
} from "@/hooks/api/schedulingCapacity";

const RESOURCE_META: Record<ResourceType, { label: string; accent: string }> = {
  brainwave: { label: "BrainWave", accent: "text-violet-600" },
  vitalwave: { label: "VitalWave", accent: "text-red-600" },
  ultrasound: { label: "Ultrasound", accent: "text-emerald-600" },
};
const RESOURCE_ORDER: ResourceType[] = ["brainwave", "vitalwave", "ultrasound"];

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  suffix?: string;
  testId?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={min}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(min, parseInt(e.target.value, 10) || 0))}
          className="h-8 w-20 tabular-nums"
          data-testid={testId}
        />
        {suffix ? <span className="text-xs text-slate-400">{suffix}</span> : null}
      </div>
    </label>
  );
}

function ResourceRow({
  facility,
  cfg,
}: {
  facility: string;
  cfg: ResourceCapacityConfig;
}) {
  const { toast } = useToast();
  const updateMut = useUpdateCapacity(facility);
  const meta = RESOURCE_META[cfg.resourceType];
  const isUltrasound = cfg.resourceType === "ultrasound";

  const [machineCount, setMachineCount] = useState(cfg.machineCount);
  const [durationMinutes, setDurationMinutes] = useState(cfg.durationMinutes);
  const [minutesPerStudy, setMinutesPerStudy] = useState(cfg.minutesPerStudy ?? 15);
  const [turnoverMinutes, setTurnoverMinutes] = useState(cfg.turnoverMinutes);

  // Reset local edit state when the facility/config changes.
  useEffect(() => {
    setMachineCount(cfg.machineCount);
    setDurationMinutes(cfg.durationMinutes);
    setMinutesPerStudy(cfg.minutesPerStudy ?? 15);
    setTurnoverMinutes(cfg.turnoverMinutes);
  }, [cfg]);

  const dirty =
    machineCount !== cfg.machineCount ||
    durationMinutes !== cfg.durationMinutes ||
    (isUltrasound && minutesPerStudy !== (cfg.minutesPerStudy ?? 15)) ||
    (isUltrasound && turnoverMinutes !== cfg.turnoverMinutes);

  function save() {
    if (durationMinutes < 1 || (isUltrasound && minutesPerStudy < 1)) {
      toast({ title: "Invalid duration", description: "Durations must be at least 1 minute.", variant: "destructive" });
      return;
    }
    updateMut.mutate(
      {
        resourceType: cfg.resourceType,
        body: {
          machineCount,
          durationMinutes,
          minutesPerStudy: isUltrasound ? minutesPerStudy : null,
          turnoverMinutes: isUltrasound ? turnoverMinutes : 0,
        },
      },
      {
        onSuccess: () => toast({ title: `${meta.label} capacity saved` }),
        onError: (e) =>
          toast({ title: "Could not save", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  }

  return (
    <div
      className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
      data-testid={`capacity-row-${cfg.resourceType}`}
    >
      <div className="flex min-w-[110px] items-center gap-2">
        <Activity className={`h-4 w-4 ${meta.accent}`} />
        <span className="text-sm font-semibold text-slate-900">{meta.label}</span>
      </div>
      <NumberField label="Machines" value={machineCount} onChange={setMachineCount} min={0} testId={`capacity-${cfg.resourceType}-machines`} />
      {isUltrasound ? (
        <>
          <NumberField label="Per study" value={minutesPerStudy} onChange={setMinutesPerStudy} min={1} suffix="min" testId={`capacity-${cfg.resourceType}-per-study`} />
          <NumberField label="Patient turnover" value={turnoverMinutes} onChange={setTurnoverMinutes} min={0} suffix="min" testId={`capacity-${cfg.resourceType}-turnover`} />
        </>
      ) : (
        <NumberField label="Duration" value={durationMinutes} onChange={setDurationMinutes} min={1} suffix="min" testId={`capacity-${cfg.resourceType}-duration`} />
      )}
      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || updateMut.isPending}
        onClick={save}
        className="ml-auto h-8"
        data-testid={`capacity-${cfg.resourceType}-save`}
      >
        <Save className="mr-1.5 h-3.5 w-3.5" /> Save
      </Button>
    </div>
  );
}

function TemporaryOverrides({ facility }: { facility: string }) {
  const { toast } = useToast();
  const { data } = useFacilityCapacity(facility);
  const createMut = useCreateOverride(facility);
  const liftMut = useLiftOverride(facility);
  const overrides = (data?.overrides ?? []).filter((o) => o.active);

  const [adding, setAdding] = useState(false);
  const [resourceType, setResourceType] = useState<ResourceType>("vitalwave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [availableCapacity, setAvailableCapacity] = useState(1);
  const [reason, setReason] = useState("");

  function create() {
    if (!startDate || !endDate) {
      toast({ title: "Dates required", description: "Enter a start and end date.", variant: "destructive" });
      return;
    }
    if (endDate < startDate) {
      toast({ title: "Invalid range", description: "End date cannot be before start date.", variant: "destructive" });
      return;
    }
    createMut.mutate(
      { resourceType, startDate, endDate, availableCapacity, reason: reason.trim() || null },
      {
        onSuccess: (res) => {
          const affected = res?.conflicts?.affected?.length ?? 0;
          toast({
            title: "Temporary override added",
            description: affected > 0 ? `${affected} existing appointment${affected === 1 ? "" : "s"} now affected — the team was alerted.` : undefined,
          });
          setAdding(false);
          setStartDate("");
          setEndDate("");
          setReason("");
        },
        onError: (e) => toast({ title: "Could not add override", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  }

  return (
    <div className="mt-5" data-testid="capacity-overrides">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-900">Temporary Availability</span>
        </div>
        {!adding ? (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding(true)} data-testid="capacity-add-override">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Temporary Override
          </Button>
        ) : null}
      </div>

      {overrides.length === 0 && !adding ? (
        <p className="text-sm text-slate-400">No temporary overrides. Default capacity applies every day.</p>
      ) : null}

      <div className="flex flex-col gap-2">
        {overrides.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5"
            data-testid={`capacity-override-${o.id}`}
          >
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-slate-800">{RESOURCE_META[o.resourceType].label}</span>
            <Badge variant="outline" className="rounded-full border-amber-300 bg-white text-amber-700">
              {o.availableCapacity} available
            </Badge>
            <span className="text-xs text-slate-500">
              {o.startDate}{o.endDate !== o.startDate ? ` → ${o.endDate}` : ""}
            </span>
            {o.reason ? <span className="text-xs italic text-slate-500">{o.reason}</span> : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-slate-500 hover:text-red-600"
              onClick={() => liftMut.mutate(o.id)}
              data-testid={`capacity-lift-override-${o.id}`}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Lift
            </Button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" data-testid="capacity-override-form">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Resource</span>
            <Select value={resourceType} onValueChange={(v) => setResourceType(v as ResourceType)}>
              <SelectTrigger className="h-8 w-36" data-testid="capacity-override-resource"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESOURCE_ORDER.map((rt) => (
                  <SelectItem key={rt} value={rt}>{RESOURCE_META[rt].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Start date</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 w-40" data-testid="capacity-override-start" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">End date</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 w-40" data-testid="capacity-override-end" />
          </label>
          <NumberField label="Available" value={availableCapacity} onChange={setAvailableCapacity} min={0} testId="capacity-override-capacity" />
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Reason</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Machine maintenance…" className="h-8 min-w-[160px]" data-testid="capacity-override-reason" />
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8" disabled={createMut.isPending} onClick={create} data-testid="capacity-override-submit">Add</Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SchedulingCapacitySection() {
  const { data: facilities = [] } = useFacilities(false);
  const [selected, setSelected] = useState<string>("");

  // Default to the first active facility once loaded.
  useEffect(() => {
    if (!selected && facilities.length > 0) setSelected(facilities[0].name);
  }, [facilities, selected]);

  const { data, isLoading } = useFacilityCapacity(selected || null);
  const effective = data?.effective;

  const rows = useMemo(
    () => (effective ? RESOURCE_ORDER.map((rt) => effective[rt]) : []),
    [effective],
  );

  return (
    <div data-testid="scheduling-capacity-section">
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Facility</label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-9 w-64" data-testid="capacity-facility-select"><SelectValue placeholder="Select facility…" /></SelectTrigger>
          <SelectContent>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.name}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selected ? (
        <p className="text-sm text-slate-400">Select a facility to configure equipment capacity.</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-400">Loading capacity…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rows.map((cfg) => (
              <ResourceRow key={cfg.resourceType} facility={selected} cfg={cfg} />
            ))}
          </div>
          <TemporaryOverrides facility={selected} />
        </>
      )}
    </div>
  );
}
