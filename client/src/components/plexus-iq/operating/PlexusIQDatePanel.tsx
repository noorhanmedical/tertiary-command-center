import { useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CalendarDays,
  List,
  Clock,
  Pencil,
} from "lucide-react";

// Left "Date" panel for the Plexus IQ operating list.
//
// Expandable date groups; each child row is a real batch/import for
// the selected facility (newest first), showing time, patient count,
// and the batch's qualification status. Selecting a child row drives
// the list and stays highlighted. Facility is implied by the page's
// facility context, so there is no facility column or grouping here.

export type PlexusIQBatchNode = {
  batchId: number;
  /** Human time label derived from createdAt (e.g. "9:24 AM"). */
  timeLabel: string;
  patientCount: number;
  statusLabel: string;
  statusTone: "ready" | "running" | "errors" | "pending";
  /** Sort key — batch createdAt epoch ms, newest first. */
  createdAtMs: number;
  /** Batch facility (for the TIME / FACILITY / CLINICIAN metadata row). */
  facility?: string | null;
  /** Batch clinician snapshot. null → legacy run ("Clinician not recorded"). */
  clinicianName?: string | null;
};

/** Shared display for a batch's clinician attribution. Legacy runs (no stored
 *  clinician) show an honest "Clinician not recorded" — never inferred. */
export function clinicianLabel(clinicianName: string | null | undefined): string {
  const n = (clinicianName ?? "").trim();
  return n.length > 0 ? n : "Clinician not recorded";
}

export type PlexusIQDateGroup = {
  /** ISO date or "unscheduled". */
  key: string;
  label: string;
  batches: PlexusIQBatchNode[];
};

const TONE_DOT: Record<PlexusIQBatchNode["statusTone"], string> = {
  ready: "bg-emerald-500",
  running: "bg-sky-500",
  errors: "bg-rose-500",
  pending: "bg-slate-300",
};

export type PlexusIQDatePanelProps = {
  groups: PlexusIQDateGroup[];
  selectedBatchId: number | null;
  expandedDates: Set<string>;
  onToggleDate: (key: string) => void;
  onSelectBatch: (batchId: number) => void;
  /** When provided, each batch row shows a pencil affordance that lets the
      user change the list's schedule date. */
  onChangeDate?: (batchId: number) => void;
};

type ViewMode = "list" | "calendar" | "recent";

// ─── helpers ────────────────────────────────────────────────────────────────

