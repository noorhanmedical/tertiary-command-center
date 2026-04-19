import { useState } from "react";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PlexusTask, PlexusProject } from "@shared/schema";

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

type MessageCount = { taskId: number; count: number };

function TaskRow({
  task,
  onStatusChange,
  unreadCount = 0,
}: {
  task: PlexusTask;
  onStatusChange: (id: number, status: string) => void;
  unreadCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const urgencyClass = URGENCY_COLORS[task.urgency] ?? URGENCY_COLORS["none"];

  function handleExpand() {
    setExpanded((v) => !v);
    if (!expanded && unreadCount > 0) {
      apiRequest("POST", `/api/plexus/tasks/${task.id}/read`, {}).catch(() => {});
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/unread-count"] });
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div
        className="flex cursor-pointer items-start gap-3 p-4"
        onClick={handleExpand}
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
          {task.description && !expanded && (
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
                {task.assignedToUserId}
              </span>
            )}
          </div>
        </div>

        <button
          className="shrink-0 text-slate-400 hover:text-slate-600"
          onClick={(e) => { e.stopPropagation(); handleExpand(); }}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {task.description && (
            <p className="mb-3 text-sm text-slate-600">{task.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {(["open", "in_progress", "done", "closed"] as const).map((s) => (
              <button
                key={s}
                className={`rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                  task.status === s
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
                onClick={() => onStatusChange(task.id, s)}
                data-testid={`button-set-status-${s}-${task.id}`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useMessageCounts(taskIds: number[]) {
  return useQuery<MessageCount[]>({
    queryKey: ["/api/plexus/tasks/message-counts", taskIds.join(",")],
    queryFn: async () => {
      if (taskIds.length === 0) return [];
      const counts: MessageCount[] = [];
      for (const id of taskIds) {
        try {
          const res = await fetch(`/api/plexus/tasks/${id}/messages`, { credentials: "include" });
          const msgs = await res.json();
          counts.push({ taskId: id, count: Array.isArray(msgs) ? msgs.length : 0 });
        } catch {
          counts.push({ taskId: id, count: 0 });
        }
      }
      return counts;
    },
    enabled: taskIds.length > 0,
    staleTime: 30_000,
  });
}

function MyWorkView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/my-work"],
  });
  const { data: projects = [] } = useQuery<PlexusProject[]>({
    queryKey: ["/api/plexus/projects"],
  });
  const { data: msgCounts = [] } = useMessageCounts(tasks.map((t) => t.id));
  const msgMap = new Map(msgCounts.map((m) => [m.taskId, m.count]));

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
                  unreadCount={msgMap.get(t.id) ?? 0}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectsView({ onCreateTask }: { onCreateTask: (projectId: number) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: projects = [], isLoading } = useQuery<PlexusProject[]>({
    queryKey: ["/api/plexus/projects"],
  });

  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  const { data: projectTasks = [] } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/by-project", expandedProject],
    queryFn: async () => {
      if (!expandedProject) return [];
      const res = await fetch(`/api/plexus/tasks/by-project/${expandedProject}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!expandedProject,
  });

  const { data: msgCounts = [] } = useMessageCounts(projectTasks.map((t) => t.id));
  const msgMap = new Map(msgCounts.map((m) => [m.taskId, m.count]));

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/plexus/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/by-project", expandedProject] }),
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center">
        <FolderOpen className="h-10 w-10 text-slate-300" />
        <div>
          <p className="text-sm font-medium text-slate-600">No projects yet</p>
          <p className="mt-1 text-xs text-slate-400">Create a task inside a project to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => {
        const isOpen = expandedProject === project.id;
        const statusCounts = projectTasks.reduce<Record<string, number>>((acc, t) => {
          if (expandedProject === project.id) {
            acc[t.status] = (acc[t.status] ?? 0) + 1;
          }
          return acc;
        }, {});
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
                  {project.status === "archived" && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">archived</Badge>
                  )}
                </div>
                {isOpen && Object.keys(statusCounts).length > 0 && (
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
                    Owner: {project.createdByUserId}
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
                        unreadCount={msgMap.get(t.id) ?? 0}
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

function SentView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/sent"],
  });
  const { data: msgCounts = [] } = useMessageCounts(tasks.map((t) => t.id));
  const msgMap = new Map(msgCounts.map((m) => [m.taskId, m.count]));

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

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onStatusChange={(id, status) => updateMutation.mutate({ id, status })}
          unreadCount={msgMap.get(t.id) ?? 0}
        />
      ))}
    </div>
  );
}

function UrgentPanel({
  collapsed,
  onToggle,
  onHelp,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onHelp: (taskId: number) => void;
}) {
  const { data: urgentTasks = [] } = useQuery<PlexusTask[]>({
    queryKey: ["/api/plexus/tasks/urgent"],
    refetchInterval: 30_000,
  });

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
                  className="rounded-2xl border border-red-200/60 bg-red-50/60 p-3"
                  data-testid={`urgent-task-${t.id}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 leading-tight">{t.title}</p>
                      <span className={`mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${urgencyClass}`}>
                        {t.urgency}
                      </span>
                    </div>
                  </div>
                  <button
                    className="mt-2 w-full rounded-xl border border-blue-200 bg-blue-50 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                    onClick={() => onHelp(t.id)}
                    data-testid={`button-help-task-${t.id}`}
                  >
                    <Users className="inline h-3 w-3 mr-1" />
                    Help
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
                onClick={() => onHelp(t.id)}
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

export default function PlexusTasksPage() {
  const [view, setView] = useState<View>("my-work");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForProject, setCreateForProject] = useState<number | null>(null);
  const [urgentCollapsed, setUrgentCollapsed] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const helpMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("POST", `/api/plexus/tasks/${taskId}/collaborators`, {}),
    onSuccess: () => {
      toast({ title: "Added as collaborator" });
      qc.invalidateQueries({ queryKey: ["/api/plexus/tasks/urgent"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

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
    <div className="flex h-full min-h-screen bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">

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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {view === "my-work" && "My Work"}
              {view === "projects" && "Projects"}
              {view === "sent" && "Sent"}
            </h2>
            <p className="text-sm text-slate-500">
              {view === "my-work" && "Tasks assigned to you, grouped by project and sorted by urgency"}
              {view === "projects" && "All projects and their task lists"}
              {view === "sent" && "Tasks you created and their current state"}
            </p>
          </div>
          <Button
            variant="outline"
            className="rounded-2xl border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            onClick={() => openCreateFor()}
            data-testid="button-create-task-header"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Task
          </Button>
        </div>

        {view === "my-work" && <MyWorkView />}
        {view === "projects" && <ProjectsView onCreateTask={(pid) => openCreateFor(pid)} />}
        {view === "sent" && <SentView />}
      </main>

      {/* Right: Urgent Panel */}
      <UrgentPanel
        collapsed={urgentCollapsed}
        onToggle={() => setUrgentCollapsed((v) => !v)}
        onHelp={(taskId) => helpMutation.mutate(taskId)}
      />

      <CreateTaskModal
        open={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setCreateForProject(null); }}
        defaultProjectId={createForProject}
      />
    </div>
  );
}
