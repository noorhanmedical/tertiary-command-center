import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  Plus,
  FolderOpen,
  SendHorizonal,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  User,
  Clock,
  Flame,
  AlertCircle,
  Circle,
  CheckCircle2,
  X,
  Users,
  Check,
  Inbox,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CreateTaskModal } from "@/components/plexus/CreateTaskModal";
import { TaskDrawer } from "@/components/plexus/TaskDrawer";
import type { PlexusTaskSummary, UserEntry } from "@/components/plexus/SchedulerIcon";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PlexusProject } from "@shared/schema";
import type { AuthUser } from "@/App";
import { PageHeader } from "@/components/PageHeader";

type PlexusTask = import("@shared/schema").PlexusTask & {
  patientName?: string | null;
  lastActivityAt?: Date | string | null;
};

type View = "my-work" | "projects" | "sent";

const URGENCY_ORDER: Record<string, number> = {
  "within 1 hour": 0,
  "within 3 hours": 1,
  EOD: 2,
  none: 3,
};

const URGENCY_COLORS: Record<string, string> = {
  "within 1 hour": "bg-red-100 text-red-700 border-red-200",
  "within 3 hours": "bg-orange-100 text-orange-700 border-orange-200",
  EOD: "bg-amber-100 text-amber-700 border-amber-200",
  none: "bg-slate-100 text-slate-500 border-slate-200",
};

const STATUS_ICONS: Record<string, JSX.Element> = {
  open: <Circle className="h-4 w-4 text-slate-400" />,
  in_progress: <Clock className="h-4 w-4 text-blue-500" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  closed: <X className="h-4 w-4 text-slate-300" />,
};

function statusIcon(status: string) {
  return STATUS_ICONS[status] ?? STATUS_ICONS["open"];
}

type UnreadEntry = { taskId: number; unreadCount: number };

function TaskRow({
  task,
  onStatusChange,
  onOpen,
  unreadCount = 0,
  userMap = new Map(),
}: {
  task: PlexusTask;
  onStatusChange: (id: number, status: string) => void;
  onOpen: (task: PlexusTask) => void;
  unreadCount?: number;
  userMap?: Map<string, string>;
}) {
  const urgencyClass = URGENCY_COLORS[task.urgency] ?? URGENCY_COLORS["none"];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div
        className="flex cursor-pointer items-start gap-3 p-4"
        onClick={() => onOpen(task)}
        data-testid={`task-row-${task.id}`}
      >
        <button
          className="mt-0.5 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            const next = task.status === "done" ? "open" : "done";
            onStatusChange(task.id, next);
          }}
          data-testid={`button-task-status-${task.id}`}
          title={task.status === "done" ? "Reopen" : "Mark done"}
        >
          {statusIcon(task.status)}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-sm font-medium text-slate-800 ${task.status === "done" ? "line-through text-slate-400" : ""}`}
            >
              {task.title}
            </span>
            {task.urgency !== "none" && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${urgencyClass}`}>
                <Flame className="h-2.5 w-2.5" />
                {task.urgency}
              </span>
            )}
            {task.priority === "high" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                <AlertCircle className="h-2.5 w-2.5" />
                High
              </span>
            )}
            {unreadCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700"
                data-testid={`unread-badge-${task.id}`}
              >
                <MessageSquare className="h-2.5 w-2.5" />
                {unreadCount} new
              </span>
            )}
          </div>
          {task.description && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{task.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {task.dueDate && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Due {task.dueDate}
              </span>
            )}
            {task.assignedToUserId && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {userMap.get(task.assignedToUserId) ?? task.assignedToUserId.slice(0, 8)}
              </span>
            )}
            {task.patientName && (
              <span className="flex items-center gap-1 text-blue-500">
                <User className="h-3 w-3" />
                {task.patientName}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </div>
    </div>
  );
}

