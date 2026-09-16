// Engagement Center → Call Lists command center.
//
// A permanent, first-class Engagement view showing EVERY team member's call
// list side-by-side for a selected operational date. It renders LIVE canonical
// state only — the SAME /api/scheduler-portal/cases feed the Team Portals
// consume (per-member, per-date) — plus call_list_packages for per-list PDFs.
// No new tables, no duplicate patient/call/assignment state.
//
//   • Columns  → one per team member (roster, clinic-scoped)
//   • Metrics  → patients / called / remaining / rollover, from LIVE results
//   • Rows     → patient + service + current result + rollover/handoff icons
//   • Rollover → canonical isCarryover (past-due from a prior day)
//   • PDF      → latest ready package for that member+date (open, never regen)
//   • Date     → one-click week strip; drives all columns
//   • Generate → opens GenerateCallListDialog seeded to the selected date

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  RotateCcw,
  ArrowRightLeft,
  CalendarDays,
  Users,
  X,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SchedulerOption } from "./engagementShared";
import { fetchRecentPackages, type RecentPackage } from "@/lib/api/callListPackages";
import {
  resultDisplay,
  deriveColumnMetrics,
  pickLatestPackage,
  type ResultTone,
} from "@shared/engagement/callListBoard";
import { formatSelectedDate } from "@shared/scheduling/pickerModel";

// ─── Live per-member case row (subset of /api/scheduler-portal/cases) ────────
type BoardCase = {
  id: number | string;
  patientScreeningId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  executionCaseId?: number | null;
  selectedServices?: string[] | null;
  engagementStatus?: string | null;
  nextActionAt?: string | null;
  lastCallOutcome?: string | null;
  isCarryover?: boolean;
  isHandoff?: boolean;
  historical?: boolean;
  completed?: boolean;
  historicalCallCount?: number;
};

const TONE_CLASS: Record<ResultTone, string> = {
  muted: "bg-slate-50 text-slate-400",
  neutral: "bg-slate-100 text-slate-600",
  info: "bg-blue-50 text-blue-700",
  warning: "bg-amber-50 text-amber-700",
  positive: "bg-emerald-50 text-emerald-700",
  danger: "bg-rose-50 text-rose-700",
};

// ─── Date helpers (UTC-safe YYYY-MM-DD, no tz drift) ─────────────────────────
function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekDays(selectedIso: string): string[] {
  const [y, m, d] = selectedIso.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const sunday = new Date(base);
  sunday.setUTCDate(base.getUTCDate() - base.getUTCDay());
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(sunday);
    dd.setUTCDate(sunday.getUTCDate() + i);
    return isoOf(dd);
  });
}
function shiftIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return isoOf(dt);
}
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
}
function dayNum(iso: string): number {
  return Number(iso.split("-")[2]);
}

