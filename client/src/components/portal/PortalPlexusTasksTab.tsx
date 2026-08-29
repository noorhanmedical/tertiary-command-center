import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ClipboardList, ExternalLink, Hand } from "lucide-react";
import {
  SketchSurface,
  SketchSectionHeader,
  SketchBadge,
  SketchButton,
} from "@/components/playground/sketch/SketchPrimitives";
import { dispatchOpenWorkspace } from "@/components/playground/playgroundEvents";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Plexus Tasks tab — the canonical Team Portal task surface (Phase 5B).
// Views: My Tasks / Team Pool (claimable) / Manager (admin+managers only).
// A single-patient context keeps the existing by-patient list. Does NOT
// create a parallel task system — everything reads /api/plexus/tasks/*.

type PlexusTask = {
  id: number;
  title: string;
  description: string | null;
  taskType: string | null;
  urgency: string | null;
  priority: string | null;
  priorityLevel: string | null;
  status: string | null;
  dueDate: string | null;
  dueAt: string | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  ancillaryCaseId: number | null;
  facilityId: string | null;
  patientName?: string | null;
  assignedToUserId: string | null;
  assignedTeamId: number | null;
  createdByUserId: string | null;
  completedAt?: string | null;
  // manager-view enrichments
  assignedToUsername?: string | null;
  overdue?: boolean;
  ageDays?: number;
};

type TaskView = "my" | "pool" | "manager";

async function getTasks(url: string): Promise<PlexusTask[]> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 403) throw new Error("__forbidden__");
  if (!res.ok) throw new Error(`Tasks request failed (${res.status})`);
  const json = await res.json();
  // /manager returns { tasks, count }; the others return an array.
  return Array.isArray(json) ? json : (json.tasks ?? []);
}

function isOverdue(t: PlexusTask): boolean {
  if (typeof t.overdue === "boolean") return t.overdue;
  const terminal = t.status === "done" || t.status === "closed";
  if (terminal) return false;
  // Prefer the real timestamp; fall back to the legacy day string.
  if (t.dueAt) return new Date(t.dueAt).getTime() < Date.now();
  if (t.dueDate) return t.dueDate < new Date().toISOString().slice(0, 10);
  return false;
}

