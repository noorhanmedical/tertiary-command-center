// Compact Plexus Tasks popup shown from the global dock (main app + portals,
// all roles). Surfaces my work, urgent, and due items, allows a quick add, and
// promotes into the full-page workspace via "Open full view".

import { useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  CheckSquare,
  Clock,
  FolderOpen,
  Loader2,
  Plus,
  SquareArrowOutUpRight,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  PRIORITY_BADGE,
  URGENCY_BADGE,
  URGENCY_ORDER,
  type Task,
} from "./types";
import {
  useCreateTask,
  useMyWorkTasks,
  useOverdueTasks,
  useProjects,
  useUnreadPerTask,
  useUrgentTasks,
} from "./hooks";

type TabId = "mine" | "urgent" | "due";

function MiniTaskRow({ task, unread }: { task: Task; unread: number }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
      data-testid={`dock-task-${task.id}`}
    >
      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {task.urgency !== "none" && (
            <span className={`rounded-full border px-1 py-0.5 text-[8px] font-semibold ${URGENCY_BADGE[task.urgency]}`}>{task.urgency}</span>
          )}
          <span className={`rounded-full border px-1 py-0.5 text-[8px] font-semibold ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
          {task.dueDate && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-600"><Clock className="h-2.5 w-2.5" />{task.dueDate}</span>
          )}
          {task.patientName && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-500"><UserIcon className="h-2.5 w-2.5" />{task.patientName}</span>
          )}
        </div>
      </div>
      {unread > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7283B0] px-1 text-[9px] font-bold text-white">{unread}</span>
      )}
    </div>
  );
}

export function TasksDockPopup({ onOpenFullView }: { onOpenFullView: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>("mine");
  const [quickTitle, setQuickTitle] = useState("");

  const myWork = useMyWorkTasks();
  const urgent = useUrgentTasks();
  const overdue = useOverdueTasks();
  const { data: projects = [] } = useProjects();
  const { data: unreadPerTask = [] } = useUnreadPerTask();
  const createTask = useCreateTask();

  const unreadMap = new Map(unreadPerTask.map((u) => [u.taskId, u.unreadCount]));

  const dueTasks = [...(overdue.data?.overdue ?? []), ...(overdue.data?.dueToday ?? [])];
  const activeQuery = tab === "mine" ? myWork : tab === "urgent" ? urgent : overdue;
  const tasks =
    tab === "mine"
      ? [...(myWork.data ?? [])].filter((t) => t.status !== "done" && t.status !== "closed")
      : tab === "urgent"
        ? [...(urgent.data ?? [])]
        : dueTasks;

  const sorted = [...tasks].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);

  function quickAdd() {
    if (!quickTitle.trim()) return;
    createTask.mutate(
      { title: quickTitle.trim() },
      {
        onSuccess: () => { setQuickTitle(""); toast({ title: "Task created" }); },
        onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
      },
    );
  }

  const TABS: { id: TabId; label: string; icon: typeof CheckSquare; count: number }[] = [
    { id: "mine", label: "My Work", icon: CheckSquare, count: (myWork.data ?? []).filter((t) => t.status !== "done" && t.status !== "closed").length },
    { id: "urgent", label: "Urgent", icon: AlertTriangle, count: (urgent.data ?? []).length },
    { id: "due", label: "Due", icon: Clock, count: dueTasks.length },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="tasks-dock-popup">
      {/* Quick add */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-1 pb-3">
        <Input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); }}
          placeholder="Quick add a task…"
          className="h-9 text-sm"
          data-testid="input-quick-add-task"
        />
        <Button size="sm" onClick={quickAdd} disabled={!quickTitle.trim() || createTask.isPending} data-testid="button-quick-add-task">
          {createTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-100 px-1 py-2">
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${tab === id ? "bg-[#7283B0]/10 text-[#7283B0]" : "text-slate-500 hover:bg-slate-100"}`}
            data-testid={`dock-tab-${id}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
            {count > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[9px] text-slate-600">{count}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 py-3">
        {activeQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
        {!activeQuery.isLoading && sorted.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">Nothing here right now.</p>
        )}
        {sorted.map((t) => (
          <MiniTaskRow key={t.id} task={t} unread={unreadMap.get(t.id) ?? 0} />
        ))}
      </div>

      {/* Project shortcuts */}
      {projects.length > 0 && (
        <div className="border-t border-slate-100 px-1 py-2">
          <p className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Projects</p>
          <div className="flex flex-wrap gap-1.5">
            {projects.slice(0, 5).map((p) => (
              <button
                key={p.id}
                onClick={() => { onOpenFullView(); navigate("/plexus-tasks"); }}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                data-testid={`dock-project-${p.id}`}
              >
                <FolderOpen className="h-3 w-3" /> {p.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Open full view */}
      <div className="border-t border-slate-100 px-1 pt-3">
        <Button
          className="w-full justify-center gap-2 rounded-xl bg-[#061b2d] text-white hover:bg-[#0c2b45]"
          onClick={() => { onOpenFullView(); navigate("/plexus-tasks"); }}
          data-testid="button-open-full-view"
        >
          <SquareArrowOutUpRight className="h-4 w-4" /> Open full view
        </Button>
      </div>
    </div>
  );
}

export default TasksDockPopup;
