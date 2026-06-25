// Front-end types for the Plexus Tasks workspace. These mirror the JSON shapes
// returned by /api/plexus/* (timestamps are serialized to ISO strings over the
// wire, so we model them as strings here rather than reusing the Drizzle
// $inferSelect types whose date columns are typed as Date).

export type TaskStatus = "open" | "in_progress" | "done" | "closed";
export type TaskUrgency = "none" | "EOD" | "within 3 hours" | "within 1 hour";
export type TaskPriority = "low" | "normal" | "high";
export type ProjectType = "operational" | "clinical" | "admin" | "training";
export type ProjectStatus = "active" | "archived" | "closed";

export interface PlexusUser {
  id: string;
  username: string;
  role?: string | null;
  active?: boolean | null;
}

export interface Project {
  id: number;
  title: string;
  description: string | null;
  projectType: ProjectType;
  facility: string | null;
  status: ProjectStatus;
  createdByUserId: string | null;
  createdAt: string;
}

export interface Task {
  id: number;
  projectId: number | null;
  parentTaskId: number | null;
  title: string;
  description: string | null;
  taskType: string;
  urgency: TaskUrgency;
  priority: TaskPriority;
  status: TaskStatus;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  patientScreeningId: number | null;
  batchId: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched server-side:
  patientName?: string | null;
  lastActivityAt?: string | null;
}

export interface TaskMessage {
  id: number;
  taskId: number;
  senderUserId: string | null;
  body: string;
  createdAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: number | null;
  projectId: number | null;
  userId: string | null;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectSummary {
  taskCount: number;
  counts: Partial<Record<TaskStatus, number>>;
}

export interface PatientSearchResult {
  id: number;
  name: string;
  dob: string | null;
  insurance: string | null;
}

export interface UnreadPerTask {
  taskId: number;
  unreadCount: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  projectId?: number | null;
  taskType?: string;
  urgency?: TaskUrgency;
  priority?: TaskPriority;
  assignedToUserId?: string | null;
  patientScreeningId?: number | null;
  dueDate?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  urgency?: TaskUrgency;
  priority?: TaskPriority;
  assignedToUserId?: string | null;
  projectId?: number | null;
  dueDate?: string | null;
}

export interface CreateProjectInput {
  title: string;
  description?: string | null;
  projectType?: ProjectType;
  facility?: string | null;
  status?: ProjectStatus;
}

export const STATUS_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "open", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
  { id: "closed", label: "Closed" },
];

export const URGENCY_OPTIONS: TaskUrgency[] = [
  "none",
  "EOD",
  "within 3 hours",
  "within 1 hour",
];

export const PRIORITY_OPTIONS: TaskPriority[] = ["low", "normal", "high"];

export const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  "operational",
  "clinical",
  "admin",
  "training",
];

export const URGENCY_ORDER: Record<TaskUrgency, number> = {
  "within 1 hour": 0,
  "within 3 hours": 1,
  EOD: 2,
  none: 3,
};

export const URGENCY_BADGE: Record<TaskUrgency, string> = {
  "within 1 hour": "bg-red-100 text-red-700 border-red-200",
  "within 3 hours": "bg-orange-100 text-orange-700 border-orange-200",
  EOD: "bg-amber-100 text-amber-700 border-amber-200",
  none: "bg-slate-100 text-slate-500 border-slate-200",
};

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  high: "bg-rose-100 text-rose-700 border-rose-200",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-sky-100 text-sky-700 border-sky-200",
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  open: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-200 text-slate-500 border-slate-300",
};
