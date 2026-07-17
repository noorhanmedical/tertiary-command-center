// Asana-style Plexus Tasks workspace. Reused by the full-page route
// (client/src/pages/plexus-tasks.tsx) and the Command Center playground.
//
// Layout (3 zones):
//   left   · views (My Work / Sent / Urgent) + project list + New Project
//   center · task list grouped by status for the active view/project
//   right  · task detail (edit fields, comments, activity history)
//
// Backed entirely by /api/plexus/* via the typed hooks in ./hooks. No mock data.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Inbox,
  Loader2,
  MessageSquare,
  Plus,
  SendHorizonal,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/hooks/api/keys";
import {
  PRIORITY_BADGE,
  PRIORITY_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  STATUS_BADGE,
  STATUS_COLUMNS,
  URGENCY_BADGE,
  URGENCY_OPTIONS,
  URGENCY_ORDER,
  type CreateTaskInput,
  type PatientSearchResult,
  type PlexusUser,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskUrgency,
} from "./types";
import {
  useCreateProject,
  useCreateTask,
  useDeleteProject,
  useDeleteTask,
  useMarkTaskRead,
  useMyWorkTasks,
  usePatientSearch,
  usePlexusUsers,
  useProjects,
  useSendMessage,
  useSentTasks,
  useTaskEvents,
  useTaskMessages,
  useTasksByProject,
  useUnreadPerTask,
  useUpdateTask,
  useUrgentTasks,
} from "./hooks";

type CurrentUser = { id: string; username: string; role: string } | null;

type ViewId =
  | { kind: "my-work" }
  | { kind: "sent" }
  | { kind: "urgent" }
  | { kind: "project"; projectId: number };

// ── Small helpers ───────────────────────────────────────────────────────────
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatRelative(dt: string | null | undefined): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function dueMeta(dueDate: string | null | undefined): { label: string; overdue: boolean } | null {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = dueDate < today;
  const same = dueDate === today;
  const label = same ? "Due today" : overdue ? `Overdue · ${dueDate}` : `Due ${dueDate}`;
  return { label, overdue: overdue };
}

function userName(users: PlexusUser[], id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return users.find((u) => u.id === id)?.username ?? id.slice(0, 8);
}

function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7283B0]/15 text-[10px] font-bold text-[#7283B0] ${className}`}
    >
      {initials(name)}
    </span>
  );
}

