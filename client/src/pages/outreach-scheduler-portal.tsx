import { useEffect, useMemo, useState } from "react";
  import { Link, useParams } from "wouter";
  import {
    ArrowLeft, Calendar, Mail, FileText, ListTodo, MessageCircle, Phone, X, Keyboard,
  } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Badge } from "@/components/ui/badge";
  import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
  } from "@/components/ui/dialog";
  import { useToast } from "@/hooks/use-toast";
  import {
    useBookAppointment,
    useCancelAppointment,
  } from "@/hooks/api/appointments";
  import { useJoinTaskAsCollaborator } from "@/hooks/api/plexus";
  import {
    useLogOutreachCall,
    invalidateOutreach,
  } from "@/hooks/api/outreach";
  import type { AncillaryAppointment } from "@shared/schema";
  import { toDateKey, isBrainWave } from "@/components/clinic-calendar";
  import type { BookingSlot } from "@/components/clinic-calendar";
  import { TaskDrawer } from "@/components/plexus/TaskDrawer";
  import type { PlexusTaskSummary } from "@/components/plexus/SchedulerIcon";
  import { DispositionSheet } from "@/components/outreach/DispositionSheet";
  import type { OutreachCallItem } from "@/components/outreach/types";
  import { ShortcutRow } from "@/components/outreach/SmallBits";
  import { RailIcon } from "@/components/outreach/RailIcon";
  import { CurrentCallCard } from "@/components/outreach/CurrentCallCard";
  import { FloatingMetricsTile } from "@/components/outreach/FloatingMetricsTile";
  import { MissionControlBar } from "@/components/outreach/MissionControlBar";
  import { AiBar } from "@/components/outreach/AiBar";
  import { TriClinicCalendar } from "@/components/outreach/TriClinicCalendar";
  import { EmailComposer } from "@/components/outreach/EmailComposer";
  import { MaterialsPanel } from "@/components/outreach/MaterialsPanel";
  import { ExpandedSectionView } from "@/components/outreach/ExpandedSectionView";
  import { CallListPanel } from "@/components/outreach/CallListPanel";
  import {
    SlotBookingDialog, CancelAppointmentDialog, PatientQuickBookDialog,
  } from "@/components/outreach/BookingDialogs";
  import { useOutreachData } from "@/components/outreach/useOutreachData";
  import { useSelectedPatient } from "@/components/outreach/useSelectedPatient";
  
