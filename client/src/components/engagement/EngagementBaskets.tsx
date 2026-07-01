// Engagement baskets — the operational tile grid over the whole engagement
// spine. Nine real-data baskets (Unassigned, Assigned Today, Carryover,
// Completed Conversations, Scheduled, Voicemail Left, No Answer, Follow-up
// Needed, Declined). Each tile is a filter over the same enriched case rows;
// counts come straight from /api/engagement/baskets so nothing is fabricated
// and an empty basket honestly shows zero.
//
// The Unassigned basket renders premium enriched cards (identity, facility,
// ancillary, call reason, priority, cooldown, approval + document status,
// created/approved dates, next action) with an inline Assign control that
// reuses the canonical /api/engagement/assignment-board/assign write.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox,
  CalendarClock,
  History,
  CheckCircle2,
  CalendarCheck,
  Voicemail,
  PhoneMissed,
  RotateCcw,
  Ban,
  AlertTriangle,
  Clock,
  MapPin,
  Stethoscope,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type {
  EngagementBasketsResponse,
  EngagementBasketRow,
  EngagementBasketKey,
  BasketReadinessStatus,
} from "@shared/contracts/engagementBaskets";
import type { SchedulerOption, AssignedRole } from "./engagementShared";

const BASKET_ICON: Record<EngagementBasketKey, typeof Inbox> = {
  unassigned: Inbox,
  assignedToday: CalendarClock,
  carryover: History,
  completedConversations: CheckCircle2,
  scheduled: CalendarCheck,
  voicemailLeft: Voicemail,
  noAnswer: PhoneMissed,
  followUpNeeded: RotateCcw,
  declined: Ban,
};