export function PortalPlexusTasksTab({
  patientScreeningId,
}: {
  patientScreeningId: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<TaskView>("my");

  // Patient context short-circuits the view tabs — show that patient's tasks.
  const byPatient = patientScreeningId != null && patientScreeningId > 0;
  const url = byPatient
    ? `/api/plexus/tasks/by-patient/${patientScreeningId}`
    : view === "pool"
      ? "/api/plexus/tasks/team-pool"
      : view === "manager"
        ? "/api/plexus/tasks/manager"
        : "/api/plexus/tasks/my-work";

  const { data = [], isLoading, isError, error } = useQuery<PlexusTask[]>({
    queryKey: ["portal-plexus-tasks", url],
    queryFn: () => getTasks(url),
    refetchInterval: 30_000,
    retry: (count, err) => !(err instanceof Error && err.message === "__forbidden__") && count < 2,
  });

  const claimMutation = useMutation({
    mutationFn: async (taskId: number) => apiRequest("POST", `/api/plexus/tasks/${taskId}/claim`, {}),
    onSuccess: () => {
      toast({ title: "Task claimed", description: "It's now in your My Tasks." });
      queryClient.invalidateQueries({ queryKey: ["portal-plexus-tasks"] });
    },
    onError: (e: Error) => {
      // Phase 6C — stale-state recovery. A 409 means someone else won the claim
      // race (or the task left the pool). Surface it plainly and refetch so the
      // now-claimed task drops out of this user's team-pool view immediately.
      if (e instanceof ApiError && e.status === 409) {
        toast({
          title: "Already claimed",
          description: "A teammate claimed this task first. Refreshing the pool.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["portal-plexus-tasks"] });
        return;
      }
      toast({ title: "Could not claim", description: e.message, variant: "destructive" });
    },
  });

  const forbidden = isError && error instanceof Error && error.message === "__forbidden__";

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4" data-testid="portal-plexus-tasks">
      <SketchSectionHeader
        seedId="plexus-tasks-header"
        icon={<ClipboardList className="h-4 w-4" />}
        title={byPatient ? "Patient Plexus tasks" : "Plexus tasks"}
        right={<span className="text-[10px] font-normal text-slate-500">Canonical: plexus_tasks</span>}
      />

      {!byPatient && (
        <div className="flex items-center gap-1" data-testid="plexus-tasks-views">
          {([
            { id: "my", label: "My Tasks" },
            { id: "pool", label: "Team Pool" },
            { id: "manager", label: "Manager" },
          ] as { id: TaskView; label: string }[]).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                view === v.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`plexus-tasks-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      <SketchSurface seedId="plexus-tasks-list" className="flex-1 min-h-0 overflow-y-auto" padded>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
          </div>
        ) : forbidden ? (
          <div className="text-xs text-slate-500 italic py-2" data-testid="plexus-tasks-forbidden">
            The Manager view is available to admins and team managers only.
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700 py-2">
            {error instanceof Error ? error.message : "Failed to load tasks"}
          </div>
        ) : data.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            {byPatient
              ? "No tasks for this patient."
              : view === "pool"
                ? "No unclaimed team tasks in your teams' pool."
                : view === "manager"
                  ? "No tasks in your managed scope."
                  : "No tasks assigned to you."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/60" data-testid="portal-plexus-tasks-list">
            {data.map((t) => {
              const canOpenPatient = t.patientScreeningId != null && t.patientScreeningId > 0;
              const openPatient = () => {
                if (!canOpenPatient) return;
                dispatchOpenWorkspace({
                  type: "patient_ehr",
                  title: t.patientName ?? "Patient",
                  patientScreeningId: t.patientScreeningId!,
                  executionCaseId: t.executionCaseId ?? null,
                  ancillaryCaseId: t.ancillaryCaseId ?? null,
                  facilityId: t.facilityId ?? null,
                  focusSection: "ancillary-journey",
                });
              };
              const overdue = isOverdue(t);
              const dueLabel = t.dueAt
                ? new Date(t.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : t.dueDate ?? null;
              const isTeamPoolClaimable = view === "pool" && t.assignedTeamId != null && t.assignedToUserId == null;
              return (
                <li
                  key={t.id}
                  className={`px-1 py-2.5 ${canOpenPatient ? "cursor-pointer hover:bg-slate-50/70" : ""}`}
                  data-testid={`portal-plexus-task-${t.id}`}
                  onClick={canOpenPatient ? openPatient : undefined}
                  role={canOpenPatient ? "button" : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-900 truncate">{t.title}</span>
                        {canOpenPatient ? <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" /> : null}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {t.assignedTeamId != null && t.assignedToUserId == null ? "Team task" : (t.taskType ?? "task")}
                        {view === "manager" && t.assignedToUsername ? ` · ${t.assignedToUsername}` : ""}
                        {dueLabel ? ` · due ${dueLabel}` : ""}
                        {typeof t.ageDays === "number" ? ` · ${t.ageDays}d old` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {overdue ? <SketchBadge tone="red">overdue</SketchBadge> : null}
                      {t.priorityLevel ? (
                        <SketchBadge tone={priorityLevelTone(t.priorityLevel)}>{t.priorityLevel}</SketchBadge>
                      ) : null}
                      {t.status && <SketchBadge tone={taskStatusTone(t.status)}>{t.status}</SketchBadge>}
                    </div>
                  </div>
                  {t.description ? (
                    <div className="mt-1 text-[11px] text-slate-700 line-clamp-3">{t.description}</div>
                  ) : null}
                  {isTeamPoolClaimable ? (
                    <div className="mt-1.5">
                      <SketchButton
                        size="sm"
                        seedId={`claim-${t.id}`}
                        onClick={(e) => { e.stopPropagation(); claimMutation.mutate(t.id); }}
                        disabled={claimMutation.isPending}
                        data-testid={`plexus-task-claim-${t.id}`}
                      >
                        <Hand className="mr-1 h-3 w-3" /> Claim
                      </SketchButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SketchSurface>
    </div>
  );
}

function priorityLevelTone(level: string): "graphite" | "blue" | "green" | "gold" | "red" {
  switch (level.toUpperCase()) {
    case "P1": return "red";
    case "P2": return "gold";
    case "P3": return "blue";
    default: return "graphite";
  }
}

function taskStatusTone(status: string): "graphite" | "blue" | "green" | "gold" | "red" {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("complete") || s.includes("closed")) return "green";
  if (s.includes("progress") || s.includes("active") || s.includes("open")) return "blue";
  if (s.includes("block") || s.includes("overdue") || s.includes("fail")) return "red";
  if (s.includes("pending") || s.includes("wait") || s.includes("hold")) return "gold";
  return "graphite";
}