function parseIsoDate(key: string): Date | null {
  if (key === "unscheduled") return null;
  const d = new Date(key + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── shared batch list rows ──────────────────────────────────────────────────

function BatchRows({
  batches,
  selectedBatchId,
  onSelectBatch,
  onChangeDate,
}: {
  batches: PlexusIQBatchNode[];
  selectedBatchId: number | null;
  onSelectBatch: (id: number) => void;
  onChangeDate?: (id: number) => void;
}) {
  return (
    <div className="ml-3 pl-2 border-l border-sky-100 space-y-0.5 mt-0.5">
      {batches.map((b) => {
        const active = b.batchId === selectedBatchId;
        return (
          <div key={b.batchId} className="group/batchrow flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelectBatch(b.batchId)}
              className={`min-w-0 flex-1 flex flex-col gap-0.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                active ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-sky-50/60"
              }`}
              data-testid={`button-batch-node-${b.batchId}`}
              aria-current={active ? "true" : undefined}
            >
              {/* Line 1: TIME + status/count */}
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[b.statusTone]}`} />
                <span
                  className={`text-xs font-medium truncate flex-1 ${
                    active ? "text-sky-900" : "text-slate-700"
                  }`}
                >
                  {b.timeLabel}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] ${
                    active ? "text-sky-700" : "text-slate-400"
                  }`}
                >
                  {b.statusTone === "running" && (
                    <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
                  )}
                  {b.statusLabel}
                  <span className="tabular-nums">· {b.patientCount}</span>
                </span>
              </div>
              {/* Line 2: FACILITY */}
              {b.facility ? (
                <span className={`pl-3.5 text-[10px] truncate ${active ? "text-sky-700" : "text-slate-500"}`}>
                  {b.facility}
                </span>
              ) : null}
              {/* Line 3: CLINICIAN (legacy → "Clinician not recorded") */}
              <span
                className={`pl-3.5 text-[10px] truncate ${
                  b.clinicianName ? (active ? "text-sky-600" : "text-slate-500") : "text-slate-400 italic"
                }`}
                data-testid={`batch-node-clinician-${b.batchId}`}
              >
                {clinicianLabel(b.clinicianName)}
              </span>
            </button>
            {onChangeDate && (
              <button
                type="button"
                onClick={() => onChangeDate(b.batchId)}
                title="Change date"
                aria-label="Change date"
                className={`shrink-0 p-1 rounded-md text-slate-400 hover:text-sky-700 hover:bg-sky-100 transition-all ${
                  active
                    ? "opacity-100"
                    : "opacity-0 group-hover/batchrow:opacity-100 focus-visible:opacity-100"
                }`}
                data-testid={`button-change-date-${b.batchId}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────────

function ListView({
  groups,
  selectedBatchId,
  expandedDates,
  onToggleDate,
  onSelectBatch,
  onChangeDate,
}: PlexusIQDatePanelProps) {
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const g of groups) {
      const d = parseIsoDate(g.key);
      if (d) set.add(d.getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [groups]);

  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [filterMonth, setFilterMonth] = useState<number | "all">("all");
  const [filterClinician, setFilterClinician] = useState("");

  const filteredGroups = useMemo(() => {
    const cq = filterClinician.trim().toLowerCase();
    return groups
      .filter((g) => {
        const d = parseIsoDate(g.key);
        if (!d) return filterYear === "all" && filterMonth === "all";
        if (filterYear !== "all" && d.getFullYear() !== filterYear) return false;
        if (filterMonth !== "all" && d.getMonth() !== filterMonth) return false;
        return true;
      })
      // Clinician filter narrows the batches WITHIN each group (matches the
      // stored clinicianName — works for free-text names too). Groups with no
      // matching batch drop out.
      .map((g) =>
        cq
          ? { ...g, batches: g.batches.filter((b) => (b.clinicianName ?? "").toLowerCase().includes(cq)) }
          : g,
      )
      .filter((g) => g.batches.length > 0 || !cq);
  }, [groups, filterYear, filterMonth, filterClinician]);

  return (
    <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
      {/* Year / Month dropdowns */}
      <div className="flex gap-1.5 pb-1">
        <select
          value={filterYear === "all" ? "all" : String(filterYear)}
          onChange={(e) =>
            setFilterYear(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="flex-1 text-xs rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          data-testid="select-filter-year"
        >
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={filterMonth === "all" ? "all" : String(filterMonth)}
          onChange={(e) =>
            setFilterMonth(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="flex-1 text-xs rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          data-testid="select-filter-month"
        >
          <option value="all">All months</option>
          {MONTHS.map((m, i) => (
            <option key={i} value={i}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {/* Clinician filter — matches the stored clinicianName (free-text too). */}
      <div className="pb-1">
        <input
          type="text"
          value={filterClinician}
          onChange={(e) => setFilterClinician(e.target.value)}
          placeholder="Filter by clinician…"
          className="w-full text-xs rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          data-testid="input-filter-clinician"
        />
      </div>

      {filteredGroups.length === 0 && (
        <div className="px-2 py-6 text-center text-xs text-slate-400">
          No imports for this period.
        </div>
      )}

      {filteredGroups.map((group) => {
        const expanded = expandedDates.has(group.key);
        const selected = group.batches.some((b) => b.batchId === selectedBatchId);
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => onToggleDate(group.key)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-left ${
                selected ? "bg-black shadow-sm" : "hover:bg-sky-50"
              }`}
              data-testid={`button-date-group-${group.key}`}
            >
              {expanded ? (
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-sky-200" : "text-sky-500"}`} />
              ) : (
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-sky-200" : "text-sky-500"}`} />
              )}
              <span
                className={`text-sm font-medium truncate flex-1 ${
                  selected ? "text-white" : "text-slate-700"
                }`}
              >
                {group.label}
              </span>
            </button>
            {expanded && (
              <BatchRows
                batches={group.batches}
                selectedBatchId={selectedBatchId}
                onSelectBatch={onSelectBatch}
                onChangeDate={onChangeDate}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Calendar view ───────────────────────────────────────────────────────────

function CalendarView({
  groups,
  selectedBatchId,
  onSelectBatch,
  onChangeDate,
}: {
  groups: PlexusIQDateGroup[];
  selectedBatchId: number | null;
  onSelectBatch: (id: number) => void;
  onChangeDate?: (id: number) => void;
}) {
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Build set of ISO dates that have batches
  const batchDateMap = useMemo(() => {
    const map = new Map<string, PlexusIQBatchNode[]>();
    for (const g of groups) {
      if (parseIsoDate(g.key)) {
        map.set(g.key, g.batches);
      }
    }
    return map;
  }, [groups]);

  // The highlighted day follows the actively-selected batch so the calendar
  // highlight stays aligned with the patient list shown on the right.
  const selectedDateKey = useMemo(() => {
    for (const [iso, nodes] of batchDateMap) {
      if (nodes.some((n) => n.batchId === selectedBatchId)) return iso;
    }
    return null;
  }, [batchDateMap, selectedBatchId]);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  }

  // Build grid: weeks × 7 days, Mon-start
  const grid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    // Monday=0, ..., Sunday=6
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [calYear, calMonth]);

  function isoForDay(day: number) {
    const mm = String(calMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${calYear}-${mm}-${dd}`;
  }

  const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  return (
    <div className="flex-1 min-h-0 overflow-auto p-2">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 rounded hover:bg-slate-100 transition-colors"
          data-testid="button-cal-prev-month"
        >
          <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
        </button>
        <span className="text-xs font-semibold text-slate-700">
          {MONTHS[calMonth]} {calYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 rounded hover:bg-slate-100 transition-colors"
          data-testid="button-cal-next-month"
        >
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[9px] font-medium text-slate-400 uppercase">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {grid.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, di) => {
            if (day === null) return <div key={di} />;
            const iso = isoForDay(day);
            const hasBatches = batchDateMap.has(iso);
            const isToday = iso === todayIso;
            const isSelected = iso === selectedDateKey;
            return (
              <button
                key={di}
                type="button"
                disabled={!hasBatches}
                onClick={() => {
                  setExpandedDay((cur) => (cur === iso ? null : iso));
                }}
                className={`relative flex flex-col items-center justify-center rounded py-0.5 my-0.5 text-[11px] font-medium transition-colors
                  ${!hasBatches ? "text-slate-300 cursor-default" : isSelected ? "text-white cursor-pointer" : "text-slate-700 hover:bg-sky-50 cursor-pointer"}
                  ${isSelected ? "bg-black shadow-sm" : ""}
                  ${isToday && !isSelected ? "ring-1 ring-sky-400 rounded" : ""}
                `}
                data-testid={`button-cal-day-${iso}`}
              >
                {day}
                {hasBatches && (
                  <span
                    className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-sky-500"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* Expanded day batch list */}
      {expandedDay && batchDateMap.has(expandedDay) && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-1">
            {new Date(expandedDay + "T00:00:00").toLocaleDateString(undefined, {
              month: "short", day: "numeric", year: "numeric",
            })}
          </div>
          <BatchRows
            batches={batchDateMap.get(expandedDay)!}
            selectedBatchId={selectedBatchId}
            onSelectBatch={onSelectBatch}
            onChangeDate={onChangeDate}
          />
        </div>
      )}
    </div>
  );
}

// ─── Most Recent view ────────────────────────────────────────────────────────

function MostRecentView({
  groups,
  selectedBatchId,
  expandedDates,
  onToggleDate,
  onSelectBatch,
  onChangeDate,
}: PlexusIQDatePanelProps) {
  const mostRecent = useMemo(() => {
    if (groups.length === 0) return null;
    return groups[0];
  }, [groups]);

  useEffect(() => {
    if (!mostRecent) return;
    if (!expandedDates.has(mostRecent.key)) {
      onToggleDate(mostRecent.key);
    }
    if (mostRecent.batches.length > 0) {
      const newest = mostRecent.batches.reduce((a, b) =>
        b.createdAtMs > a.createdAtMs ? b : a
      );
      if (newest.batchId !== selectedBatchId) {
        onSelectBatch(newest.batchId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostRecent]);

  if (!mostRecent) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <div className="px-2 py-6 text-center text-xs text-slate-400">
          No imports yet.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
      <div className="text-[10px] text-slate-400 px-1 pb-1">
        Showing most recent · <span className="font-medium text-slate-600">{mostRecent.label}</span>
      </div>
      <div>
        {(() => {
          const expanded = expandedDates.has(mostRecent.key);
          const selected = mostRecent.batches.some((b) => b.batchId === selectedBatchId);
          return (
        <button
          type="button"
          onClick={() => onToggleDate(mostRecent.key)}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-left ${
            selected ? "bg-black shadow-sm" : "hover:bg-sky-50"
          }`}
          data-testid={`button-date-group-${mostRecent.key}`}
        >
          {expanded ? (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-sky-200" : "text-sky-500"}`} />
          ) : (
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-sky-200" : "text-sky-500"}`} />
          )}
          <span
            className={`text-sm font-medium truncate flex-1 ${
              selected ? "text-white" : "text-slate-700"
            }`}
          >
            {mostRecent.label}
          </span>
        </button>
          );
        })()}
        {expandedDates.has(mostRecent.key) && (
          <BatchRows
            batches={mostRecent.batches}
            selectedBatchId={selectedBatchId}
            onSelectBatch={onSelectBatch}
            onChangeDate={onChangeDate}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

const DATE_PANEL_VIEW_MODE_KEY = "plexusIQ.datePanelViewMode";

function readStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(DATE_PANEL_VIEW_MODE_KEY);
    if (stored === "list" || stored === "calendar" || stored === "recent") return stored;
  } catch {
    // ignore
  }
  return "list";
}

export function PlexusIQDatePanel(props: PlexusIQDatePanelProps) {
  const { groups, selectedBatchId, expandedDates, onToggleDate, onSelectBatch, onChangeDate } = props;
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(DATE_PANEL_VIEW_MODE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  const toggleButtons: { mode: ViewMode; icon: React.ReactNode; label: string; testId: string }[] = [
    {
      mode: "calendar",
      icon: <CalendarDays className="h-3.5 w-3.5" />,
      label: "Calendar",
      testId: "button-view-mode-calendar",
    },
    {
      mode: "list",
      icon: <List className="h-3.5 w-3.5" />,
      label: "List",
      testId: "button-view-mode-list",
    },
    {
      mode: "recent",
      icon: <Clock className="h-3.5 w-3.5" />,
      label: "Most Recent",
      testId: "button-view-mode-recent",
    },
  ];

  return (
    <div
      className="flex flex-col h-full min-h-0 border-r border-slate-200 bg-white"
      data-testid="plexus-iq-date-panel"
    >
      {/* Black header */}
      <div className="flex min-h-[3.5rem] items-center justify-center px-3 border-b border-white/10 bg-black">
        <div className="text-sm font-semibold uppercase tracking-wider text-white text-center">
          Date
        </div>
      </div>

      {/* View-mode toggle strip */}
      <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-b border-sky-100 bg-white">
        {toggleButtons.map(({ mode, icon, label, testId }) => (
          <button
            key={mode}
            type="button"
            title={label}
            onClick={() => setViewMode(mode)}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              viewMode === mode
                ? "bg-sky-200/60 ring-1 ring-sky-300/60 text-sky-900 shadow-sm"
                : "text-sky-600 hover:text-sky-800 hover:bg-sky-50"
            }`}
            data-testid={testId}
            aria-pressed={viewMode === mode}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* Body — swap view */}
      {viewMode === "list" && (
        <ListView
          groups={groups}
          selectedBatchId={selectedBatchId}
          expandedDates={expandedDates}
          onToggleDate={onToggleDate}
          onSelectBatch={onSelectBatch}
          onChangeDate={onChangeDate}
        />
      )}
      {viewMode === "calendar" && (
        <CalendarView
          groups={groups}
          selectedBatchId={selectedBatchId}
          onSelectBatch={onSelectBatch}
          onChangeDate={onChangeDate}
        />
      )}
      {viewMode === "recent" && (
        <MostRecentView
          groups={groups}
          selectedBatchId={selectedBatchId}
          expandedDates={expandedDates}
          onToggleDate={onToggleDate}
          onSelectBatch={onSelectBatch}
          onChangeDate={onChangeDate}
        />
      )}
    </div>
  );
}

export default PlexusIQDatePanel;