const BASKET_TONE: Record<EngagementBasketKey, string> = {
  unassigned:
    "data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 dark:data-[active=true]:bg-indigo-950/40",
  assignedToday:
    "data-[active=true]:border-emerald-400 data-[active=true]:bg-emerald-50 dark:data-[active=true]:bg-emerald-950/40",
  carryover:
    "data-[active=true]:border-amber-400 data-[active=true]:bg-amber-50 dark:data-[active=true]:bg-amber-950/40",
  completedConversations:
    "data-[active=true]:border-emerald-400 data-[active=true]:bg-emerald-50 dark:data-[active=true]:bg-emerald-950/40",
  scheduled:
    "data-[active=true]:border-sky-400 data-[active=true]:bg-sky-50 dark:data-[active=true]:bg-sky-950/40",
  voicemailLeft:
    "data-[active=true]:border-violet-400 data-[active=true]:bg-violet-50 dark:data-[active=true]:bg-violet-950/40",
  noAnswer:
    "data-[active=true]:border-slate-400 data-[active=true]:bg-slate-100 dark:data-[active=true]:bg-slate-800/60",
  followUpNeeded:
    "data-[active=true]:border-amber-400 data-[active=true]:bg-amber-50 dark:data-[active=true]:bg-amber-950/40",
  declined:
    "data-[active=true]:border-rose-400 data-[active=true]:bg-rose-50 dark:data-[active=true]:bg-rose-950/40",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const READINESS_LABEL: Record<BasketReadinessStatus, string> = {
  not_generated: "Not generated",
  pending: "Pending",
  uploaded: "Uploaded",
  generated: "Generated",
  finalized: "Finalized",
  blocked: "Blocked",
};

const READINESS_TONE: Record<BasketReadinessStatus, string> = {
  not_generated:
    "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  uploaded: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  generated:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  finalized:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  blocked: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

function ReadinessChip({
  label,
  status,
}: {
  label: string;
  status: BasketReadinessStatus;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${READINESS_TONE[status]}`}
      data-testid={`chip-readiness-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className="uppercase tracking-wide opacity-70">{label}</span>
      <span>{READINESS_LABEL[status]}</span>
    </span>
  );
}

const PRIORITY_TONE: Record<EngagementBasketRow["priority"], string> = {
  high: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  normal:
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function UnassignedCard({
  row,
  schedulers,
  assigning,
  onAssign,
}: {
  row: EngagementBasketRow;
  schedulers: SchedulerOption[];
  assigning: boolean;
  onAssign: (
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) => void;
}) {
  const [picked, setPicked] = useState<string>("");

  const canAssign =
    row.patientScreeningId != null && picked !== "" && !assigning;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      data-testid={`card-unassigned-${row.executionCaseId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4
              className="truncate text-sm font-semibold text-slate-900 dark:text-white"
              data-testid={`text-patient-name-${row.executionCaseId}`}
            >
              {row.patientName}
            </h4>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_TONE[row.priority]}`}
            >
              {row.priority}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {row.patientDob ? <span>DOB {row.patientDob}</span> : null}
            {row.phoneNumber ? <span>{row.phoneNumber}</span> : null}
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {row.facility ?? "No facility"}
            </span>
            <span className="capitalize">{row.engagementBucket ?? row.patientType ?? "visit"}</span>
          </div>
        </div>
        <div className="shrink-0 text-right text-[10px] text-slate-400">
          <div>Created {fmtDate(row.createdAt)}</div>
          <div>Approved {fmtDate(row.approvedAt)}</div>
        </div>
      </div>

      {/* Call reason + ancillary */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Stethoscope className="h-3 w-3" />
          {row.callReason}
        </span>
        {row.ancillary.length > 0 ? (
          row.ancillary.map((a) => (
            <span
              key={a}
              className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {a}
            </span>
          ))
        ) : (
          <span className="text-[11px] italic text-slate-400">
            No qualifying ancillary
          </span>
        )}
      </div>

      {/* Approval + cooldown + missing info */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">
          Approval:{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {row.approvalStatus ?? "—"}
          </span>
        </span>
        {row.nextActionAt ? (
          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <Clock className="h-3 w-3" />
            Next {fmtDate(row.nextActionAt)}
          </span>
        ) : null}
        {row.cooldownTests.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            Cooldown: {row.cooldownTests.join(", ")}
          </span>
        ) : null}
        {row.missingInfo.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            Missing: {row.missingInfo.join(", ")}
          </span>
        ) : null}
      </div>

      {/* Document readiness */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ReadinessChip label="Report" status={row.readiness.report} />
        <ReadinessChip label="Order" status={row.readiness.orderNote} />
        <ReadinessChip label="Procedure" status={row.readiness.procedureNote} />
        <ReadinessChip label="Billing" status={row.readiness.billing} />
      </div>

      {/* Assign control */}
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Select value={picked} onValueChange={setPicked}>
          <SelectTrigger
            className="h-8 flex-1 text-xs"
            data-testid={`select-assign-${row.executionCaseId}`}
          >
            <SelectValue placeholder="Assign to team member…" />
          </SelectTrigger>
          <SelectContent>
            {schedulers.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
                {s.facility ? ` · ${s.facility}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8"
          disabled={!canAssign}
          onClick={() => {
            if (row.patientScreeningId == null || picked === "") return;
            onAssign([row.patientScreeningId], Number(picked));
            setPicked("");
          }}
          data-testid={`button-assign-${row.executionCaseId}`}
        >
          Assign
        </Button>
      </div>
      {row.patientScreeningId == null ? (
        <p className="mt-1 text-[10px] text-rose-500">
          No linked screening — cannot assign from here.
        </p>
      ) : null}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  scheduled: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  voicemail:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  noAnswer:
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  followUp:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  declined: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

function CompactRow({ row }: { row: EngagementBasketRow }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
      data-testid={`row-basket-case-${row.executionCaseId}`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {row.patientName}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {row.facility ?? "No facility"}
          </span>
          {row.assignedName ? <span>· {row.assignedName}</span> : null}
          {row.lastAttemptAt ? (
            <span>· Last {fmtDate(row.lastAttemptAt)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.disposition ? (
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${OUTCOME_TONE[row.disposition] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
          >
            {row.lastCallOutcome ?? row.disposition}
          </span>
        ) : null}
        {row.callAttemptCount > 0 ? (
          <span className="text-[10px] text-slate-400">
            {row.callAttemptCount}×
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EngagementBaskets({
  schedulers,
  assigning,
  onAssign,
}: {
  schedulers: SchedulerOption[];
  assigning: boolean;
  onAssign: (
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) => void;
}) {
  const [active, setActive] = useState<EngagementBasketKey>("unassigned");

  const query = useQuery<EngagementBasketsResponse>({
    queryKey: ["/api/engagement/baskets"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/baskets", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load baskets (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const baskets = query.data?.baskets ?? [];
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  const activeRows = useMemo(
    () => rows.filter((r) => r.basketKeys.includes(active)),
    [rows, active],
  );

  const activeDef = baskets.find((b) => b.key === active);

  return (
    <div className="space-y-4">
      {/* Tile grid */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-9"
        data-testid="engagement-basket-tiles"
      >
        {(baskets.length > 0
          ? baskets
          : []
        ).map((b) => {
          const Icon = BASKET_ICON[b.key];
          return (
            <button
              key={b.key}
              type="button"
              data-active={active === b.key}
              onClick={() => setActive(b.key)}
              className={`group flex flex-col items-start gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-left transition-all hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 ${BASKET_TONE[b.key]}`}
              data-testid={`tile-basket-${b.key}`}
            >
              <Icon className="h-4 w-4 text-slate-400 group-data-[active=true]:text-slate-700 dark:group-data-[active=true]:text-slate-200" />
              <span
                className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white"
                data-testid={`count-basket-${b.key}`}
              >
                {b.count}
              </span>
              <span className="text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-300">
                {b.label}
              </span>
            </button>
          );
        })}
        {query.isLoading && baskets.length === 0
          ? Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
              />
            ))
          : null}
      </div>

      {/* Active basket header */}
      {activeDef ? (
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {activeDef.label}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeDef.description}
            </p>
          </div>
          <span className="text-xs text-slate-400">
            {activeRows.length} shown
          </span>
        </div>
      ) : null}

      {/* Active basket list */}
      {query.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          Could not load baskets. Please retry.
        </div>
      ) : activeRows.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40"
          data-testid="empty-basket"
        >
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {query.isLoading ? "Loading…" : "Nothing in this basket right now."}
          </p>
          {!query.isLoading ? (
            <p className="mt-1 text-xs text-slate-400">
              This count is live — it will populate as cases reach this stage.
            </p>
          ) : null}
        </div>
      ) : active === "unassigned" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {activeRows.map((r) => (
            <UnassignedCard
              key={r.executionCaseId}
              row={r}
              schedulers={schedulers}
              assigning={assigning}
              onAssign={onAssign}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {activeRows.map((r) => (
            <CompactRow key={r.executionCaseId} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