async function fetchMemberCases(
  memberId: number,
  facility: string,
  date: string,
): Promise<BoardCase[]> {
  const q = new URLSearchParams({
    assignedTeamMemberId: String(memberId),
    facilityId: facility,
    date,
    limit: "500",
  });
  const res = await fetch(`/api/scheduler-portal/cases?${q.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load cases (${res.status})`);
  return res.json();
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

// ─── One team-member column ──────────────────────────────────────────────────
function MemberColumn({
  member,
  facility,
  date,
  packages,
  onOpenPatient,
}: {
  member: SchedulerOption;
  facility: string;
  date: string;
  packages: RecentPackage[];
  onOpenPatient: (row: BoardCase, memberName: string) => void;
}) {
  const { data: rows = [], isLoading, isError } = useQuery<BoardCase[]>({
    queryKey: ["calllist-board-cases", member.id, facility, date],
    queryFn: () => fetchMemberCases(member.id, facility, date),
    staleTime: 15_000,
  });

  const metrics = useMemo(() => deriveColumnMetrics(rows), [rows]);
  const pkg = useMemo(
    () => pickLatestPackage(packages, member.id, date),
    [packages, member.id, date],
  );

  return (
    <div
      className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-slate-200 bg-white"
      data-testid={`calllist-column-${member.id}`}
    >
      {/* Header */}
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
            {initials(member.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900" title={member.name}>
              {member.name}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Call List
            </div>
          </div>
          {/* PDF icon — only when a ready package exists for this member+date. */}
          {pkg.latest && pkg.pdfReady ? (
            <a
              href={`/api/engagement/call-lists/packages/${pkg.latest.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              title={
                pkg.count > 1
                  ? `Open latest call-list PDF (${pkg.count} versions for this day)`
                  : "Open call-list PDF"
              }
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              data-testid={`calllist-pdf-${member.id}`}
            >
              <FileText className="h-4 w-4" />
              {pkg.count > 1 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[9px] font-bold text-white">
                  {pkg.count}
                </span>
              ) : null}
            </a>
          ) : pkg.latest ? (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-300"
              title={`PDF ${pkg.latest.generationStatus}`}
              data-testid={`calllist-pdf-pending-${member.id}`}
            >
              <FileText className="h-4 w-4" />
            </span>
          ) : null}
        </div>

        {/* Metrics */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-semibold text-slate-700" data-testid={`calllist-total-${member.id}`}>
            {metrics.total} patient{metrics.total === 1 ? "" : "s"}
          </span>
          <span className="text-emerald-600" data-testid={`calllist-called-${member.id}`}>
            {metrics.called} called
          </span>
          <span className="text-slate-500" data-testid={`calllist-remaining-${member.id}`}>
            {metrics.remaining} left
          </span>
          {metrics.rollover > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700"
              title="Rolled over from a previous day"
              data-testid={`calllist-rollover-${member.id}`}
            >
              <RotateCcw className="h-3 w-3" /> {metrics.rollover}
            </span>
          ) : null}
        </div>
      </div>

      {/* Rows */}
      <div className="min-h-[120px] flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : isError ? (
          <div className="px-2 py-6 text-center text-xs text-rose-500">Couldn't load this list.</div>
        ) : rows.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400">No patients on this day.</div>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => {
              const res = resultDisplay(r.lastCallOutcome);
              const service = (r.selectedServices ?? [])[0] ?? null;
              return (
                <li key={String(r.id)}>
                  <button
                    type="button"
                    onClick={() => onOpenPatient(r, member.name)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
                    data-testid={`calllist-row-${member.id}-${r.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-[13px] font-medium text-slate-800">
                          {r.patientName ?? "Patient"}
                        </span>
                        {r.isCarryover ? (
                          <RotateCcw
                            className="h-3 w-3 shrink-0 text-indigo-500"
                            aria-label="Rolled over from a previous day"
                          />
                        ) : null}
                        {r.isHandoff ? (
                          <ArrowRightLeft
                            className="h-3 w-3 shrink-0 text-amber-500"
                            aria-label="Handoff"
                          />
                        ) : null}
                      </div>
                      {service ? (
                        <div className="truncate text-[10px] text-slate-400">{service}</div>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        TONE_CLASS[res.tone],
                      )}
                    >
                      {res.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Patient detail (concise; canonical fields, not a full chart) ────────────
type CallResultRow = {
  id: number;
  startedAt?: string | null;
  outcome?: string | null;
  attemptNumber?: number | null;
  callbackAt?: string | null;
  notesPreview?: string | null;
  staffName?: string | null;
};

function PatientDetailDialog({
  row,
  memberName,
  onClose,
}: {
  row: BoardCase | null;
  memberName: string | null;
  onClose: () => void;
}) {
  const psId = row?.patientScreeningId ?? null;
  const { data, isLoading } = useQuery<{ results?: CallResultRow[] } | CallResultRow[]>({
    queryKey: ["calllist-board-history", psId],
    queryFn: async () => {
      const res = await fetch(
        `/api/engagement/call-results-list?patientScreeningId=${psId}&limit=8`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("history unavailable");
      return res.json();
    },
    enabled: row != null && psId != null,
    retry: false,
    staleTime: 15_000,
  });
  const history: CallResultRow[] = Array.isArray(data)
    ? data
    : (data?.results ?? []);

  const res = resultDisplay(row?.lastCallOutcome);
  const nextAction = row?.nextActionAt ? new Date(row.nextActionAt) : null;

  return (
    <Dialog open={row != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="calllist-patient-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{row?.patientName ?? "Patient"}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[res.tone])}>
              {res.label}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-slate-400">Assigned to</dt>
            <dd className="text-slate-800">{memberName ?? "—"}</dd>
            <dt className="text-slate-400">Engagement status</dt>
            <dd className="text-slate-800">{row?.engagementStatus ?? "—"}</dd>
            <dt className="text-slate-400">Next action / callback</dt>
            <dd className="text-slate-800">
              {nextAction ? nextAction.toLocaleString() : "—"}
            </dd>
            {row?.isCarryover ? (
              <>
                <dt className="text-slate-400">Rollover</dt>
                <dd className="text-indigo-600">Rolled over from a previous day</dd>
              </>
            ) : null}
            {row?.selectedServices && row.selectedServices.length > 0 ? (
              <>
                <dt className="text-slate-400">Services</dt>
                <dd className="text-slate-800">{row.selectedServices.join(", ")}</dd>
              </>
            ) : null}
          </dl>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <PhoneCall className="h-3 w-3" /> Recent calls
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : history.length === 0 ? (
              <div className="py-2 text-xs text-slate-400">No call history recorded.</div>
            ) : (
              <ul className="space-y-1">
                {history.map((h) => {
                  const hres = resultDisplay(h.outcome);
                  return (
                    <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TONE_CLASS[hres.tone])}>
                          {hres.label}
                        </span>
                        {h.notesPreview ? (
                          <span className="ml-2 truncate text-slate-500">{h.notesPreview}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-slate-400">
                        {h.startedAt ? new Date(h.startedAt).toLocaleDateString() : ""}
                        {h.attemptNumber ? ` · #${h.attemptNumber}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── The board ───────────────────────────────────────────────────────────────
const ALL_CLINICS = "__all_clinics";

export function CallListBoard({
  facility,
  facilityOptions,
  onFacilityChange,
  schedulers,
  onGenerateForDate,
}: {
  /** Selected Engagement clinic (null = all clinics). */
  facility: string | null;
  /** Clinic options for the board's own clinic selector. */
  facilityOptions: string[];
  onFacilityChange: (facility: string | null) => void;
  schedulers: SchedulerOption[];
  onGenerateForDate: (isoDate: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [detail, setDetail] = useState<{ row: BoardCase; memberName: string } | null>(null);
  const today = todayIso();

  const columns = useMemo(() => {
    if (!facility) return schedulers;
    return schedulers.filter(
      (s) => s.facility === facility || (s.facilitiesCovered ?? []).includes(facility),
    );
  }, [schedulers, facility]);

  // Robust clinic list: page-provided options ∪ every facility the roster
  // covers, so a clinic is always selectable even before board data loads.
  const clinicOptions = useMemo(() => {
    const set = new Set<string>(facilityOptions);
    for (const s of schedulers) {
      if (s.facility) set.add(s.facility);
      for (const f of s.facilitiesCovered ?? []) set.add(f);
    }
    return Array.from(set).sort();
  }, [facilityOptions, schedulers]);

  const { data: packages = [] } = useQuery<RecentPackage[]>({
    queryKey: ["calllist-board-packages", facility],
    queryFn: () => fetchRecentPackages({ facility, limit: 100 }),
    staleTime: 30_000,
  });

  const week = useMemo(() => weekDays(selectedDate), [selectedDate]);
  const dateParts = formatSelectedDate(selectedDate);

  return (
    <div className="flex h-full flex-col" data-testid="calllist-board">
      {/* Toolbar: date strip + generate */}
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">
                Call lists for {dateParts?.full ?? selectedDate}
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Live per-member call lists — the same state each team member sees in their portal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={facility ?? ALL_CLINICS}
              onValueChange={(v) => onFacilityChange(v === ALL_CLINICS ? null : v)}
            >
              <SelectTrigger className="h-9 w-[190px] text-xs" data-testid="calllist-clinic-select">
                <SelectValue placeholder="Select clinic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CLINICS}>All clinics</SelectItem>
                {clinicOptions.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 px-2 text-xs text-slate-700"
              data-testid="calllist-date-input"
            />
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={!facility}
              title={facility ? undefined : "Select a clinic first"}
              onClick={() => onGenerateForDate(selectedDate)}
              data-testid="calllist-generate"
            >
              Generate / Assign for {dateParts?.monthDay ?? selectedDate}
            </Button>
          </div>
        </div>

        {/* One-click week strip */}
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedDate(shiftIso(selectedDate, -7))}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Previous week"
            data-testid="calllist-week-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
            {week.map((iso) => {
              const selected = iso === selectedDate;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDate(iso)}
                  aria-pressed={selected}
                  data-testid={`calllist-day-${iso}`}
                  className={cn(
                    "flex min-w-[52px] flex-col items-center rounded-xl px-2 py-1.5 text-center transition-colors",
                    selected
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100",
                    !selected && isToday && "ring-1 ring-slate-300",
                  )}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
                    {weekdayShort(iso)}
                  </span>
                  <span className="text-sm font-semibold leading-tight">{dayNum(iso)}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setSelectedDate(shiftIso(selectedDate, 7))}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Next week"
            data-testid="calllist-week-next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {selectedDate !== today ? (
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
              data-testid="calllist-today"
            >
              Today
            </button>
          ) : null}
        </div>
      </div>

      {/* Board columns */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {!facility ? (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            <div className="text-sm font-medium text-slate-700">Select a clinic</div>
            <p className="mt-1 text-xs text-slate-400">
              Choose a clinic in the toolbar above to view its team members' call lists and
              generate/assign for a date.
            </p>
          </div>
        ) : columns.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md text-center text-sm text-slate-400">
            No team members are configured for {facility}.
          </div>
        ) : (
          <div className="flex gap-3 pb-2" data-testid="calllist-columns">
            {columns.map((m) => (
              <MemberColumn
                key={m.id}
                member={m}
                facility={facility}
                date={selectedDate}
                packages={packages}
                onOpenPatient={(row, memberName) => setDetail({ row, memberName })}
              />
            ))}
          </div>
        )}
      </div>

      <PatientDetailDialog
        row={detail?.row ?? null}
        memberName={detail?.memberName ?? null}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}

export default CallListBoard;
