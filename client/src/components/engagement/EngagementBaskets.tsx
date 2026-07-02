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
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Loader2,
  Plus,
  Phone,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  EngagementBasketsResponse,
  EngagementBasketRow,
  EngagementBasketKey,
  BasketReadinessStatus,
} from "@shared/contracts/engagementBaskets";
import {
  type SchedulerOption,
  type AssignedRole,
  type JourneyEvent,
  JOURNEY_EVENT_TONE,
  journeyEventLabel,
  fmtRel,
} from "./engagementShared";

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
  onOpen,
}: {
  row: EngagementBasketRow;
  schedulers: SchedulerOption[];
  assigning: boolean;
  onAssign: (
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) => void;
  onOpen: (row: EngagementBasketRow) => void;
}) {
  const [picked, setPicked] = useState<string>("");

  const canAssign =
    row.patientScreeningId != null && picked !== "" && !assigning;

  return (
    <div
      className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row);
        }
      }}
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

      {/* Assign control — clicks here must not open the journey panel */}
      <div
        className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
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

// ─── Journey slide-over ─────────────────────────────────────────────
//
// Clicking any basket card/row opens this panel with the case's full
// chronological journey timeline (calls, assignments, notes, scheduling
// and document events). Reuses the canonical journey endpoint —
// GET /api/engagement/assignment-board/cases/:id/journey — and the
// manager-note POST on the same route, so the cache is shared with the
// repository view's case panel.

function BasketJourneySheet({
  row,
  onClose,
}: {
  row: EngagementBasketRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  const executionCaseId = row?.executionCaseId ?? null;

  const journeyQuery = useQuery<{ events: JourneyEvent[] }>({
    queryKey: [
      "/api/engagement/assignment-board/cases",
      executionCaseId,
      "journey",
    ],
    enabled: executionCaseId != null,
  });
  const journeyEvents = journeyQuery.data?.events ?? [];

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      if (executionCaseId == null) throw new Error("No case selected");
      const res = await apiRequest(
        "POST",
        `/api/engagement/assignment-board/cases/${executionCaseId}/journey`,
        { note },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "/api/engagement/assignment-board/cases",
          executionCaseId,
          "journey",
        ],
      });
      setNoteDraft("");
      setNoteOpen(false);
      toast({ title: "Note added", description: "Saved to the timeline." });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not add note",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet
      open={row != null}
      onOpenChange={(open) => {
        if (!open) {
          setNoteDraft("");
          setNoteOpen(false);
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        data-testid="basket-journey-sheet"
      >
        {row ? (
          <>
            <SheetHeader className="space-y-1 border-b border-slate-200 px-4 py-3 text-left dark:border-slate-800">
              <SheetTitle
                className="truncate pr-8 text-base"
                data-testid="basket-journey-name"
              >
                {row.patientName}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {row.patientDob ? <span>DOB {row.patientDob}</span> : null}
                  {row.phoneNumber ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {row.phoneNumber}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {row.facility ?? "No facility"}
                  </span>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/* Case context strip */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Call reason
                  </div>
                  <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
                    {row.callReason}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Assigned to
                  </div>
                  <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
                    {row.assignedName ?? "Unassigned"}
                  </div>
                </div>
              </div>

              {row.ancillary.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {row.ancillary.map((a) => (
                    <span
                      key={a}
                      className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Timeline header + add note */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <History className="h-3.5 w-3.5" />
                  Journey timeline
                </div>
                {!noteOpen ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => setNoteOpen(true)}
                    data-testid="basket-journey-add-note"
                  >
                    <Plus className="h-3 w-3" />
                    Add note
                  </Button>
                ) : null}
              </div>

              {noteOpen && (
                <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add context to this patient's timeline…"
                    className="min-h-[56px] text-xs"
                    autoFocus
                    data-testid="basket-journey-note-input"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      disabled={addNoteMutation.isPending}
                      onClick={() => {
                        setNoteOpen(false);
                        setNoteDraft("");
                      }}
                      data-testid="basket-journey-note-cancel"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 gap-1 text-[11px]"
                      disabled={addNoteMutation.isPending || !noteDraft.trim()}
                      onClick={() => addNoteMutation.mutate(noteDraft.trim())}
                      data-testid="basket-journey-note-save"
                    >
                      {addNoteMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      Save note
                    </Button>
                  </div>
                </div>
              )}

              {journeyQuery.isLoading ? (
                <p className="flex items-center gap-1.5 text-xs italic text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
                  history…
                </p>
              ) : journeyQuery.isError ? (
                <p className="text-xs italic text-rose-400">
                  Could not load history.
                </p>
              ) : journeyEvents.length ? (
                <ol
                  className="relative space-y-3 border-l border-slate-200 pl-4 pr-1 dark:border-slate-800"
                  data-testid="basket-journey-timeline-list"
                >
                  {journeyEvents.map((e, idx) => {
                    const tone =
                      JOURNEY_EVENT_TONE[e.eventType] ??
                      "bg-slate-300 dark:bg-slate-600";
                    return (
                      <li
                        key={e.id}
                        className="relative"
                        data-testid={`basket-journey-event-${e.id}`}
                      >
                        <span
                          className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                            idx === 0 ? tone : `${tone} opacity-70`
                          }`}
                        />
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                            {journeyEventLabel(e.eventType)}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium leading-snug text-slate-700 dark:text-slate-200">
                          {e.summary}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-400">
                          <span
                            title={
                              e.createdAt
                                ? new Date(e.createdAt).toLocaleString()
                                : undefined
                            }
                          >
                            {fmtRel(e.createdAt)}
                          </span>
                          {e.actorName && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{e.actorName}</span>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-800">
                  <li className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-300 ring-2 ring-white dark:bg-slate-600 dark:ring-slate-900" />
                    <div className="text-[11px] italic text-slate-400">
                      No call history recorded yet.
                    </div>
                  </li>
                </ol>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
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

function CompactRow({
  row,
  onOpen,
}: {
  row: EngagementBasketRow;
  onOpen: (row: EngagementBasketRow) => void;
}) {
  return (
    <div
      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row);
        }
      }}
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
  const [selectedRow, setSelectedRow] = useState<EngagementBasketRow | null>(
    null,
  );

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
              onOpen={setSelectedRow}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {activeRows.map((r) => (
            <CompactRow
              key={r.executionCaseId}
              row={r}
              onOpen={setSelectedRow}
            />
          ))}
        </div>
      )}

      {/* Journey slide-over — opened by clicking any card/row above */}
      <BasketJourneySheet
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}
