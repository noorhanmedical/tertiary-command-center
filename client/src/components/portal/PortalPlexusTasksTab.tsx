import { useQuery } from "@tanstack/react-query";
import { Loader2, ClipboardList } from "lucide-react";
import {
  SketchSurface,
  SketchSectionHeader,
  SketchBadge,
} from "@/components/playground/sketch/SketchPrimitives";

// Plexus Tasks tab — embeds the canonical Plexus task feed for the
// session user (or a single patient when one is selected). Reads
// /api/plexus/tasks/by-patient/:patientId or /api/plexus/tasks/my-work
// depending on context. Does not create a parallel task system.

type PlexusTask = {
  id: number;
  title: string;
  description: string | null;
  taskType: string | null;
  urgency: string | null;
  priority: string | null;
  status: string | null;
  dueDate: string | null;
  patientScreeningId: number | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
};

async function getTasks(url: string): Promise<PlexusTask[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Tasks request failed (${res.status})`);
  return (await res.json()) as PlexusTask[];
}

export function PortalPlexusTasksTab({
  patientScreeningId,
}: {
  patientScreeningId: number | null;
}) {
  const url = patientScreeningId
    ? `/api/plexus/tasks/by-patient/${patientScreeningId}`
    : `/api/plexus/tasks/my-work`;

  const { data = [], isLoading, isError, error } = useQuery<PlexusTask[]>({
    queryKey: ["portal-plexus-tasks", url],
    queryFn: () => getTasks(url),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden bg-transparent p-4" data-testid="portal-plexus-tasks">
      <SketchSectionHeader
        seedId="plexus-tasks-header"
        icon={<ClipboardList className="h-4 w-4" />}
        title={patientScreeningId ? "Patient Plexus tasks" : "My Plexus tasks"}
        right={<span className="text-[10px] font-normal text-slate-500">Canonical: plexus_tasks</span>}
      />

      <SketchSurface seedId="plexus-tasks-list" className="flex-1 min-h-0 overflow-y-auto" padded>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
          </div>
        ) : isError ? (
          <div className="text-xs text-rose-700 py-2">
            {error instanceof Error ? error.message : "Failed to load tasks"}
          </div>
        ) : data.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            No tasks {patientScreeningId ? "for this patient" : "assigned to you"}.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/60" data-testid="portal-plexus-tasks-list">
            {data.map((t) => (
              <li
                key={t.id}
                className="px-1 py-2.5"
                data-testid={`portal-plexus-task-${t.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">{t.title}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {t.taskType ?? "task"}
                      {t.urgency ? ` · ${t.urgency}` : ""}
                      {t.dueDate ? ` · due ${t.dueDate}` : ""}
                    </div>
                  </div>
                  {t.status && (
                    <SketchBadge tone={taskStatusTone(t.status)}>{t.status}</SketchBadge>
                  )}
                </div>
                {t.description ? (
                  <div className="mt-1 text-[11px] text-slate-700 line-clamp-3">{t.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SketchSurface>
    </div>
  );
}

// Map a task status to a muted colored-pencil tone.
function taskStatusTone(status: string): "graphite" | "blue" | "green" | "gold" | "red" {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("complete") || s.includes("closed")) return "green";
  if (s.includes("progress") || s.includes("active") || s.includes("open")) return "blue";
  if (s.includes("block") || s.includes("overdue") || s.includes("fail")) return "red";
  if (s.includes("pending") || s.includes("wait") || s.includes("hold")) return "gold";
  return "graphite";
}
