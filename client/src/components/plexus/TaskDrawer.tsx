import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare,
  Phone,
  PhoneMissed,
  PhoneCall,
  CalendarCheck,
  XCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  User,
  Plus,
  Send,
  Check,
  ChevronDown,
} from "lucide-react";
import type { AuthUser } from "@/App";
import type { PlexusTaskSummary, UserEntry } from "./SchedulerIcon";
import { getInitials, colorForUserId } from "./SchedulerIcon";

type PlexusMessage = {
  id: number;
  taskId: number;
  senderUserId: string | null;
  body: string;
  createdAt: string;
};

type PlexusEvent = {
  id: number;
  taskId: number | null;
  projectId: number | null;
  userId: string | null;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type TimelineItem = {
  id: string;
  kind: "event" | "message";
  userId: string | null;
  timestamp: string;
  eventType?: string;
  payload?: Record<string, unknown> | null;
  body?: string;
};

const URGENCY_OPTIONS = [
  { value: "EOD", label: "EOD", color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { value: "within 3 hours", label: "3 hrs", color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { value: "within 1 hour", label: "1 hr", color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
];

const CALL_OUTCOMES = [
  { value: "no_answer", label: "No Answer", Icon: PhoneMissed, color: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100" },
  { value: "callback", label: "Callback", Icon: PhoneCall, color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { value: "scheduled", label: "Scheduled", Icon: CalendarCheck, color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" },
  { value: "declined", label: "Declined", Icon: XCircle, color: "bg-red-50 text-red-600 border-red-200 hover:bg-red-100" },
] as const;

function UrgentCallForm({
  urgentTitle,
  urgentUrgency,
  urgentMessage,
  isPending,
  onChangeTitle,
  onChangeUrgency,
  onChangeMessage,
  onCancel,
  onSubmit,
}: {
  urgentTitle: string;
  urgentUrgency: string;
  urgentMessage: string;
  isPending: boolean;
  onChangeTitle: (v: string) => void;
  onChangeUrgency: (v: string) => void;
  onChangeMessage: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50/50 p-3">
      <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        Request Urgent Call
      </p>
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Title</Label>
        <Input
          value={urgentTitle}
          onChange={(e) => onChangeTitle(e.target.value)}
          placeholder="e.g. Patient requesting call back ASAP"
          className="rounded-xl text-sm"
          data-testid="drawer-urgent-title"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Urgency</Label>
        <div className="flex gap-1.5">
          {URGENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChangeUrgency(opt.value)}
              className={`flex-1 rounded-xl border px-2 py-1.5 text-xs font-medium transition ${opt.color} ${urgentUrgency === opt.value ? "ring-2 ring-offset-1 ring-orange-400" : ""}`}
              data-testid={`drawer-urgent-urgency-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Message <span className="text-red-500">*</span></Label>
        <Textarea
          value={urgentMessage}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="Describe the situation..."
          className="min-h-[60px] resize-none rounded-xl text-sm"
          data-testid="drawer-urgent-message"
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-xl"
          onClick={onCancel}
          data-testid="drawer-urgent-cancel"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1 rounded-xl bg-orange-600 hover:bg-orange-700"
          disabled={!urgentMessage.trim() || !urgentTitle.trim() || isPending}
          onClick={onSubmit}
          data-testid="drawer-urgent-submit"
        >
          {isPending ? "Sending..." : "Send Request"}
        </Button>
      </div>
    </div>
  );
}

function eventLabel(eventType: string, payload: Record<string, unknown> | null | undefined): string {
  switch (eventType) {
    case "created": return "Task created";
    case "updated": return "Task updated";
    case "deleted": return "Task deleted";
    case "status_changed": return `Status → ${payload?.to ?? "unknown"}`;
    case "assignment_changed": return payload?.to ? `Assigned to user` : "Assignment removed";
    case "message_sent": return "Message sent";
    case "collaborator_added": return "Joined as collaborator";
    case "collaborator_role_changed": return "Collaborator role changed";
    case "call_logged": {
      const outcome = String(payload?.outcome ?? "");
      const labels: Record<string, string> = {
        no_answer: "Called — No Answer",
        callback: "Called — Callback Requested",
        scheduled: "Called — Scheduled",
        declined: "Called — Declined",
      };
      return labels[outcome] ?? `Called — ${outcome}`;
    }
    default: return eventType.replace(/_/g, " ");
  }
}

function isCallOutcomeEvent(eventType: string) {
  return eventType === "call_logged";
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: "bg-slate-100 text-slate-700",
    in_progress: "bg-blue-100 text-blue-700",
    done: "bg-green-100 text-green-700",
    closed: "bg-slate-200 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-600";
}

function urgencyBadge(urgency: string) {
  if (urgency === "none" || !urgency) return null;
  const map: Record<string, string> = {
    EOD: "bg-amber-100 text-amber-700",
    "within 3 hours": "bg-orange-100 text-orange-700",
    "within 1 hour": "bg-red-100 text-red-700",
  };
  return map[urgency] ?? "bg-rose-100 text-rose-700";
}

export function TaskDrawer({
  patientScreeningId,
  patientName,
  tasks,
  currentUser,
  users,
  onClose,
}: {
  patientScreeningId: number;
  patientName?: string;
  tasks: PlexusTaskSummary[];
  currentUser: AuthUser;
  users: UserEntry[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTaskId, setActiveTaskId] = useState<number | null>(tasks[0]?.id ?? null);
  const [messageBody, setMessageBody] = useState("");
  const [showUrgentForm, setShowUrgentForm] = useState(false);
  const [urgentUrgency, setUrgentUrgency] = useState<string>("EOD");
  const [urgentMessage, setUrgentMessage] = useState("");
  const [urgentTitle, setUrgentTitle] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const userMap = new Map<string, UserEntry>(users.map((u) => [u.id, u]));

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? tasks[0] ?? null;

  const { data: messages = [] } = useQuery<PlexusMessage[]>({
    queryKey: ["/api/plexus/tasks", activeTask?.id, "messages"],
    queryFn: async () => {
      if (!activeTask) return [];
      const res = await fetch(`/api/plexus/tasks/${activeTask.id}/messages`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeTask,
    refetchInterval: 30_000,
  });

  const { data: events = [] } = useQuery<PlexusEvent[]>({
    queryKey: ["/api/plexus/tasks", activeTask?.id, "events"],
    queryFn: async () => {
      if (!activeTask) return [];
      const res = await fetch(`/api/plexus/tasks/${activeTask.id}/events`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeTask,
  });

  const markReadMutation = useMutation({
    mutationFn: (taskId: number) => apiRequest("POST", `/api/plexus/tasks/${taskId}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/unread-per-task"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/unread-count"] });
    },
  });

  useEffect(() => {
    if (activeTask?.id) {
      markReadMutation.mutate(activeTask.id);
    }
  }, [activeTask?.id]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, events.length]);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ taskId, body }: { taskId: number; body: string }) => {
      const res = await apiRequest("POST", `/api/plexus/tasks/${taskId}/messages`, { body });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed to send"); }
      return res.json();
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", taskId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", taskId, "events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/unread-per-task"] });
      setMessageBody("");
    },
    onError: (e: Error) => toast({ title: "Failed to send message", description: e.message, variant: "destructive" }),
  });

  const createUrgentTaskMutation = useMutation({
    mutationFn: async ({ title, urgency, message }: { title: string; urgency: string; message: string }) => {
      const res = await apiRequest("POST", "/api/plexus/tasks", {
        title,
        taskType: "urgent_call",
        urgency,
        patientScreeningId,
        description: message,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed to create task"); }
      return res.json();
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", "patient", patientScreeningId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/urgent"] });
      toast({ title: "Urgent call requested", description: "The scheduler team has been notified." });
      setShowUrgentForm(false);
      setUrgentMessage("");
      setUrgentTitle("");
      setActiveTaskId(task.id);
    },
    onError: (e: Error) => toast({ title: "Failed to create request", description: e.message, variant: "destructive" }),
  });

  const assignSchedulerMutation = useMutation({
    mutationFn: async ({ taskId, assignedToUserId }: { taskId: number; assignedToUserId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/plexus/tasks/${taskId}`, { assignedToUserId });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed to assign"); }
      return res.json();
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", taskId, "events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", "patient", patientScreeningId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/urgent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Scheduler updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update scheduler", description: e.message, variant: "destructive" }),
  });

  const [assignOpen, setAssignOpen] = useState(false);
  const assignableSchedulers = [...users]
    .filter((u) => u.active !== false && (u.role === "scheduler" || u.role === "admin"))
    .sort((a, b) => a.username.localeCompare(b.username));

  const logCallOutcomeMutation = useMutation({
    mutationFn: async ({ taskId, outcome, notes }: { taskId: number; outcome: string; notes: string }) => {
      const appointmentStatus = outcome === "scheduled" ? "scheduled" : outcome;
      const res = await apiRequest("POST", `/api/plexus/tasks/${taskId}/call-outcome`, { outcome, notes, appointmentStatus });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed to log outcome"); }
      return res.json();
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", taskId, "events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks", "patient", patientScreeningId] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients", patientScreeningId] });
      toast({ title: "Call outcome logged" });
      setSelectedOutcome(null);
      setOutcomeNotes("");
    },
    onError: (e: Error) => toast({ title: "Failed to log outcome", description: e.message, variant: "destructive" }),
  });

  const { data: patientInfo } = useQuery<{ appointmentStatus?: string; name?: string } | null>({
    queryKey: ["/api/patients", patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientScreeningId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!patientScreeningId,
    staleTime: 60_000,
  });

  const isScheduler = currentUser?.role === "scheduler" || currentUser?.role === "admin";
  const canAssign = currentUser?.role === "admin" || currentUser?.role === "clinician" || currentUser?.role === "scheduler";

  const timeline: TimelineItem[] = [
    ...events.map((e) => ({
      id: `event-${e.id}`,
      kind: "event" as const,
      userId: e.userId,
      timestamp: e.createdAt,
      eventType: e.eventType,
      payload: e.payload as Record<string, unknown> | null,
    })),
    ...messages.map((m) => ({
      id: `msg-${m.id}`,
      kind: "message" as const,
      userId: m.senderUserId,
      timestamp: m.createdAt,
      body: m.body,
    })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  function formatTs(ts: string) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const assignedUser = activeTask?.assignedToUserId ? (userMap.get(activeTask.assignedToUserId) ?? null) : null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-[440px] max-w-full flex-col gap-0 p-0 sm:max-w-[440px]"
        data-testid="task-drawer"
      >
        {/* Header */}
        <SheetHeader className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base font-semibold text-slate-900 truncate">
                {patientName ?? "Patient"}
              </SheetTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {activeTask && canAssign ? (
                  <Popover open={assignOpen} onOpenChange={setAssignOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                        disabled={assignSchedulerMutation.isPending}
                        data-testid="drawer-assign-scheduler-trigger"
                      >
                        {assignedUser ? (
                          <>
                            <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ${colorForUserId(assignedUser.id)}`}>
                              {getInitials(assignedUser.username)}
                            </div>
                            <span>{assignedUser.username}</span>
                          </>
                        ) : (
                          <>
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] text-slate-500">?</div>
                            <span className="text-slate-500">Assign scheduler</span>
                          </>
                        )}
                        <ChevronDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-1" data-testid="drawer-assign-scheduler-popover">
                      <div className="max-h-64 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => {
                            if (activeTask && activeTask.assignedToUserId) {
                              assignSchedulerMutation.mutate({ taskId: activeTask.id, assignedToUserId: null });
                            }
                            setAssignOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                          data-testid="drawer-assign-scheduler-unassign"
                        >
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] text-slate-500">?</div>
                          <span className="flex-1">Unassigned</span>
                          {!activeTask?.assignedToUserId && <Check className="h-3.5 w-3.5 text-blue-500" />}
                        </button>
                        {assignableSchedulers.length === 0 ? (
                          <p className="px-2 py-1.5 text-xs text-slate-400">No schedulers available</p>
                        ) : assignableSchedulers.map((u) => {
                          const selected = u.id === activeTask?.assignedToUserId;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                if (activeTask && !selected) {
                                  assignSchedulerMutation.mutate({ taskId: activeTask.id, assignedToUserId: u.id });
                                }
                                setAssignOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                              data-testid={`drawer-assign-scheduler-option-${u.id}`}
                            >
                              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ${colorForUserId(u.id)}`}>
                                {getInitials(u.username)}
                              </div>
                              <span className="flex-1 truncate">{u.username}</span>
                              {u.role === "admin" && <span className="text-[9px] text-slate-400">admin</span>}
                              {selected && <Check className="h-3.5 w-3.5 text-blue-500" />}
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : assignedUser ? (
                  <div className="flex items-center gap-1.5">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ${colorForUserId(assignedUser.id)}`}>
                      {getInitials(assignedUser.username)}
                    </div>
                    <span className="text-xs text-slate-600">{assignedUser.username}</span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">No scheduler assigned</span>
                )}
                {patientInfo?.appointmentStatus && (
                  <Badge
                    className={`rounded-full text-[10px] px-1.5 py-0 ${
                      patientInfo.appointmentStatus === "scheduled"
                        ? "bg-green-100 text-green-700"
                        : patientInfo.appointmentStatus === "declined"
                        ? "bg-red-100 text-red-700"
                        : patientInfo.appointmentStatus === "no_answer"
                        ? "bg-slate-100 text-slate-600"
                        : patientInfo.appointmentStatus === "callback"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                    data-testid="drawer-appointment-status"
                  >
                    {patientInfo.appointmentStatus.replace(/_/g, " ")}
                  </Badge>
                )}
                {activeTask && (
                  <>
                    <Badge className={`rounded-full text-[10px] px-1.5 py-0 ${statusBadge(activeTask.status)}`}>
                      {activeTask.status.replace("_", " ")}
                    </Badge>
                    {urgencyBadge(activeTask.urgency) && (
                      <Badge className={`rounded-full text-[10px] px-1.5 py-0 flex items-center gap-0.5 ${urgencyBadge(activeTask.urgency)}`}>
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {activeTask.urgency}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {tasks.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTaskId(t.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition ${
                    activeTaskId === t.id
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-200"
                  }`}
                  data-testid={`drawer-task-tab-${t.id}`}
                >
                  {t.taskType === "urgent_call" ? "⚡ Urgent Call" : t.title}
                </button>
              ))}
            </div>
          )}
        </SheetHeader>

        {!activeTask ? (
          <div className="flex flex-1 flex-col px-5 py-6">
            {!showUrgentForm ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <MessageSquare className="h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-500">No task thread yet for this patient.</p>
                <Button
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => setShowUrgentForm(true)}
                  data-testid="drawer-request-urgent-call"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Request Urgent Call
                </Button>
              </div>
            ) : (
              <UrgentCallForm
                urgentTitle={urgentTitle}
                urgentUrgency={urgentUrgency}
                urgentMessage={urgentMessage}
                isPending={createUrgentTaskMutation.isPending}
                onChangeTitle={setUrgentTitle}
                onChangeUrgency={setUrgentUrgency}
                onChangeMessage={setUrgentMessage}
                onCancel={() => { setShowUrgentForm(false); setUrgentMessage(""); setUrgentTitle(""); }}
                onSubmit={() => createUrgentTaskMutation.mutate({ title: urgentTitle.trim(), urgency: urgentUrgency, message: urgentMessage.trim() })}
              />
            )}
          </div>
        ) : (
          <>
            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {timeline.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-8">No activity yet.</p>
              ) : timeline.map((item) => {
                const actor = item.userId ? (userMap.get(item.userId) ?? null) : null;
                const actorLabel = actor?.username ?? (item.userId ? "User" : "System");
                if (item.kind === "message") {
                  const isMe = item.userId === currentUser?.id;
                  return (
                    <div
                      key={item.id}
                      className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                      data-testid={`timeline-message-${item.id}`}
                    >
                      <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${actor ? colorForUserId(actor.id) : "bg-slate-400"}`}>
                        {actor ? getInitials(actor.username) : <User className="h-3 w-3" />}
                      </div>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${isMe ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                        <p className="whitespace-pre-wrap break-words">{item.body}</p>
                        <p className={`mt-1 text-[10px] ${isMe ? "text-blue-200" : "text-slate-400"}`}>{actorLabel} · {formatTs(item.timestamp)}</p>
                      </div>
                    </div>
                  );
                }
                const isCallOutcome = isCallOutcomeEvent(item.eventType ?? "");
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${isCallOutcome ? "border-l-2 border-blue-400 bg-blue-50" : "bg-slate-50"}`}
                    data-testid={`timeline-event-${item.id}`}
                  >
                    {isCallOutcome ? (
                      <Phone className="mt-0.5 h-3 w-3 flex-shrink-0 text-blue-500" />
                    ) : item.eventType === "created" ? (
                      <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                    ) : (
                      <Clock className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className={`font-medium ${isCallOutcome ? "text-blue-700" : "text-slate-700"}`}>
                        {eventLabel(item.eventType ?? "", item.payload ?? null)}
                      </span>
                      {isCallOutcome && Boolean(item.payload?.notes) && (
                        <p className="mt-0.5 text-slate-600">{String(item.payload!.notes)}</p>
                      )}
                      <p className="mt-0.5 text-slate-400">{actorLabel} · {formatTs(item.timestamp)}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={timelineEndRef} />
            </div>

            {/* Action footer */}
            <div className="border-t border-slate-100 px-5 py-4 space-y-4">
              {/* Message input (for all users) */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Send message
                </Label>
                <div className="flex gap-2">
                  <Textarea
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    placeholder="Type a message..."
                    className="min-h-[60px] resize-none rounded-2xl border-slate-200 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (messageBody.trim() && activeTask) {
                          sendMessageMutation.mutate({ taskId: activeTask.id, body: messageBody.trim() });
                        }
                      }
                    }}
                    data-testid="drawer-message-input"
                  />
                  <Button
                    size="icon"
                    className="h-[60px] w-10 flex-shrink-0 rounded-2xl"
                    disabled={!messageBody.trim() || sendMessageMutation.isPending}
                    onClick={() => {
                      if (messageBody.trim() && activeTask) {
                        sendMessageMutation.mutate({ taskId: activeTask.id, body: messageBody.trim() });
                      }
                    }}
                    data-testid="drawer-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Scheduler-only: Log call outcome */}
              {isScheduler && activeTask && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    Log call outcome
                  </Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {CALL_OUTCOMES.map(({ value, label, Icon, color }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSelectedOutcome(selectedOutcome === value ? null : value)}
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[10px] font-medium transition ${color} ${selectedOutcome === value ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}
                        data-testid={`drawer-outcome-${value}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                  {selectedOutcome && (
                    <div className="space-y-2">
                      <Textarea
                        value={outcomeNotes}
                        onChange={(e) => setOutcomeNotes(e.target.value)}
                        placeholder="Notes (optional)..."
                        className="min-h-[52px] resize-none rounded-2xl border-slate-200 text-sm"
                        data-testid="drawer-outcome-notes"
                      />
                      <Button
                        size="sm"
                        className="w-full rounded-2xl"
                        disabled={logCallOutcomeMutation.isPending}
                        onClick={() => {
                          if (selectedOutcome && activeTask) {
                            logCallOutcomeMutation.mutate({ taskId: activeTask.id, outcome: selectedOutcome, notes: outcomeNotes });
                          }
                        }}
                        data-testid="drawer-submit-outcome"
                      >
                        {logCallOutcomeMutation.isPending ? "Saving..." : "Save Outcome"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Tech: Request urgent call */}
              {!isScheduler && (
                <div>
                  {!showUrgentForm ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-2xl border-orange-200 text-orange-700 hover:bg-orange-50"
                      onClick={() => setShowUrgentForm(true)}
                      data-testid="drawer-request-urgent-call"
                    >
                      <AlertTriangle className="mr-1.5 h-4 w-4" />
                      Request Urgent Call
                    </Button>
                  ) : (
                    <UrgentCallForm
                      urgentTitle={urgentTitle}
                      urgentUrgency={urgentUrgency}
                      urgentMessage={urgentMessage}
                      isPending={createUrgentTaskMutation.isPending}
                      onChangeTitle={setUrgentTitle}
                      onChangeUrgency={setUrgentUrgency}
                      onChangeMessage={setUrgentMessage}
                      onCancel={() => { setShowUrgentForm(false); setUrgentMessage(""); setUrgentTitle(""); }}
                      onSubmit={() => createUrgentTaskMutation.mutate({ title: urgentTitle.trim(), urgency: urgentUrgency, message: urgentMessage.trim() })}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
