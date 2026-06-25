import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Stethoscope,
  UserCog,
  ExternalLink,
  FileText,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  type BoardRow,
  type SchedulerOption,
  type AssignedRole,
  dueBucketOf,
  dueLabel,
  fmtRel,
  callReasonOf,
  targetTestOf,
  priorityOf,
  PRIORITY_LABELS,
  openSinglePatientPacket,
  openBulkPatientPackets,
  type BulkPacketRef,
  coverageRelation,
  sortSchedulersByCoverage,
  commonFacility,
} from "./engagementShared";
import { formatDateHeader } from "@/lib/format";

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-400",
  normal: "bg-slate-300 dark:bg-slate-600",
};

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  normal: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
};

// Small "Home" / "Covers" tag rendered next to a member who can serve the
// case's facility.
function CoverageTag({ relation }: { relation: "home" | "covers" }) {
  const isHome = relation === "home";
  return (
    <span
      className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
        isHome
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
          : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
      }`}
      data-testid={`engagement-coverage-tag-${relation}`}
    >
      {isHome ? "Home" : "Covers"}
    </span>
  );
}

// Compact inline scheduler picker used for per-card + bulk assign. When
// `caseFacility` is supplied, members who serve that facility — first the
// roster "home" member, then members who explicitly cover it — are sorted to
// the top and tagged, so a manager gets coverage-based routing suggestions
// even while commit-time auto-assign is OFF. Falls back to plain alphabetical
// order when no facility is known or no coverage is configured.
function SchedulerPicker({
  schedulers,
  busy,
  initial,
  onPick,
  label = "Assign",
  testId,
  disabled,
  caseFacility,
}: {
  schedulers: SchedulerOption[];
  busy: boolean;
  initial?: number | null;
  onPick: (schedulerId: number) => void;
  label?: string;
  testId?: string;
  disabled?: boolean;
  caseFacility?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>(
    initial != null ? String(initial) : "",
  );
  const ordered = useMemo(
    () => sortSchedulersByCoverage(schedulers, caseFacility),
    [schedulers, caseFacility],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={disabled}
          data-testid={testId}
        >
          <UserCog className="h-3 w-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] space-y-2 p-2.5">
        <Select value={picked} onValueChange={setPicked}>
          <SelectTrigger className="h-8 text-xs" data-testid="engagement-card-assign-select">
            <SelectValue placeholder="Pick a team member…" />
          </SelectTrigger>
          <SelectContent>
            {ordered.map((s) => {
              const relation = coverageRelation(s, caseFacility);
              return (
                <SelectItem key={s.id} value={String(s.id)}>
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate">
                      {s.name} · {s.facility}
                    </span>
                    {relation !== "none" && <CoverageTag relation={relation} />}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy || !picked}
          onClick={() => {
            const sid = Number.parseInt(picked, 10);
            if (Number.isFinite(sid)) {
              onPick(sid);
              setOpen(false);
            }
          }}
          data-testid="engagement-card-assign-save"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// Multi-scheduler picker that splits the current selection evenly
// (round-robin) across the chosen team members — parity with the prior
// board's distribute flow.
function DistributePopover({
  schedulers,
  busy,
  onDistribute,
  disabled,
  caseFacility,
}: {
  schedulers: SchedulerOption[];
  busy: boolean;
  onDistribute: (schedulerIds: number[]) => void;
  disabled?: boolean;
  caseFacility?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const ordered = useMemo(
    () => sortSchedulersByCoverage(schedulers, caseFacility),
    [schedulers, caseFacility],
  );

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPicked(new Set());
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={disabled}
          data-testid="engagement-worklist-bulk-distribute"
        >
          <Shuffle className="h-3 w-3" />
          Distribute
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] space-y-2 p-2.5">
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Split evenly across team members
        </p>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {ordered.map((s) => {
            const relation = coverageRelation(s, caseFacility);
            return (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Checkbox
                  checked={picked.has(s.id)}
                  onCheckedChange={() => toggle(s.id)}
                  data-testid={`engagement-distribute-option-${s.id}`}
                />
                <span className="truncate">
                  {s.name} · {s.facility}
                </span>
                {relation !== "none" && <CoverageTag relation={relation} />}
              </label>
            );
          })}
        </div>
        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy || picked.size === 0}
          onClick={() => {
            onDistribute(Array.from(picked));
            setPicked(new Set());
            setOpen(false);
          }}
          data-testid="engagement-distribute-confirm"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            `Distribute to ${picked.size || 0}`
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function WorklistCard({
  row,
  schedulers,
  selected,
  active,
  assigning,
  removing,
  onToggleSelect,
  onOpen,
  onAssignOne,
  onRemove,
}: {
  row: BoardRow;
  schedulers: SchedulerOption[];
  selected: boolean;
  active: boolean;
  assigning: boolean;
  removing: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onAssignOne: (schedulerId: number) => void;
  onRemove: () => void;
}) {
  const { toast } = useToast();
  const [pdfBusy, setPdfBusy] = useState<"plexus" | "clinician" | null>(null);
  const priority = priorityOf(row);
  const target = targetTestOf(row);
  const psid = row.patientScreeningId;

  async function handlePdf(mode: "plexus" | "clinician") {
    if (psid == null) return;
    setPdfBusy(mode);
    const result = await openSinglePatientPacket(
      psid,
      row.patientName,
      row.scheduleDate ?? null,
      mode,
    );
    setPdfBusy(null);
    if (!result.ok) {
      toast({
        title: "Could not open packet",
        description: result.error,
        variant: "destructive",
      });
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid="engagement-worklist-card"
      data-execution-case-id={row.executionCaseId}
      data-active={active ? "true" : "false"}
      className={`group cursor-pointer rounded-2xl border bg-white p-3 transition-all hover:shadow-md dark:bg-slate-900 ${
        active
          ? "border-slate-900 ring-1 ring-slate-900 dark:border-white dark:ring-white"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="pt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            disabled={psid == null}
            onCheckedChange={onToggleSelect}
            data-testid="engagement-worklist-select"
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`}
              title={`${PRIORITY_LABELS[priority]} priority`}
              aria-hidden
            />
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {row.patientName}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${PRIORITY_TONE[priority]}`}
            >
              {PRIORITY_LABELS[priority]}
            </span>
            {row.missingInfo?.length ? (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-rose-600"
                title={`Missing: ${row.missingInfo.join(", ")}`}
              >
                <AlertCircle className="h-3 w-3" />
              </span>
            ) : null}
          </div>

          {/* Reason + target test */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{callReasonOf(row)}</span>
            {target.primary && (
              <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <Stethoscope className="h-3 w-3" />
                {target.primary}
                {target.extra > 0 ? ` +${target.extra}` : ""}
              </span>
            )}
            {row.facility && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {row.facility}
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
            <span
              className={`rounded-md px-1.5 py-0.5 font-medium ${
                dueBucketOf(row.nextActionAt) === "overdue"
                  ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
              data-testid="engagement-worklist-due"
            >
              {dueLabel(row.nextActionAt)}
            </span>
            {row.assignedName ? (
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {row.assignedName}
              </span>
            ) : (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                Unassigned
              </span>
            )}
            {row.lastActivitySummary && (
              <span className="truncate text-slate-400">
                {row.lastActivitySummary} · {fmtRel(row.lastActivityAt)}
              </span>
            )}
          </div>
        </div>

        {/* Actions (reveal on hover / when active) */}
        <div
          className={`flex shrink-0 items-center gap-1 transition-opacity ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <SchedulerPicker
            schedulers={schedulers}
            busy={assigning}
            initial={row.assignedTeamMemberId}
            onPick={onAssignOne}
            label={row.assignedName ? "Reassign" : "Assign"}
            testId="engagement-worklist-card-assign"
            caseFacility={row.facility}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-slate-400"
                disabled={psid == null}
                aria-label="Packets"
                data-testid="engagement-worklist-card-pdf"
              >
                {pdfBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handlePdf("plexus");
                }}
                data-testid="engagement-worklist-card-plexus-pdf"
              >
                <FileText className="h-3.5 w-3.5" /> Plexus PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handlePdf("clinician");
                }}
                data-testid="engagement-worklist-card-clinician-pdf"
              >
                <FileText className="h-3.5 w-3.5" /> Clinician PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {psid != null && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-slate-400"
            >
              <a
                href={`/patient-directory?patientId=${psid}`}
                aria-label="Open patient"
                data-testid="engagement-worklist-card-open"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
            disabled={removing}
            onClick={onRemove}
            aria-label="Remove from worklist"
            data-testid="engagement-worklist-card-remove"
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EngagementWorklist({
  rows,
  loading,
  schedulers,
  selectedCaseId,
  assigning,
  cancelling,
  removingCaseId,
  onSelectCase,
  onAssign,
  onCancel,
}: {
  rows: BoardRow[];
  loading: boolean;
  schedulers: SchedulerOption[];
  selectedCaseId: number | null;
  assigning: boolean;
  cancelling: boolean;
  removingCaseId: number | null;
  onSelectCase: (executionCaseId: number) => void;
  onAssign: (
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) => void;
  onCancel: (executionCaseIds: number[]) => void;
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPdfBusy, setBulkPdfBusy] = useState<"plexus" | "clinician" | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rowByCase = useMemo(() => {
    const m = new Map<number, BoardRow>();
    for (const r of rows) m.set(r.executionCaseId, r);
    return m;
  }, [rows]);

  // executionCaseId -> patientScreeningId for assign payloads.
  const psidByCase = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const r of rows) m.set(r.executionCaseId, r.patientScreeningId);
    return m;
  }, [rows]);

  // Only cases with a patientScreeningId can be assigned, so those are the
  // ones eligible for select-all / group-select.
  const allSelectableIds = useMemo(
    () =>
      rows
        .filter((r) => r.patientScreeningId != null)
        .map((r) => r.executionCaseId),
    [rows],
  );
  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  // The facility shared by every selected row (null when the selection spans
  // multiple facilities) — lets the bulk pickers surface coverage suggestions
  // only when they apply unambiguously.
  const selectedFacility = useMemo(
    () =>
      commonFacility(
        Array.from(selectedIds).map((id) => rowByCase.get(id)?.facility),
      ),
    [selectedIds, rowByCase],
  );

  // Prune any selected case that is no longer visible (search / filter /
  // smart-filter change). Prevents bulk actions from touching hidden rows.
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (rowByCase.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rowByCase]);

  // Group by schedule date, then by facility within each date — the
  // organization the team is used to from the prior board.
  const grouped = useMemo(() => {
    const rank: Record<string, number> = { high: 0, medium: 1, normal: 2 };
    const map = new Map<
      string,
      { date: string | null; facility: string; rows: BoardRow[] }
    >();
    for (const r of rows) {
      const date = r.scheduleDate ?? null;
      const facility = r.facility?.trim() || "Unscheduled facility";
      const key = `${date ?? "zzz-no-date"}|${facility}`;
      if (!map.has(key)) map.set(key, { date, facility, rows: [] });
      map.get(key)!.rows.push(r);
    }
    const groups = Array.from(map.values());
    // Date ascending (undated last), then facility alphabetical.
    groups.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : Infinity;
      const tb = b.date ? new Date(b.date).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return a.facility.localeCompare(b.facility);
    });
    // Within a group: high priority first, then earliest next-action.
    for (const g of groups) {
      g.rows.sort((a, b) => {
        const pr = rank[priorityOf(a)] - rank[priorityOf(b)];
        if (pr !== 0) return pr;
        const ta = a.nextActionAt ? new Date(a.nextActionAt).getTime() : Infinity;
        const tb = b.nextActionAt ? new Date(b.nextActionAt).getTime() : Infinity;
        return ta - tb;
      });
    }
    return groups;
  }, [rows]);

  function toggleSelect(caseId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const everyOn =
        allSelectableIds.length > 0 &&
        allSelectableIds.every((id) => prev.has(id));
      return everyOn ? new Set() : new Set(allSelectableIds);
    });
  }

  function groupSelectableIds(g: { rows: BoardRow[] }) {
    return g.rows
      .filter((r) => r.patientScreeningId != null)
      .map((r) => r.executionCaseId);
  }

  function toggleGroupSelect(ids: number[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everyOn = ids.length > 0 && ids.every((id) => next.has(id));
      if (everyOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  // Assign an entire date/facility group to one team member in a single click.
  function assignGroup(g: { rows: BoardRow[] }, schedulerId: number) {
    const psids = g.rows
      .map((r) => r.patientScreeningId)
      .filter((v): v is number => v != null);
    if (psids.length) onAssign(psids, schedulerId);
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function bulkAssign(schedulerId: number) {
    const psids = Array.from(selectedIds)
      .map((cid) => psidByCase.get(cid))
      .filter((v): v is number => v != null);
    if (psids.length === 0) return;
    onAssign(psids, schedulerId);
    clearSelection();
  }

  // Round-robin the current selection across the chosen schedulers.
  function bulkDistribute(schedulerIds: number[]) {
    if (schedulerIds.length === 0) return;
    const psids = Array.from(selectedIds)
      .map((cid) => psidByCase.get(cid))
      .filter((v): v is number => v != null);
    if (psids.length === 0) return;
    const buckets: number[][] = schedulerIds.map(() => []);
    psids.forEach((p, i) => buckets[i % schedulerIds.length].push(p));
    buckets.forEach((slice, idx) => {
      if (slice.length) onAssign(slice, schedulerIds[idx]);
    });
    clearSelection();
  }

  function bulkRemove() {
    // Defensive: only act on cases that are still visible in this view.
    const ids = Array.from(selectedIds).filter((id) => rowByCase.has(id));
    if (ids.length === 0) {
      clearSelection();
      return;
    }
    onCancel(ids);
    clearSelection();
  }

  async function bulkPdf(mode: "plexus" | "clinician") {
    const refs: BulkPacketRef[] = Array.from(selectedIds)
      .map((cid) => rowByCase.get(cid))
      .filter((r): r is BoardRow => r != null)
      .map((r) => ({
        patientScreeningId: r.patientScreeningId,
        patientName: r.patientName,
        facility: r.facility ?? null,
        scheduleDate: r.scheduleDate ?? null,
      }));
    if (refs.length === 0) return;
    setBulkPdfBusy(mode);
    const result = await openBulkPatientPackets(refs, mode);
    setBulkPdfBusy(null);
    if (!result.ok) {
      toast({
        title: "Could not open packets",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    if (result.dropped.length > 0) {
      toast({
        title: `Opened ${result.rendered} group${result.rendered === 1 ? "" : "s"}`,
        description: `Skipped (no content): ${result.dropped.join(", ")}`,
      });
    }
  }

  return (
    <div className="space-y-3" data-testid="engagement-worklist">
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-12 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading worklist…
        </div>
      ) : grouped.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-800 dark:bg-slate-900"
          data-testid="engagement-worklist-empty"
        >
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Nothing in this view
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Try a different smart filter or clear your search.
          </p>
        </div>
      ) : (
        <>
          {/* Persistent command toolbar — always visible so assigning,
              distributing and packet actions are one click away. */}
          <div
            className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
            data-testid="engagement-worklist-toolbar"
          >
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              data-testid="engagement-worklist-select-all"
            >
              <Checkbox
                checked={allSelected}
                aria-label="Select all"
                className="pointer-events-none"
              />
              {someSelected
                ? `${selectedIds.size} selected`
                : `Select all (${allSelectableIds.length})`}
            </button>

            <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

            <SchedulerPicker
              schedulers={schedulers}
              busy={assigning}
              onPick={bulkAssign}
              label="Assign"
              disabled={!someSelected}
              testId="engagement-worklist-bulk-assign"
              caseFacility={selectedFacility}
            />
            <DistributePopover
              schedulers={schedulers}
              busy={assigning}
              onDistribute={bulkDistribute}
              disabled={!someSelected}
              caseFacility={selectedFacility}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={!someSelected || bulkPdfBusy != null}
                  data-testid="engagement-worklist-bulk-pdf"
                >
                  {bulkPdfBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  Packets
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    bulkPdf("plexus");
                  }}
                  data-testid="engagement-worklist-bulk-plexus-pdf"
                >
                  <FileText className="h-3.5 w-3.5" /> Plexus packet
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    bulkPdf("clinician");
                  }}
                  data-testid="engagement-worklist-bulk-clinician-pdf"
                >
                  <FileText className="h-3.5 w-3.5" /> Clinician packet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px] text-rose-600 hover:text-rose-700"
              disabled={!someSelected || cancelling}
              onClick={bulkRemove}
              data-testid="engagement-worklist-bulk-remove"
            >
              {cancelling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Remove
            </Button>
            {someSelected && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px] text-slate-400"
                onClick={clearSelection}
                data-testid="engagement-worklist-bulk-clear"
              >
                <X className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>

          {/* Date · facility groups — each collapsible, with its own
              select-all and one-click "assign all" picker. */}
          {grouped.map((group) => {
            const key = `${group.date ?? "no-date"}|${group.facility}`;
            const ids = groupSelectableIds(group);
            const groupAllSelected =
              ids.length > 0 && ids.every((id) => selectedIds.has(id));
            const isCollapsed = collapsed.has(key);
            return (
              <section
                key={key}
                data-testid="engagement-worklist-group"
                data-group-date={group.date ?? "no-date"}
                data-group-facility={group.facility}
              >
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(key)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                    aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                    data-testid="engagement-group-toggle"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                  <Checkbox
                    checked={groupAllSelected}
                    disabled={ids.length === 0}
                    onCheckedChange={() => toggleGroupSelect(ids)}
                    aria-label="Select all in group"
                    data-testid="engagement-group-select"
                  />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    {group.date ? formatDateHeader(group.date) : "Unscheduled"}
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                    <Building2 className="h-3 w-3" />
                    {group.facility}
                  </span>
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {group.rows.length}
                  </span>
                  <div className="ml-auto">
                    <SchedulerPicker
                      schedulers={schedulers}
                      busy={assigning}
                      onPick={(sid) => assignGroup(group, sid)}
                      label="Assign all"
                      testId="engagement-group-assign"
                      caseFacility={group.facility}
                    />
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="space-y-2">
                    {group.rows.map((r) => (
                      <WorklistCard
                        key={r.executionCaseId}
                        row={r}
                        schedulers={schedulers}
                        selected={selectedIds.has(r.executionCaseId)}
                        active={selectedCaseId === r.executionCaseId}
                        assigning={assigning}
                        removing={
                          cancelling && removingCaseId === r.executionCaseId
                        }
                        onToggleSelect={() => toggleSelect(r.executionCaseId)}
                        onOpen={() => onSelectCase(r.executionCaseId)}
                        onAssignOne={(sid) => {
                          const psid = psidByCase.get(r.executionCaseId);
                          if (psid != null) onAssign([psid], sid);
                        }}
                        onRemove={() => onCancel([r.executionCaseId])}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

// Backwards-compatible default-style export name. The page imports
// `EngagementWorklist`; this alias keeps any older reference working.
export const EngagementAssignmentBoard = EngagementWorklist;