function useUnreadPerTask() {
  return useQuery<UnreadEntry[]>({
    queryKey: ["/api/plexus/tasks/unread-per-task"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

function MyWorkView({ onOpen }: { onOpen: (task: PlexusTask) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/my-work"],
  });
  const { data: projects = [] } = useQuery<PlexusProject[]>({
    queryKey: ["/api/plexus/projects"],
  });
  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ["/api/plexus/users"],
  });
  const { data: unreadEntries = [] } = useUnreadPerTask();
  const msgMap = new Map(unreadEntries.map((m) => [m.taskId, m.unreadCount]));
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/plexus/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/my-work"] }),
    onError: (e: Error) => toast({ title: "Failed to update task", description: e.message, variant: "destructive" }),
  });

  const sorted = [...tasks].sort(
    (a, b) => (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3),
  );

  const byProject = sorted.reduce<Record<string, PlexusTask[]>>((acc, t) => {
    const key = t.projectId ? String(t.projectId) : "standalone";
    acc[key] = [...(acc[key] ?? []), t];
    return acc;
  }, {});

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center">
        <Inbox className="h-10 w-10 text-slate-300" />
        <div>
          <p className="text-sm font-medium text-slate-600">No tasks assigned to you</p>
          <p className="mt-1 text-xs text-slate-400">Tasks assigned to you will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(byProject).map(([key, groupTasks]) => {
        const project = key !== "standalone" ? projectMap.get(parseInt(key)) : null;
        return (
          <div key={key}>
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-700">
                {project ? project.title : "Standalone Tasks"}
              </h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {groupTasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {groupTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onStatusChange={(id, status) => updateMutation.mutate({ id, status })}
                  onOpen={onOpen}
                  unreadCount={msgMap.get(t.id) ?? 0}
                  userMap={userMap}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ProjectSummary = { taskCount: number; counts: Record<string, number> };

function ProjectsView({ onCreateTask, onOpen }: { onCreateTask: (projectId: number) => void; onOpen: (task: PlexusTask) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: projects = [], isLoading } = useQuery<PlexusProject[]>({
    queryKey: ["/api/plexus/projects"],
  });
  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ["/api/plexus/users"],
  });
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  const [expandedProject, setExpandedProject] = useState<number | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);

  const createProjectMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/plexus/projects", { title: newProjectTitle.trim(), projectType: "operational" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plexus/projects"] });
      setNewProjectTitle("");
      setShowNewProject(false);
      toast({ title: "Project created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create project", description: e.message, variant: "destructive" }),
  });

  const { data: projectTasks = [] } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/by-project", expandedProject],
    queryFn: async () => {
      if (!expandedProject) return [];
      const res = await fetch(`/api/plexus/tasks/by-project/${expandedProject}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!expandedProject,
  });

  const { data: summaries = {} } = useQuery<Record<number, ProjectSummary>>({
    queryKey: ["/api/plexus/projects/summaries", projects.map((p) => p.id).join(",")],
    queryFn: async () => {
      if (projects.length === 0) return {};
      const results: Record<number, ProjectSummary> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            const res = await fetch(`/api/plexus/projects/${p.id}/summary`, { credentials: "include" });
            results[p.id] = await res.json();
          } catch {}
        })
      );
      return results;
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  const { data: unreadEntries = [] } = useUnreadPerTask();
  const msgMap = new Map(unreadEntries.map((m) => [m.taskId, m.unreadCount]));

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/plexus/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/by-project", expandedProject] }),
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-3">
      {/* New Project inline form */}
      <div className="flex items-center justify-end mb-1">
        {showNewProject ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Project name…"
              value={newProjectTitle}
              onChange={(e) => setNewProjectTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newProjectTitle.trim()) createProjectMutation.mutate();
                if (e.key === "Escape") setShowNewProject(false);
              }}
              data-testid="input-new-project-title"
            />
            <Button
              size="sm"
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
              onClick={() => newProjectTitle.trim() && createProjectMutation.mutate()}
              disabled={createProjectMutation.isPending || !newProjectTitle.trim()}
              data-testid="button-create-project-confirm"
            >
              Create
            </Button>
            <Button size="sm" variant="ghost" className="rounded-xl text-xs" onClick={() => setShowNewProject(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs"
            onClick={() => setShowNewProject(true)}
            data-testid="button-new-project"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Project
          </Button>
        )}
      </div>

      {projects.length === 0 && !showNewProject && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center">
          <FolderOpen className="h-10 w-10 text-slate-300" />
          <div>
            <p className="text-sm font-medium text-slate-600">No projects yet</p>
            <p className="mt-1 text-xs text-slate-400">Click &quot;New Project&quot; above to create your first project</p>
          </div>
        </div>
      )}
      {projects.map((project) => {
        const isOpen = expandedProject === project.id;
        const summary = summaries[project.id];
        const statusCounts = isOpen
          ? projectTasks.reduce<Record<string, number>>((acc, t) => {
              if (expandedProject === project.id) { acc[t.status] = (acc[t.status] ?? 0) + 1; }
              return acc;
            }, {})
          : (summary?.counts ?? {});
        return (
          <Card key={project.id} className="rounded-2xl border border-white/60 bg-white/80 shadow-sm">
            <div
              className="flex cursor-pointer items-center gap-3 p-4"
              onClick={() => setExpandedProject(isOpen ? null : project.id)}
              data-testid={`project-row-${project.id}`}
            >
              <FolderOpen className={`h-5 w-5 shrink-0 ${isOpen ? "text-blue-500" : "text-slate-400"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{project.title}</span>
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    {project.projectType}
                  </Badge>
                  {project.facility && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">
                      {project.facility}
                    </Badge>
                  )}
                  {summary !== undefined && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {summary.taskCount} task{summary.taskCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {project.status === "archived" && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">archived</Badge>
                  )}
                </div>
                {Object.keys(statusCounts).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {Object.entries(statusCounts).map(([status, count]) => (
                      <span key={status} className="text-[10px] text-slate-500">
                        {count} {status.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                )}
                {project.createdByUserId && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    Owner: {userMap.get(project.createdByUserId) ?? project.createdByUserId.slice(0, 8)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg p-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateTask(project.id);
                  }}
                  title="Add task to this project"
                  data-testid={`button-add-task-to-project-${project.id}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
                {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-slate-100 p-4 pt-3">
                {projectTasks.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No tasks in this project yet.</p>
                ) : (
                  <div className="space-y-2">
                    {projectTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onStatusChange={(id, status) => updateMutation.mutate({ id, status })}
                        onOpen={onOpen}
                        unreadCount={msgMap.get(t.id) ?? 0}
                        userMap={userMap}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SentView({ onOpen }: { onOpen: (task: PlexusTask) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/sent"],
  });
  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ["/api/plexus/users"],
  });
  const { data: unreadEntries = [] } = useUnreadPerTask();
  const msgMap = new Map(unreadEntries.map((m) => [m.taskId, m.unreadCount]));
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/plexus/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/sent"] }),
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center">
        <SendHorizonal className="h-10 w-10 text-slate-300" />
        <div>
          <p className="text-sm font-medium text-slate-600">No tasks created yet</p>
          <p className="mt-1 text-xs text-slate-400">Tasks you create will appear here</p>
        </div>
      </div>
    );
  }

  function formatRelative(dt: Date | string | null | undefined): string | null {
    if (!dt) return null;
    const d = typeof dt === "string" ? new Date(dt) : dt;
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="space-y-0.5">
          <TaskRow
            task={t}
            onStatusChange={(id, status) => updateMutation.mutate({ id, status })}
            onOpen={onOpen}
            unreadCount={msgMap.get(t.id) ?? 0}
            userMap={userMap}
          />
          {t.lastActivityAt && (
            <p className="px-1 text-[10px] text-slate-400">
              Last activity: {formatRelative(t.lastActivityAt)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTimeRemaining(dueDate: string | null | undefined): { label: string; overdue: boolean } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const totalMins = Math.floor(absMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  let label = "";
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;
  label += overdue ? " overdue" : " left";
  return { label, overdue };
}

function UrgentPanel({
  collapsed,
  onToggle,
  onHelp,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onHelp: (task: PlexusTask) => void;
}) {
  const { data: urgentTasks = [] } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/urgent"],
    refetchInterval: 30_000,
  });
  const { data: users = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ["/api/plexus/users"],
  });
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  const sorted = [...urgentTasks].sort(
    (a, b) => (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3),
  );

  return (
    <aside
      className={`shrink-0 flex flex-col border-l border-slate-200/80 bg-white/70 transition-all duration-200 ${collapsed ? "w-10" : "w-64"}`}
      data-testid="urgent-panel"
    >
      <div className={`flex items-center border-b border-slate-100 px-2 py-3 ${collapsed ? "justify-center" : "justify-between px-3"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Urgent</span>
            {sorted.length > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                {sorted.length}
              </span>
            )}
          </div>
        )}
        <button
          onClick={onToggle}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          title={collapsed ? "Expand urgent panel" : "Collapse urgent panel"}
          data-testid="button-toggle-urgent-panel"
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-green-200 bg-green-50/60 p-4 text-center">
              <Check className="mx-auto mb-1 h-5 w-5 text-green-500" />
              <p className="text-xs text-green-700 font-medium">All clear</p>
            </div>
          ) : (
            sorted.map((t) => {
              const urgencyClass = URGENCY_COLORS[t.urgency] ?? URGENCY_COLORS["none"];
              return (
                <div
                  key={t.id}
                  className="cursor-pointer rounded-2xl border border-red-200/60 bg-red-50/60 p-3 transition hover:bg-red-50"
                  onClick={() => onHelp(t)}
                  data-testid={`urgent-task-${t.id}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 leading-tight">{t.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${urgencyClass}`}>
                          {t.urgency}
                        </span>
                        {t.assignedToUserId && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-500">
                            <User className="h-2.5 w-2.5" />
                            {userMap.get(t.assignedToUserId) ?? t.assignedToUserId.slice(0, 8)}
                          </span>
                        )}
                        {(() => {
                          const tr = formatTimeRemaining(t.dueDate);
                          if (!tr) return null;
                          return (
                            <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium ${tr.overdue ? "text-red-600" : "text-amber-600"}`}>
                              <Clock className="h-2.5 w-2.5" />
                              {tr.label}
                            </span>
                          );
                        })()}
                        {t.patientName && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-500">
                            <User className="h-2.5 w-2.5" />
                            {t.patientName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className="mt-2 w-full rounded-xl border border-blue-200 bg-blue-50 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                    onClick={(e) => { e.stopPropagation(); onHelp(t); }}
                    data-testid={`button-help-task-${t.id}`}
                  >
                    <Users className="inline h-3 w-3 mr-1" />
                    Open
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {collapsed && sorted.length > 0 && (
        <div className="flex flex-col items-center gap-1.5 pt-3">
          {sorted.slice(0, 5).map((t) => {
            const urgencyClass = URGENCY_COLORS[t.urgency] ?? URGENCY_COLORS["none"];
            return (
              <button
                key={t.id}
                onClick={() => onHelp(t)}
                className={`w-7 h-7 rounded-full border flex items-center justify-center text-[9px] font-bold ${urgencyClass}`}
                title={t.title}
                data-testid={`urgent-dot-${t.id}`}
              >
                !
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

type OverdueResponse = {
  overdue: PlexusTask[];
  dueToday: PlexusTask[];
  overdueCount: number;
  dueTodayCount: number;
};

function OverdueAlert() {
  const { data } = useQuery<OverdueResponse>({
    queryKey: ["/api/plexus/tasks/overdue"],
    refetchInterval: 60_000,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("plexus-overdue-dismissed") === "1") setDismissed(true);
    } catch {}
  }, []);

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("plexus-overdue-dismissed", "1"); } catch {}
  }

  if (dismissed || !data) return null;
  const { overdue = [], dueToday = [] } = data;
  if (overdue.length === 0 && dueToday.length === 0) return null;

  const all = [...overdue, ...dueToday];
  const visible = all.slice(0, 5);
  const moreCount = all.length - visible.length;

  return (
    <div
      className="mb-5 rounded-2xl border border-red-200 bg-red-50/80 p-4 shadow-sm"
      data-testid="alert-overdue-tasks"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-800">
            {overdue.length > 0 && (
              <>
                {overdue.length} overdue task{overdue.length === 1 ? "" : "s"}
                {dueToday.length > 0 ? ` · ${dueToday.length} due today` : ""}
              </>
            )}
            {overdue.length === 0 && (
              <>{dueToday.length} task{dueToday.length === 1 ? "" : "s"} due today</>
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {visible.map((t) => {
              const isOverdue = (t.dueDate ?? "") < new Date().toISOString().slice(0, 10);
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-xs text-slate-700"
                  data-testid={`overdue-item-${t.id}`}
                >
                  <Clock className={`h-3 w-3 ${isOverdue ? "text-red-500" : "text-amber-500"}`} />
                  <span className="font-medium">{t.title}</span>
                  <span className={isOverdue ? "text-red-600" : "text-amber-600"}>
                    · {isOverdue ? "Overdue" : "Due today"} ({t.dueDate})
                  </span>
                </li>
              );
            })}
            {moreCount > 0 && (
              <li className="text-xs text-slate-500 italic">+ {moreCount} more</li>
            )}
          </ul>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-red-400 hover:bg-red-100 hover:text-red-600 transition"
          title="Dismiss"
          data-testid="button-dismiss-overdue"
          aria-label="Dismiss overdue alert"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function PlexusTasksPage() {
  const [view, setView] = useState<View>("my-work");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForProject, setCreateForProject] = useState<number | null>(null);
  const [urgentCollapsed, setUrgentCollapsed] = useState(false);
  const [selectedTask, setSelectedTask] = useState<PlexusTask | null>(null);

  function openCreateFor(projectId?: number) {
    setCreateForProject(projectId ?? null);
    setCreateModalOpen(true);
  }

  const NAV = [
    { id: "my-work" as View, label: "My Work", Icon: CheckSquare },
    { id: "projects" as View, label: "Projects", Icon: FolderOpen },
    { id: "sent" as View, label: "Sent", Icon: SendHorizonal },
  ];

  return (
    <div className="flex h-full min-h-screen plexus-page-radial">

      {/* Left sidebar */}
      <aside className="flex w-52 shrink-0 flex-col gap-4 border-r border-slate-200/80 bg-white/60 p-5">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-indigo-600/10 p-2 text-indigo-700">
            <CheckSquare className="h-5 w-5" />
          </div>
          <h1 className="text-base font-bold text-slate-900">Plexus Tasks</h1>
        </div>

        <Button
          className="rounded-2xl w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          onClick={() => openCreateFor()}
          data-testid="button-open-create-task"
        >
          <Plus className="h-4 w-4" />
          New Task
        </Button>

        <nav className="space-y-0.5">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                view === id
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              }`}
              data-testid={`nav-plexus-${id}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 min-w-0">
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · TASKS"
          icon={NAV.find((n) => n.id === view)?.Icon}
          iconAccent="bg-indigo-600/10 text-indigo-700"
          title={
            view === "my-work" ? "My Work"
            : view === "projects" ? "Projects"
            : "Sent"
          }
          subtitle={
            view === "my-work" ? "Tasks assigned to you, grouped by project and sorted by urgency"
            : view === "projects" ? "All projects and their task lists"
            : "Tasks you created and their current state"
          }
          className="mb-6"
          actions={
            <Button
              variant="outline"
              className="rounded-2xl border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              onClick={() => openCreateFor()}
              data-testid="button-create-task-header"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New Task
            </Button>
          }
        />

        <OverdueAlert />

        {view === "my-work" && <MyWorkView onOpen={setSelectedTask} />}
        {view === "projects" && <ProjectsView onCreateTask={(pid) => openCreateFor(pid)} onOpen={setSelectedTask} />}
        {view === "sent" && <SentView onOpen={setSelectedTask} />}
      </main>

      {/* Right: Urgent Panel */}
      <UrgentPanel
        collapsed={urgentCollapsed}
        onToggle={() => setUrgentCollapsed((v) => !v)}
        onHelp={setSelectedTask}
      />

      <CreateTaskModal
        open={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setCreateForProject(null); }}
        defaultProjectId={createForProject}
      />

      {selectedTask !== null && (
        <TaskDrawerForTask task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </div>
  );
}

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (typeof value === "string") return value;
  return value.toISOString();
}

function taskToSummary(task: PlexusTask): PlexusTaskSummary {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    taskType: task.taskType,
    urgency: task.urgency,
    priority: task.priority,
    status: task.status,
    assignedToUserId: task.assignedToUserId ?? null,
    createdByUserId: task.createdByUserId ?? null,
    patientScreeningId: task.patientScreeningId ?? null,
    dueDate: task.dueDate ?? null,
    createdAt: toIsoString(task.createdAt),
    updatedAt: toIsoString(task.updatedAt),
    patientName: task.patientName ?? null,
  };
}

function TaskDrawerForTask({ task, onClose }: { task: PlexusTask; onClose: () => void }) {
  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: users = [] } = useQuery<UserEntry[]>({
    queryKey: ["/api/plexus/users"],
    staleTime: 5 * 60 * 1000,
  });
  const patientId = task.patientScreeningId ?? null;
  const { data: patientTasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks", "patient", patientId],
    queryFn: async () => {
      const res = await fetch(`/api/plexus/tasks?patientScreeningId=${patientId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const summary = taskToSummary(task);
  const tasks: PlexusTaskSummary[] = patientId && patientTasks.length > 0
    ? (patientTasks.some((t) => t.id === task.id) ? patientTasks : [summary, ...patientTasks])
    : [summary];

  const headerName =
    task.patientName ??
    patientTasks.find((t) => t.id === task.id)?.patientName ??
    task.title;

  return (
    <TaskDrawer
      patientScreeningId={patientId ?? 0}
      patientName={headerName ?? undefined}
      tasks={tasks}
      currentUser={currentUser ?? null}
      users={users}
      onClose={onClose}
    />
  );
}
