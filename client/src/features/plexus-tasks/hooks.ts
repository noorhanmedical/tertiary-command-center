// Typed data hooks for the Plexus Tasks workspace. All cache reads, writes and
// invalidations go through qk.plexus so screens never desync.

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { qk } from "@/hooks/api/keys";
import type {
  CreateProjectInput,
  CreateTaskInput,
  PatientSearchResult,
  PlexusUser,
  Project,
  ProjectSummary,
  Task,
  TaskEvent,
  TaskMessage,
  UnreadPerTask,
  UpdateTaskInput,
} from "./types";

async function readJson(res: Response) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Reference data ──────────────────────────────────────────────────────────
export function usePlexusUsers() {
  return useQuery<PlexusUser[]>({
    queryKey: qk.plexus.users(),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePatientSearch(q: string) {
  const term = q.trim();
  return useQuery<PatientSearchResult[]>({
    queryKey: qk.plexus.patientSearch(term),
    enabled: term.length >= 2,
    staleTime: 30_000,
    queryFn: async () =>
      readJson(await fetch(`/api/plexus/patients/search?q=${encodeURIComponent(term)}`, { credentials: "include" })),
  });
}

// ── Projects ────────────────────────────────────────────────────────────────
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: qk.plexus.projects(),
    refetchInterval: 60_000,
  });
}

export function useProjectSummary(id: number | null) {
  return useQuery<ProjectSummary>({
    queryKey: id != null ? qk.plexus.projectSummary(id) : ["plexus-project-summary-disabled"],
    enabled: id != null,
    staleTime: 30_000,
  });
}

// ── Task lists ──────────────────────────────────────────────────────────────
export function useMyWorkTasks() {
  return useQuery<Task[]>({
    queryKey: qk.plexus.myWorkTasks(),
    refetchInterval: 60_000,
  });
}

export function useSentTasks() {
  return useQuery<Task[]>({
    queryKey: qk.plexus.sentTasks(),
    refetchInterval: 60_000,
  });
}

export function useUrgentTasks() {
  return useQuery<Task[]>({
    queryKey: qk.plexus.urgentTasks(),
    refetchInterval: 30_000,
  });
}

export interface OverdueResponse {
  overdue: Task[];
  dueToday: Task[];
  overdueCount: number;
  dueTodayCount: number;
}

export function useOverdueTasks() {
  return useQuery<OverdueResponse>({
    queryKey: qk.plexus.overdueTasks(),
    refetchInterval: 60_000,
  });
}

export function useTasksByProject(projectId: number | null) {
  return useQuery<Task[]>({
    queryKey: projectId != null ? qk.plexus.tasksByProject(projectId) : ["plexus-tasks-by-project-disabled"],
    enabled: projectId != null,
    queryFn: async () => readJson(await fetch(`/api/plexus/tasks/by-project/${projectId}`, { credentials: "include" })),
    refetchInterval: 60_000,
  });
}

// ── Unread tracking ─────────────────────────────────────────────────────────
export function useUnreadCount() {
  return useQuery<{ count: number }>({
    queryKey: qk.plexus.unreadCount(),
    refetchInterval: 45_000,
  });
}

export function useUnreadPerTask() {
  return useQuery<UnreadPerTask[]>({
    queryKey: qk.plexus.unreadPerTask(),
    refetchInterval: 60_000,
  });
}

// ── Task detail: messages + events ──────────────────────────────────────────
export function useTaskMessages(taskId: number | null) {
  return useQuery<TaskMessage[]>({
    queryKey: taskId != null ? qk.plexus.taskMessages(taskId) : ["plexus-task-messages-disabled"],
    enabled: taskId != null,
    queryFn: async () => readJson(await fetch(`/api/plexus/tasks/${taskId}/messages`, { credentials: "include" })),
    refetchInterval: 30_000,
  });
}

export function useTaskEvents(taskId: number | null) {
  return useQuery<TaskEvent[]>({
    queryKey: taskId != null ? qk.plexus.taskEvents(taskId) : ["plexus-task-events-disabled"],
    enabled: taskId != null,
    queryFn: async () => readJson(await fetch(`/api/plexus/tasks/${taskId}/events`, { credentials: "include" })),
    refetchInterval: 30_000,
  });
}

// ── Invalidation helper ─────────────────────────────────────────────────────
export function invalidateTaskLists() {
  queryClient.invalidateQueries({ queryKey: qk.plexus.myWorkTasks() });
  queryClient.invalidateQueries({ queryKey: qk.plexus.sentTasks() });
  queryClient.invalidateQueries({ queryKey: qk.plexus.urgentTasks() });
  queryClient.invalidateQueries({ queryKey: qk.plexus.overdueTasks() });
  queryClient.invalidateQueries({ queryKey: ["/api/plexus/tasks/by-project"] });
  queryClient.invalidateQueries({ queryKey: qk.plexus.projects() });
}

// ── Mutations ───────────────────────────────────────────────────────────────
export function useCreateTask() {
  return useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<Task> =>
      readJson(await apiRequest("POST", "/api/plexus/tasks", input)),
    onSuccess: () => invalidateTaskLists(),
  });
}

export function useUpdateTask() {
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateTaskInput & { id: number }): Promise<Task> =>
      readJson(await apiRequest("PATCH", `/api/plexus/tasks/${id}`, patch)),
    onSuccess: (_data, vars) => {
      invalidateTaskLists();
      queryClient.invalidateQueries({ queryKey: qk.plexus.taskEvents(vars.id) });
    },
  });
}

export function useDeleteTask() {
  return useMutation({
    mutationFn: async (id: number) => readJson(await apiRequest("DELETE", `/api/plexus/tasks/${id}`)),
    onSuccess: () => invalidateTaskLists(),
  });
}

export function useCreateProject() {
  return useMutation({
    mutationFn: async (input: CreateProjectInput): Promise<Project> =>
      readJson(await apiRequest("POST", "/api/plexus/projects", input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.plexus.projects() }),
  });
}

export function useUpdateProject() {
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CreateProjectInput> & { id: number }): Promise<Project> =>
      readJson(await apiRequest("PATCH", `/api/plexus/projects/${id}`, patch)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.plexus.projects() }),
  });
}

export function useDeleteProject() {
  return useMutation({
    mutationFn: async (id: number) => readJson(await apiRequest("DELETE", `/api/plexus/projects/${id}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.plexus.projects() });
      invalidateTaskLists();
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({ taskId, body }: { taskId: number; body: string }): Promise<TaskMessage> =>
      readJson(await apiRequest("POST", `/api/plexus/tasks/${taskId}/messages`, { body })),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: qk.plexus.taskMessages(vars.taskId) });
      queryClient.invalidateQueries({ queryKey: qk.plexus.taskEvents(vars.taskId) });
    },
  });
}

export function useMarkTaskRead() {
  return useMutation({
    mutationFn: async (taskId: number) => readJson(await apiRequest("POST", `/api/plexus/tasks/${taskId}/read`, {})),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.plexus.unreadCount() });
      queryClient.invalidateQueries({ queryKey: qk.plexus.unreadPerTask() });
    },
  });
}
