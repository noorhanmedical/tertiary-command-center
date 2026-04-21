import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "@/App";
import { TaskDrawer } from "./TaskDrawer";

export type PlexusTaskSummary = {
  id: number;
  title: string;
  description: string | null;
  taskType: string;
  urgency: string;
  priority: string;
  status: string;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  patientScreeningId: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  patientName?: string | null;
};

export type UserEntry = { id: string; username: string; role?: string; active?: boolean };

export function getInitials(username: string): string {
  const parts = username.split(/[\s_.-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (username.length >= 2) return username.slice(0, 2).toUpperCase();
  return username.toUpperCase();
}

const BG_COLORS = [
  "bg-blue-600", "bg-violet-600", "bg-emerald-600", "bg-amber-600",
  "bg-rose-600", "bg-indigo-600", "bg-teal-600", "bg-orange-600",
];

export function colorForUserId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return BG_COLORS[hash % BG_COLORS.length];
}

export function SchedulerIcon({
  patientScreeningId,
  schedulerUserId,
  patientName,
  size = "sm",
}: {
  patientScreeningId: number;
  schedulerUserId?: string | null;
  patientName?: string;
  size?: "xs" | "sm" | "md";
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: users = [] } = useQuery<UserEntry[]>({
    queryKey: ["/api/plexus/users"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: tasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks", "patient", patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/plexus/tasks?patientScreeningId=${patientScreeningId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: unreadPerTask = [] } = useQuery<{ taskId: number; unreadCount: number }[]>({
    queryKey: ["/api/plexus/tasks/unread-per-task"],
    refetchInterval: 60_000,
  });

  const userMap = new Map<string, UserEntry>(users.map((u) => [u.id, u]));

  const primaryTask = tasks.find((t) => t.taskType !== "urgent_call") ?? tasks[0] ?? null;
  const resolvedSchedulerUserId = primaryTask?.assignedToUserId ?? schedulerUserId ?? null;
  const schedulerUser = resolvedSchedulerUserId ? (userMap.get(resolvedSchedulerUserId) ?? null) : null;

  const taskIdSet = new Set(tasks.map((t) => t.id));
  const hasUnread = unreadPerTask.some((u) => taskIdSet.has(u.taskId) && u.unreadCount > 0);

  const sizeClasses: Record<string, string> = {
    xs: "h-5 w-5 text-[9px]",
    sm: "h-7 w-7 text-[11px]",
    md: "h-9 w-9 text-xs",
  };

  const initials = schedulerUser ? getInitials(schedulerUser.username) : "?";
  const bgColor = resolvedSchedulerUserId ? colorForUserId(resolvedSchedulerUserId) : "bg-slate-400";

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
        className={`relative inline-flex flex-shrink-0 items-center justify-center rounded-full text-white font-semibold transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 ${sizeClasses[size] ?? sizeClasses.sm} ${bgColor}`}
        title={schedulerUser ? `Scheduler: ${schedulerUser.username}` : "No scheduler assigned — click to open task"}
        data-testid={`scheduler-icon-${patientScreeningId}`}
        aria-label={schedulerUser ? `Open task for ${patientName ?? "patient"} — assigned to ${schedulerUser.username}` : "Open task drawer"}
      >
        {initials}
        {hasUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
            aria-label="Unread messages"
            data-testid={`scheduler-icon-unread-${patientScreeningId}`}
          />
        )}
      </button>

      {drawerOpen && (
        <TaskDrawer
          patientScreeningId={patientScreeningId}
          patientName={patientName}
          tasks={tasks}
          currentUser={currentUser ?? null}
          users={users}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