// ── Task composer (create + edit) ───────────────────────────────────────────
function TaskComposerDialog({
  open,
  onClose,
  users,
  projects,
  defaultProjectId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  users: PlexusUser[];
  projects: Project[];
  defaultProjectId: number | null;
  editing: Task | null;
}) {
  const { toast } = useToast();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [assignedToUserId, setAssignedToUserId] = useState<string>("unassigned");
  const [urgency, setUrgency] = useState<TaskUrgency>("none");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState<string>("");
  const [patient, setPatient] = useState<PatientSearchResult | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const patientResults = usePatientSearch(patientQuery);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setProjectId(editing.projectId != null ? String(editing.projectId) : "none");
      setAssignedToUserId(editing.assignedToUserId ?? "unassigned");
      setUrgency(editing.urgency);
      setPriority(editing.priority);
      setDueDate(editing.dueDate ?? "");
      setPatient(editing.patientScreeningId ? { id: editing.patientScreeningId, name: editing.patientName ?? "Linked patient", dob: null, insurance: null } : null);
    } else {
      setTitle("");
      setDescription("");
      setProjectId(defaultProjectId != null ? String(defaultProjectId) : "none");
      setAssignedToUserId("unassigned");
      setUrgency("none");
      setPriority("normal");
      setDueDate("");
      setPatient(null);
    }
    setPatientQuery("");
  }, [open, editing, defaultProjectId]);

  function submit() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const base = {
      title: title.trim(),
      description: description.trim() || undefined,
      projectId: projectId === "none" ? null : Number(projectId),
      assignedToUserId: assignedToUserId === "unassigned" ? null : assignedToUserId,
      urgency,
      priority,
      dueDate: dueDate || null,
    };
    if (editing) {
      updateTask.mutate(
        { id: editing.id, ...base, description: description.trim() || null },
        {
          onSuccess: () => {
            toast({ title: "Task updated" });
            onClose();
          },
          onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      const payload: CreateTaskInput = { ...base, patientScreeningId: patient?.id ?? null };
      createTask.mutate(payload, {
        onSuccess: () => {
          toast({ title: "Task created" });
          onClose();
        },
        onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
      });
    }
  }

  const busy = createTask.isPending || updateTask.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-task-composer">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              data-testid="input-task-title"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details…"
              rows={3}
              data-testid="input-task-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Assignee</label>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}>
                <SelectTrigger data-testid="select-task-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Project</label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger data-testid="select-task-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Urgency</label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as TaskUrgency)}>
                <SelectTrigger data-testid="select-task-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {URGENCY_OPTIONS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Due date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-task-due-date"
              />
            </div>
          </div>

          {!editing && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Link patient (optional)</label>
              {patient ? (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><UserIcon className="h-3.5 w-3.5 text-blue-500" />{patient.name}</span>
                  <button onClick={() => setPatient(null)} className="text-slate-400 hover:text-slate-700" data-testid="button-clear-patient"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Search patient by name…"
                    data-testid="input-patient-search"
                  />
                  {patientQuery.trim().length >= 2 && (patientResults.data?.length ?? 0) > 0 && (
                    <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {patientResults.data!.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { setPatient(p); setPatientQuery(""); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                          data-testid={`option-patient-${p.id}`}
                        >
                          <span>{p.name}</span>
                          {p.dob && <span className="text-xs text-slate-400">{p.dob}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-task">Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-save-task">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Project composer ────────────────────────────────────────────────────────
function ProjectComposerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const createProject = useCreateProject();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState("operational");

  useEffect(() => {
    if (open) { setTitle(""); setDescription(""); setProjectType("operational"); }
  }, [open]);

  function submit() {
    if (!title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    createProject.mutate(
      { title: title.trim(), description: description.trim() || undefined, projectType: projectType as any },
      {
        onSuccess: () => { toast({ title: "Project created" }); onClose(); },
        onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-project-composer">
        <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title" data-testid="input-project-title" autoFocus />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} data-testid="input-project-description" />
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger data-testid="select-project-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROJECT_TYPE_OPTIONS.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-project">Cancel</Button>
          <Button onClick={submit} disabled={createProject.isPending} data-testid="button-save-project">
            {createProject.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task row ────────────────────────────────────────────────────────────────
function TaskRow({
  task,
  users,
  unread,
  selected,
  onSelect,
  onToggleDone,
}: {
  task: Task;
  users: PlexusUser[];
  unread: number;
  selected: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
}) {
  const due = dueMeta(task.dueDate);
  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        selected ? "border-[#7283B0] bg-[#7283B0]/5" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
      data-testid={`task-row-${task.id}`}
    >
      <span
        onClick={(e) => { e.stopPropagation(); onToggleDone(); }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          task.status === "done" || task.status === "closed"
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-slate-300 text-transparent hover:border-emerald-400"
        }`}
        data-testid={`toggle-done-${task.id}`}
      >
        <CheckSquare className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm font-medium ${task.status === "done" || task.status === "closed" ? "text-slate-400 line-through" : "text-slate-800"}`}>
            {task.title}
          </span>
          {unread > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7283B0] px-1 text-[10px] font-bold text-white" data-testid={`unread-${task.id}`}>
              {unread}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {task.urgency !== "none" && (
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${URGENCY_BADGE[task.urgency]}`}>{task.urgency}</span>
          )}
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
          {due && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${due.overdue ? "text-red-600" : "text-amber-600"}`}>
              <Clock className="h-2.5 w-2.5" />{due.label}
            </span>
          )}
          {task.patientName && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500"><UserIcon className="h-2.5 w-2.5" />{task.patientName}</span>
          )}
        </div>
      </div>
      {task.assignedToUserId && (
        <Avatar name={userName(users, task.assignedToUserId)} />
      )}
    </button>
  );
}

// ── Task detail panel ───────────────────────────────────────────────────────
function TaskDetailPanel({
  task,
  users,
  projects,
  currentUser,
  onClose,
  onEdit,
}: {
  task: Task;
  users: PlexusUser[];
  projects: Project[];
  currentUser: CurrentUser;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const sendMessage = useSendMessage();
  const markRead = useMarkTaskRead();
  const messages = useTaskMessages(task.id);
  const events = useTaskEvents(task.id);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    markRead.mutate(task.id);
    setTab("comments");
    setDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function patch(p: Parameters<typeof updateTask.mutate>[0]) {
    updateTask.mutate(p, {
      onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
    });
  }

  function describeEvent(eventType: string, payload: Record<string, unknown> | null): string {
    const p = payload ?? {};
    switch (eventType) {
      case "created": return "created this task";
      case "status_changed": return `changed status ${p.from ?? "?"} → ${p.to ?? "?"}`;
      case "assignment_changed": return `reassigned to ${userName(users, (p.to as string) ?? null)}`;
      case "message_sent": return "added a comment";
      case "updated": return `updated ${Object.keys(p).join(", ") || "the task"}`;
      case "deleted": return "deleted this task";
      case "collaborator_added": return "added a collaborator";
      default: return eventType.replace(/_/g, " ");
    }
  }

  return (
    <aside className="flex h-full w-full flex-col bg-white" data-testid="task-detail-panel">
      <div className="flex items-start justify-between border-b border-slate-100 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900" data-testid="text-detail-title">{task.title}</h3>
          {task.description && <p className="mt-1 text-sm text-slate-500">{task.description}</p>}
        </div>
        <button onClick={onClose} className="ml-2 rounded-lg p-1 text-slate-400 hover:bg-slate-100" data-testid="button-close-detail"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
          <Select value={task.status} onValueChange={(v) => patch({ id: task.id, status: v as TaskStatus })}>
            <SelectTrigger className="h-8" data-testid="select-detail-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_COLUMNS.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Assignee</p>
          <Select value={task.assignedToUserId ?? "unassigned"} onValueChange={(v) => patch({ id: task.id, assignedToUserId: v === "unassigned" ? null : v })}>
            <SelectTrigger className="h-8" data-testid="select-detail-assignee"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Urgency</p>
          <Select value={task.urgency} onValueChange={(v) => patch({ id: task.id, urgency: v as TaskUrgency })}>
            <SelectTrigger className="h-8" data-testid="select-detail-urgency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {URGENCY_OPTIONS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Priority</p>
          <Select value={task.priority} onValueChange={(v) => patch({ id: task.id, priority: v as TaskPriority })}>
            <SelectTrigger className="h-8" data-testid="select-detail-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Due date</p>
          <Input
            type="date"
            className="h-8"
            value={task.dueDate ?? ""}
            onChange={(e) => patch({ id: task.id, dueDate: e.target.value || null })}
            data-testid="input-detail-due-date"
          />
        </div>
        {task.patientName && (
          <div className="col-span-2 flex items-center gap-1.5 text-xs text-blue-600">
            <UserIcon className="h-3.5 w-3.5" /> Linked patient: {task.patientName}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-2">
        <button onClick={() => setTab("comments")} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${tab === "comments" ? "border-[#7283B0] text-[#7283B0]" : "border-transparent text-slate-400 hover:text-slate-600"}`} data-testid="tab-comments">
          <MessageSquare className="h-3.5 w-3.5" /> Comments
        </button>
        <button onClick={() => setTab("activity")} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${tab === "activity" ? "border-[#7283B0] text-[#7283B0]" : "border-transparent text-slate-400 hover:text-slate-600"}`} data-testid="tab-activity">
          <Clock className="h-3.5 w-3.5" /> Activity
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "comments" ? (
          <div className="space-y-3">
            {messages.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {messages.data?.length === 0 && <p className="text-xs text-slate-400">No comments yet.</p>}
            {messages.data?.map((m) => (
              <div key={m.id} className="flex gap-2" data-testid={`comment-${m.id}`}>
                <Avatar name={userName(users, m.senderUserId)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-700">{userName(users, m.senderUserId)}</span>
                    <span className="text-[10px] text-slate-400">{formatRelative(m.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-600">{m.body}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {events.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {events.data?.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
            {events.data?.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 text-xs text-slate-500" data-testid={`event-${ev.id}`}>
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7283B0]" />
                <span><span className="font-semibold text-slate-700">{userName(users, ev.userId)}</span> {describeEvent(ev.eventType, ev.payload)} · {formatRelative(ev.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {tab === "comments" && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              className="resize-none text-sm"
              data-testid="input-comment"
            />
            <Button
              size="sm"
              disabled={!draft.trim() || sendMessage.isPending}
              onClick={() => sendMessage.mutate({ taskId: task.id, body: draft.trim() }, { onSuccess: () => setDraft(""), onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }) })}
              data-testid="button-send-comment"
            >
              {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 p-3">
        <Button variant="outline" size="sm" onClick={onEdit} data-testid="button-edit-task">Edit</Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => {
            if (!confirm("Delete this task?")) return;
            deleteTask.mutate(task.id, {
              onSuccess: () => { toast({ title: "Task deleted" }); onClose(); },
              onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
            });
          }}
          data-testid="button-delete-task"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </aside>
  );
}

// ── Grouped task list ───────────────────────────────────────────────────────
function GroupedTaskList({
  tasks,
  users,
  unreadMap,
  selectedId,
  onSelect,
  onToggleDone,
  loading,
}: {
  tasks: Task[];
  users: PlexusUser[];
  unreadMap: Map<number, number>;
  selectedId: number | null;
  onSelect: (t: Task) => void;
  onToggleDone: (t: Task) => void;
  loading: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const s of STATUS_COLUMNS) byStatus.set(s.id, []);
    for (const t of tasks) {
      const arr = byStatus.get(t.status) ?? [];
      arr.push(t);
      byStatus.set(t.status, arr);
    }
    for (const arr of byStatus.values()) {
      arr.sort((a, b) => (URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    }
    return byStatus;
  }, [tasks]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>;
  }
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <Inbox className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">No tasks here yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {STATUS_COLUMNS.map((col) => {
        const items = grouped.get(col.id) ?? [];
        if (items.length === 0) return null;
        const isCollapsed = collapsed[col.id];
        return (
          <div key={col.id}>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
              className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"
              data-testid={`group-header-${col.id}`}
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span className={`rounded-md border px-1.5 py-0.5 ${STATUS_BADGE[col.id]}`}>{col.label}</span>
              <span className="text-slate-400">{items.length}</span>
            </button>
            {!isCollapsed && (
              <div className="space-y-1.5">
                {items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    users={users}
                    unread={unreadMap.get(t.id) ?? 0}
                    selected={selectedId === t.id}
                    onSelect={() => onSelect(t)}
                    onToggleDone={() => onToggleDone(t)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main workspace ──────────────────────────────────────────────────────────
export function PlexusTasksWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [view, setView] = useState<ViewId>({ kind: "my-work" });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);

  const { data: currentUser } = useQuery<CurrentUser>({ queryKey: qk.auth.me(), staleTime: 5 * 60 * 1000 });
  const { data: users = [] } = usePlexusUsers();
  const { data: projects = [] } = useProjects();
  const deleteProject = useDeleteProject();
  const updateTask = useUpdateTask();

  const myWork = useMyWorkTasks();
  const sent = useSentTasks();
  const urgent = useUrgentTasks();
  const projectTasks = useTasksByProject(view.kind === "project" ? view.projectId : null);
  const { data: unreadPerTask = [] } = useUnreadPerTask();

  const unreadMap = useMemo(() => new Map(unreadPerTask.map((u) => [u.taskId, u.unreadCount])), [unreadPerTask]);

  const activeQuery =
    view.kind === "my-work" ? myWork
    : view.kind === "sent" ? sent
    : view.kind === "urgent" ? urgent
    : projectTasks;
  const tasks = activeQuery.data ?? [];

  // Keep the open detail panel in sync with refreshed list data.
  useEffect(() => {
    if (!selectedTask) return;
    const fresh = tasks.find((t) => t.id === selectedTask.id);
    if (fresh && fresh !== selectedTask) setSelectedTask(fresh);
  }, [tasks, selectedTask]);

  const VIEWS: { id: ViewId; label: string; icon: typeof CheckSquare }[] = [
    { id: { kind: "my-work" }, label: "My Work", icon: CheckSquare },
    { id: { kind: "sent" }, label: "Sent", icon: SendHorizonal },
    { id: { kind: "urgent" }, label: "Urgent", icon: AlertTriangle },
  ];

  function isActiveView(v: ViewId): boolean {
    if (v.kind === "project" && view.kind === "project") return v.projectId === view.projectId;
    return v.kind === view.kind;
  }

  function toggleDone(t: Task) {
    const next: TaskStatus = t.status === "done" || t.status === "closed" ? "open" : "done";
    updateTask.mutate({ id: t.id, status: next }, { onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }) });
  }

  const headerTitle =
    view.kind === "my-work" ? "My Work"
    : view.kind === "sent" ? "Sent"
    : view.kind === "urgent" ? "Urgent"
    : projects.find((p) => p.id === view.projectId)?.title ?? "Project";

  const activeProject = view.kind === "project" ? projects.find((p) => p.id === view.projectId) ?? null : null;
  const canDeleteProject = activeProject && currentUser && activeProject.createdByUserId === currentUser.id;

  return (
    <div className={`flex min-h-0 w-full bg-slate-50 ${embedded ? "h-full rounded-2xl border border-slate-200 overflow-hidden" : "h-full"}`} data-testid="plexus-tasks-workspace">
      {/* Left rail */}
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-slate-200/80 bg-white p-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-[#7283B0]/10 p-2 text-[#7283B0]"><CheckSquare className="h-5 w-5" /></div>
          <h1 className="text-base font-bold text-slate-900">Plexus Tasks</h1>
        </div>

        <Button
          className="w-full justify-start gap-2 rounded-xl bg-[#061b2d] text-white hover:bg-[#0c2b45]"
          onClick={() => { setEditingTask(null); setComposerOpen(true); }}
          data-testid="button-new-task"
        >
          <Plus className="h-4 w-4" /> New Task
        </Button>

        <nav className="space-y-0.5">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => { setView(id); setSelectedTask(null); }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${isActiveView(id) ? "bg-[#7283B0]/10 text-[#7283B0]" : "text-slate-600 hover:bg-slate-100"}`}
              data-testid={`nav-view-${id.kind}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Projects</span>
            <button onClick={() => setProjectComposerOpen(true)} className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="button-new-project" title="New project">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            {projects.length === 0 && <p className="px-3 py-1 text-xs text-slate-400">No projects yet</p>}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { setView({ kind: "project", projectId: p.id }); setSelectedTask(null); }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm transition ${view.kind === "project" && view.projectId === p.id ? "bg-[#7283B0]/10 text-[#7283B0]" : "text-slate-600 hover:bg-slate-100"}`}
                data-testid={`nav-project-${p.id}`}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Center */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900" data-testid="text-view-title">{headerTitle}</h2>
            {activeProject?.description && <p className="text-xs text-slate-500">{activeProject.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {canDeleteProject && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50"
                onClick={() => {
                  if (!confirm("Delete this project? Tasks will be unlinked.")) return;
                  deleteProject.mutate(view.kind === "project" ? view.projectId : 0, {
                    onSuccess: () => { toast({ title: "Project deleted" }); setView({ kind: "my-work" }); },
                    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
                  });
                }}
                data-testid="button-delete-project"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete project
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl border-[#7283B0]/30 text-[#7283B0] hover:bg-[#7283B0]/10"
              onClick={() => { setEditingTask(null); setComposerOpen(true); }}
              data-testid="button-new-task-header"
            >
              <Plus className="mr-1 h-4 w-4" /> New Task
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <GroupedTaskList
            tasks={tasks}
            users={users}
            unreadMap={unreadMap}
            selectedId={selectedTask?.id ?? null}
            onSelect={setSelectedTask}
            onToggleDone={toggleDone}
            loading={activeQuery.isLoading}
          />
        </div>
      </main>

      {/* Right detail */}
      {selectedTask && (
        <div className="w-[380px] shrink-0 border-l border-slate-200/80">
          <TaskDetailPanel
            task={selectedTask}
            users={users}
            projects={projects}
            currentUser={currentUser ?? null}
            onClose={() => setSelectedTask(null)}
            onEdit={() => { setEditingTask(selectedTask); setComposerOpen(true); }}
          />
        </div>
      )}

      <TaskComposerDialog
        open={composerOpen}
        onClose={() => { setComposerOpen(false); setEditingTask(null); }}
        users={users}
        projects={projects}
        defaultProjectId={view.kind === "project" ? view.projectId : null}
        editing={editingTask}
      />
      <ProjectComposerDialog open={projectComposerOpen} onClose={() => setProjectComposerOpen(false)} />
    </div>
  );
}

export default PlexusTasksWorkspace;