export default function OutreachSchedulerPortalPage() {
  const params = useParams<{ id: string }>();
  const schedulerId = params.id ?? "";

  // Calendar (booking) state
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [bookSlot, setBookSlot] = useState<BookingSlot | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookLinkedPatient, setBookLinkedPatient] = useState<OutreachCallItem | null>(null);
  const [bookPatientSearch, setBookPatientSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AncillaryAppointment | null>(null);
  const [callListBookPatient, setCallListBookPatient] = useState<OutreachCallItem | null>(null);
  const [callListBookTestType, setCallListBookTestType] = useState<"BrainWave" | "VitalWave">("BrainWave");
  const [callListBookTime, setCallListBookTime] = useState<string>("");
  const [scrollToSlot, setScrollToSlot] = useState<{ time: string; testType: string } | null>(null);
  const [bookingPanelOpen, setBookingPanelOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"calendar" | "email" | "materials" | "tasks" | "currentCall" | "messages" | null>(null);

  // Playfield tabs (persist across patient changes; per-patient labeled)
  type ExpandedKind = "currentCall" | "calendar" | "email" | "materials" | "tasks" | "messages";
  type PlayfieldTabKind = ExpandedKind | "thread";
  type PlayfieldTab = { id: string; kind: PlayfieldTabKind; patientId?: number; patientName?: string; label: string };
  function tabKindToExpanded(kind: PlayfieldTabKind): ExpandedKind | null {
    return kind === "thread" ? null : kind;
  }
  const [playfieldTabs, setPlayfieldTabs] = useState<PlayfieldTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Call flow state
  const [expandedTimeline, setExpandedTimeline] = useState<Set<number>>(new Set());
  const [scriptOpen, setScriptOpen] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Tasks tile + urgent panel
  const [taskDrawerPatientId, setTaskDrawerPatientId] = useState<number | null>(null);
  const [taskDrawerTasks, setTaskDrawerTasks] = useState<PlexusTaskSummary[]>([]);
  const [taskDrawerPatientName, setTaskDrawerPatientName] = useState<string>("");

  const { toast } = useToast();

  // ── Data ────────────────────────────────────────────────────────────────
    const {
      isLoading,
      card,
      facility,
      appointments,
      currentUser,
      users,
      urgentTasks,
      unreadTaskIds,
      openTasks,
      todayCalls,
      assignmentByPatient,
      schedulerNameById,
      callsByPatient,
      latestCallByPatient,
      sortedCallList,
      callbacksDue,
    } = useOutreachData(schedulerId);

  
  // ── Selected patient (Current Call) — URL hash drives selection ────────────
    const { selectedId, selectPatient } = useSelectedPatient();

  

  // ── Mutations ──────────────────────────────────────────────────────────────
  const bookAppointmentMut = useBookAppointment();
  const cancelAppointmentMut = useCancelAppointment();
  const joinTaskMut = useJoinTaskAsCollaborator();
  const logCallSilent = useLogOutreachCall();

  const bookMutation = {
    mutate: (input: { patientName: string; testType: string; scheduledTime: string; patientId?: number }) => {
      const { patientName, testType, scheduledTime, patientId } = input;
      const scheduledDate = toDateKey(calYear, calMonth, selectedDay!);
      bookAppointmentMut.mutate(
        { patientName, facility: facility!, scheduledDate, scheduledTime, testType },
        {
          onSuccess: async () => {
            // Persist a "scheduled" call event so call history reflects the
            // booking. Booking already succeeded — surface any logging error
            // as a non-blocking warning toast so the operator can retry.
            if (patientId != null) {
              try {
                await logCallSilent.mutateAsync({
                  patientScreeningId: patientId,
                  outcome: "scheduled",
                  notes: `Booked ${testType} on ${scheduledDate} at ${scheduledTime}`,
                  schedulerUserId: currentUser?.id,
                });
              } catch (err: unknown) {
                toast({
                  title: "Booking saved, but call history not updated",
                  description: err instanceof Error ? err.message : "You may need to log this call manually.",
                  variant: "destructive",
                });
              }
            }
            invalidateOutreach();
            toast({ title: "Appointment booked" });
            setBookSlot(null);
            setBookName("");
            setBookLinkedPatient(null);
            setBookPatientSearch("");
            setCallListBookPatient(null);
            setCallListBookTime("");
          },
          onError: (e: Error) => toast({ title: "Booking failed", description: e.message, variant: "destructive" }),
        },
      );
    },
    isPending: bookAppointmentMut.isPending,
  };

  const cancelMutation = {
    mutate: (id: number) =>
      cancelAppointmentMut.mutate(id, {
        onSuccess: () => {
          // Cancellation may flip a patient back to outreach-derived type;
          // refresh the dashboard so the call list updates next poll.
          invalidateOutreach();
          toast({ title: "Appointment cancelled" });
          setCancelTarget(null);
        },
        onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
      }),
    isPending: cancelAppointmentMut.isPending,
  };

  const helpMutation = {
    mutate: (taskId: number) =>
      joinTaskMut.mutate(taskId, {
        onSuccess: () => toast({ title: "You've been added as a collaborator" }),
        onError: (e: Error) => toast({ title: "Could not join task", description: e.message, variant: "destructive" }),
      }),
    isPending: joinTaskMut.isPending,
  };

  function openTaskDrawer(task: PlexusTaskSummary) {
    setTaskDrawerPatientId(task.patientScreeningId ?? 0);
    setTaskDrawerTasks([task]);
    setTaskDrawerPatientName(task.patientName ?? "");
  }

  function openPlayfieldTab(opts: { kind: PlayfieldTabKind; patientId?: number; patientName?: string; threadId?: string }) {
    const { kind, patientId, patientName, threadId } = opts;
    const id = `${kind}:${threadId ?? patientId ?? "global"}`;
    const labelBase: Record<PlayfieldTabKind, string> = {
      currentCall: "Call", calendar: "Calendar", email: "Email", materials: "Materials",
      tasks: "Tasks", messages: "Messages", thread: "Thread",
    };
    const label = patientName ? `${labelBase[kind]} · ${patientName}` : labelBase[kind];
    setPlayfieldTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind, patientId, patientName, label }]));
    setActiveTabId(id);
    setExpandedSection(tabKindToExpanded(kind));
  }
  function closePlayfieldTab(id: string) {
    setPlayfieldTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const fallback = next[next.length - 1] ?? null;
        setActiveTabId(fallback?.id ?? null);
        setExpandedSection(fallback ? tabKindToExpanded(fallback.kind) : null);
      }
      return next;
    });
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate),
  );
  const selectedDateStr = selectedDay ? toDateKey(calYear, calMonth, selectedDay) : null;
  const todayDateStr = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const todayAppointments = (appointments || [])
    .filter((a) => a.scheduledDate === todayDateStr && a.status === "scheduled")
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  // Auto-select the top-priority patient on first load when no #p<id> hash
  // has placed the cursor anywhere — the top slot is always Current Call.
  useEffect(() => {
    if (selectedId == null && sortedCallList.length > 0 && !isLoading) {
      const top = sortedCallList[0]?.item.patientId;
      if (top != null) selectPatient(top);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCallList, isLoading]);

  const selectedItem = useMemo(
    () => (card?.callList ?? []).find((p) => p.patientId === selectedId) ?? null,
    [card, selectedId],
  );

  const selectedCalls = selectedId != null ? callsByPatient[selectedId] ?? [] : [];
  const selectedAssignment = selectedId != null ? assignmentByPatient.get(selectedId) ?? null : null;
  const selectedLineageFromName =
    selectedAssignment?.source === "reassigned" && selectedAssignment.originalSchedulerId
      ? schedulerNameById.get(selectedAssignment.originalSchedulerId) ?? `#${selectedAssignment.originalSchedulerId}`
      : null;

  // Header metrics for THIS scheduler today.
  const callsMade = todayCalls.length;
  const reachedCount = todayCalls.filter((c) =>
    ["reached", "scheduled", "callback", "declined", "not_interested", "language_barrier"].includes(c.outcome),
  ).length;
  const scheduledFromCalls = todayCalls.filter((c) => c.outcome === "scheduled").length;
  const conversionPct = callsMade === 0 ? 0 : Math.round((scheduledFromCalls / callsMade) * 100);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (isTyping) return;
      if (e.key === "?") {
        setShortcutsOpen(true);
        return;
      }
      if (!selectedItem) return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDispositionOpen(true);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setBookingPanelOpen(true);
        setCallListBookPatient(selectedItem);
        setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
        setCallListBookTime("");
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
        const next = sortedCallList[idx + 1] ?? sortedCallList[0];
        if (next) selectPatient(next.item.patientId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedItem, sortedCallList]);

  // Booking dialogs derived state
  const bookPatientResults = useMemo(() => {
    const q = bookPatientSearch.trim().toLowerCase();
    const list = card?.callList ?? [];
    if (!q) return list.slice(0, 8);
    return list.filter((p) => p.patientName.toLowerCase().includes(q)).slice(0, 8);
  }, [bookPatientSearch, card]);
  const effectiveBookName = bookLinkedPatient?.patientName ?? bookName;
  const scheduledCallListNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of card?.callList ?? []) {
      if (item.appointmentStatus?.toLowerCase() === "scheduled") names.add(item.patientName.trim().toLowerCase());
    }
    return names;
  }, [card?.callList]);

  // Loading / not-found
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
        Loading scheduler portal…
      </div>
    );
  }
  if (!card) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-slate-500 text-sm">
        <p>Scheduler not found.</p>
        <Button asChild variant="outline" className="rounded-2xl">
          <Link href="/outreach"><ArrowLeft className="mr-2 h-4 w-4" />Back to Outreach</Link>
        </Button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full flex-1 overflow-auto xl:h-full xl:min-h-0 xl:overflow-hidden flex flex-col bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6 xl:flex-1 xl:min-h-0">

        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <Phone className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <h1
                className="truncate text-base font-semibold text-slate-900"
                data-testid="text-calendar-header-title"
              >
                {card.name}
              </h1>
              <p className="truncate text-xs text-slate-500">
                {card.facility} · {card.totalPatients} patient{card.totalPatients !== 1 ? "s" : ""} today
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              System active
            </span>
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              data-testid="portal-shortcuts-btn"
            >
              <Keyboard className="h-3.5 w-3.5" /> Shortcuts
            </button>
            <Link
              href="/outreach"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              data-testid="link-back-outreach"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Outreach
            </Link>
          </div>
        </header>

        {/* ── Cockpit grid: icon rail · playfield · call list ── */}
        <div className="grid gap-5 xl:grid-cols-[64px_1fr_360px] xl:flex-1 xl:min-h-0">

          {/* ─── ICON RAIL: Schedule · Tasks · Email · Materials · Messages ─── */}
          <div className="hidden xl:flex flex-col items-center gap-3 rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl py-4">
            {/* Schedule */}
            <RailIcon
              title="Schedule"
              icon={<Calendar className="h-5 w-5" />}
              hoverClass="hover:border-blue-300 hover:text-blue-600"
              testId="portal-icon-schedule"
              onExpand={() => openPlayfieldTab({ kind: "calendar" })}
              popoverClassName="w-[360px] p-0"
              popoverContent={
                <div className="max-h-[520px] overflow-y-auto">
                  <TriClinicCalendar
                    facility={card.facility}
                    appointments={appointments}
                    selectedItem={selectedItem}
                    calYear={calYear}
                    calMonth={calMonth}
                    setCalMonth={setCalMonth}
                    setCalYear={setCalYear}
                    selectedDay={selectedDay}
                    setSelectedDay={setSelectedDay}
                    onConfirmSlot={(slot) => {
                      setBookSlot(slot);
                      if (selectedItem) {
                        setBookLinkedPatient(selectedItem);
                        setBookName("");
                        setBookPatientSearch("");
                      }
                    }}
                  />
                </div>
              }
            />

            {/* Tasks */}
            <RailIcon
              title="Tasks"
              icon={<ListTodo className="h-5 w-5" />}
              hoverClass="hover:border-violet-300 hover:text-violet-600"
              testId="portal-icon-tasks"
              badge={urgentTasks.length + openTasks.length}
              onExpand={() => openPlayfieldTab({ kind: "tasks" })}
              popoverClassName="w-[320px] p-3"
              popoverContent={
                <div data-testid="portal-rail-tasks-popover">
                  <div className="mb-2 flex items-center gap-2">
                    <ListTodo className="h-4 w-4 text-violet-600" />
                    <h2 className="text-sm font-semibold text-slate-800">Tasks</h2>
                    {(urgentTasks.length + openTasks.length) > 0 && (
                      <Badge className="rounded-full bg-violet-100 text-violet-700 text-[10px]">
                        {urgentTasks.length + openTasks.length}
                      </Badge>
                    )}
                  </div>
                  {(urgentTasks.length + openTasks.length) === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-5 text-center text-xs text-slate-400">
                      No open tasks
                    </div>
                  ) : (
                    <div className="space-y-1.5 overflow-y-auto pr-1 max-h-[360px]">
                      {[
                        ...urgentTasks.map((t) => ({ task: t, isUrgent: true as const })),
                        ...openTasks
                          .filter((t) => !urgentTasks.some((u) => u.id === t.id))
                          .map((t) => ({ task: t, isUrgent: false as const })),
                      ].map(({ task, isUrgent }) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => openTaskDrawer(task)}
                          className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                            isUrgent
                              ? "border-orange-200 bg-orange-50/40 hover:border-orange-300"
                              : "border-slate-100 bg-white hover:border-violet-200"
                          }`}
                          data-testid={`portal-rail-task-${task.id}`}
                        >
                          {isUrgent && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-500 ring-2 ring-orange-200" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-slate-800">{task.title}</span>
                              {unreadTaskIds.has(task.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                            </div>
                            {task.patientName && <p className="mt-0.5 truncate text-[11px] text-slate-500">{task.patientName}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
            />

            {/* Email */}
            <RailIcon
              title="Email"
              icon={<Mail className="h-5 w-5" />}
              hoverClass="hover:border-emerald-300 hover:text-emerald-600"
              testId="portal-icon-email"
              onExpand={() => openPlayfieldTab({ kind: "email" })}
              popoverClassName="w-[360px] p-3"
              popoverContent={
                <EmailComposer selectedItem={selectedItem} facility={card.facility} />
              }
            />

            {/* Marketing materials */}
            <RailIcon
              title="Marketing materials"
              icon={<FileText className="h-5 w-5" />}
              hoverClass="hover:border-amber-300 hover:text-amber-600"
              testId="portal-icon-materials"
              onExpand={() => openPlayfieldTab({ kind: "materials" })}
              popoverClassName="w-[360px] p-3"
              popoverContent={
                <div className="max-h-[480px] overflow-y-auto">
                  <MaterialsPanel selectedItem={selectedItem} />
                </div>
              }
            />

            {/* Messages */}
            <RailIcon
              title="Messages"
              icon={<MessageCircle className="h-5 w-5" />}
              hoverClass="hover:border-emerald-300 hover:text-emerald-600"
              testId="portal-icon-messages"
              onExpand={() => openPlayfieldTab({ kind: "messages" })}
              popoverClassName="w-[320px] p-3"
              popoverContent={
                <div data-testid="portal-rail-messages-popover">
                  <div className="mb-2 flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-emerald-600" />
                    <h2 className="text-sm font-semibold text-slate-800">Messages</h2>
                  </div>
                  {[...urgentTasks, ...openTasks.filter((t) => !urgentTasks.some((u) => u.id === t.id))].length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-5 text-center text-xs text-slate-400">
                      No active threads
                    </div>
                  ) : (
                    <div className="space-y-1.5 overflow-y-auto pr-1 max-h-[360px]">
                      {[...urgentTasks, ...openTasks.filter((t) => !urgentTasks.some((u) => u.id === t.id))].map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => openTaskDrawer(task)}
                          className="flex w-full items-start gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2 text-left transition hover:border-emerald-200"
                          data-testid={`portal-rail-message-${task.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-slate-800">{task.title}</span>
                              {unreadTaskIds.has(task.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                            </div>
                            {task.patientName && <p className="mt-0.5 truncate text-[11px] text-slate-500">{task.patientName}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
            />
          </div>

          {/* ─── CENTER PANEL: Full-bleed playfield with tabs + floating AI bar ─── */}
          <div className="min-w-0 flex flex-col gap-2 xl:min-h-0 relative">
            {/* Sticky top-center metrics pill — floats above the panel */}
            <div className="sticky top-2 z-20 flex justify-center">
              <FloatingMetricsTile
                callsMade={callsMade}
                reachedCount={reachedCount}
                scheduledFromCalls={scheduledFromCalls}
                conversionPct={conversionPct}
                callbacksDue={callbacksDue}
              />
            </div>

            {/* ── Playfield tabs strip ── */}
            {playfieldTabs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-1" data-testid="portal-playfield-tabs">
                {playfieldTabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      className={`group inline-flex items-center gap-1 rounded-t-xl border px-3 py-1.5 text-xs transition ${
                        isActive
                          ? "border-indigo-300 bg-white text-indigo-700 shadow-sm"
                          : "border-slate-200 bg-white/60 text-slate-600 hover:bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTabId(tab.id);
                          setExpandedSection(tabKindToExpanded(tab.kind));
                          if (tab.patientId) selectPatient(tab.patientId);
                        }}
                        className="font-medium truncate max-w-[180px]"
                        data-testid={`portal-tab-${tab.id}`}
                      >
                        {tab.label}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); closePlayfieldTab(tab.id); }}
                        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        data-testid={`portal-tab-close-${tab.id}`}
                        title="Close tab"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-4 xl:flex-1 xl:min-h-0 relative pb-24">
              {expandedSection ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <ExpandedSectionView
                    section={expandedSection}
                    onClose={() => setExpandedSection(null)}
                    facility={card.facility}
                    appointments={appointments}
                    selectedItem={selectedItem}
                    calYear={calYear}
                    calMonth={calMonth}
                    setCalMonth={setCalMonth}
                    setCalYear={setCalYear}
                    selectedDay={selectedDay}
                    setSelectedDay={setSelectedDay}
                    onConfirmSlot={(slot) => {
                      setBookSlot(slot);
                      if (selectedItem) {
                        setBookLinkedPatient(selectedItem);
                        setBookName("");
                        setBookPatientSearch("");
                      }
                    }}
                    sortedCallList={sortedCallList}
                    selectPatient={selectPatient}
                    setCallListBookPatient={setCallListBookPatient}
                    urgentTasks={urgentTasks}
                    openTasks={openTasks}
                    users={users}
                    unreadTaskIds={unreadTaskIds}
                    openTaskDrawer={openTaskDrawer}
                    schedulerName={card.name}
                    latestCallByPatient={latestCallByPatient}
                    onDisposition={() => setDispositionOpen(true)}
                    onSkip={() => {
                      if (!selectedItem) return;
                      const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
                      const next = sortedCallList[idx + 1] ?? sortedCallList[0];
                      if (next) selectPatient(next.item.patientId);
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden divide-y divide-slate-100/80 xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
                  <CurrentCallCard
                    item={selectedItem}
                    latestCall={selectedItem ? latestCallByPatient.get(selectedItem.patientId) : undefined}
                    schedulerName={card.name}
                    facilityName={card.facility}
                    lineageFromName={selectedLineageFromName}
                    lineageReason={selectedAssignment?.reason ?? null}
                    scriptOpen={scriptOpen}
                    setScriptOpen={setScriptOpen}
                    onExpand={() => openPlayfieldTab({ kind: "currentCall", patientId: selectedItem?.patientId, patientName: selectedItem?.patientName })}
                    onDisposition={() => setDispositionOpen(true)}
                    onBook={() => {
                      if (!selectedItem) return;
                      setBookingPanelOpen(true);
                      setCallListBookPatient(selectedItem);
                      setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
                      setCallListBookTime("");
                    }}
                    onSkip={() => {
                      if (!selectedItem) return;
                      const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
                      const next = sortedCallList[idx + 1] ?? sortedCallList[0];
                      if (next) selectPatient(next.item.patientId);
                    }}
                  />

                  {/* ── Mission Control bar (next/skip/disposition/book) ── */}
                  <MissionControlBar
                    selectedItem={selectedItem}
                    onDisposition={() => setDispositionOpen(true)}
                    onBook={() => {
                      if (!selectedItem) return;
                      setBookingPanelOpen(true);
                      setCallListBookPatient(selectedItem);
                      setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
                      setCallListBookTime("");
                    }}
                    onSkip={() => {
                      if (!selectedItem) return;
                      const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
                      const next = sortedCallList[idx + 1] ?? sortedCallList[0];
                      if (next) selectPatient(next.item.patientId);
                    }}
                  />
                </div>
              )}

            </div>
            {/* ── Floating Plexus AI bar (does not displace playfield content) ── */}
            <div className="absolute left-2 right-2 bottom-2 z-30 pointer-events-none" data-testid="portal-ai-bar-floating">
              <div className="pointer-events-auto rounded-2xl bg-white/90 backdrop-blur-xl border border-white/60 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
                <AiBar
                  selectedItem={selectedItem}
                  callListContext={sortedCallList.slice(0, 25).map(({ item, bucket }) => ({
                    name: item.patientName,
                    bucket,
                    qualifyingTests: item.qualifyingTests,
                  }))}
                />
              </div>
            </div>
          </div>

          {/* ─── RIGHT PANEL: Call list (full height) ────── */}
            <CallListPanel
              sortedCallList={sortedCallList}
              selectedId={selectedId}
              callsByPatient={callsByPatient}
              expandedTimeline={expandedTimeline}
              setExpandedTimeline={setExpandedTimeline}
              assignmentByPatient={assignmentByPatient}
              schedulerNameById={schedulerNameById}
              selectPatient={selectPatient}
              setCallListBookPatient={setCallListBookPatient}
            />
      </div>

      {/* Disposition slide-over */}
      <DispositionSheet
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        patientId={selectedItem?.patientId ?? null}
        patientName={selectedItem?.patientName ?? ""}
        schedulerUserId={currentUser?.id ?? null}
        priorAttempts={
          selectedItem ? (callsByPatient[selectedItem.patientId]?.length ?? 0) : 0
        }
      />

      {/* Shortcut help dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-indigo-600" /> Keyboard shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <ShortcutRow k="D" desc="Open disposition for selected patient" />
            <ShortcutRow k="N" desc="Move to next patient in queue" />
            <ShortcutRow k="S" desc="Open booking calendar for selected patient" />
            <ShortcutRow k="/" desc="Focus the search box" />
            <ShortcutRow k="?" desc="Show this help" />
          </div>
        </DialogContent>
      </Dialog>

      <SlotBookingDialog
          bookSlot={bookSlot}
          setBookSlot={setBookSlot}
          bookLinkedPatient={bookLinkedPatient}
          setBookLinkedPatient={setBookLinkedPatient}
          bookPatientSearch={bookPatientSearch}
          setBookPatientSearch={setBookPatientSearch}
          bookPatientResults={bookPatientResults}
          bookName={bookName}
          setBookName={setBookName}
          effectiveBookName={effectiveBookName}
          scheduledCallListNames={scheduledCallListNames}
          facility={facility}
          calYear={calYear}
          calMonth={calMonth}
          selectedDay={selectedDay}
          isPending={bookMutation.isPending}
          onConfirm={(args) => bookMutation.mutate(args)}
        />

        <CancelAppointmentDialog
          cancelTarget={cancelTarget}
          setCancelTarget={setCancelTarget}
          isPending={cancelMutation.isPending}
          onConfirm={(id) => cancelMutation.mutate(id)}
        />

        <PatientQuickBookDialog
          callListBookPatient={callListBookPatient}
          setCallListBookPatient={setCallListBookPatient}
          callListBookTestType={callListBookTestType}
          setCallListBookTestType={setCallListBookTestType}
          callListBookTime={callListBookTime}
          setCallListBookTime={setCallListBookTime}
          appointments={appointments || []}
          selectedDateStr={selectedDateStr}
          facility={facility}
          calYear={calYear}
          calMonth={calMonth}
          selectedDay={selectedDay}
          isPending={bookMutation.isPending}
          onConfirm={(args) => bookMutation.mutate(args)}
        />

        {/* Task drawer */}
      {taskDrawerPatientId !== null && currentUser && (
        <TaskDrawer
          patientScreeningId={taskDrawerPatientId}
          patientName={taskDrawerPatientName}
          tasks={taskDrawerTasks}
          users={users}
          currentUser={currentUser}
          onClose={() => setTaskDrawerPatientId(null)}
        />
      )}
      </div>
    </div>
  );
}
