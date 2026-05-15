import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, ClipboardList } from "lucide-react";

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
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-4" data-testid="portal-plexus-tasks">
      <Card className="p-3 bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          {patientScreeningId ? "Patient Plexus tasks" : "My Plexus tasks"}
          <span className="ml-auto text-[10px] font-normal text-slate-500">
            Canonical: plexus_tasks
          </span>
        </div>
      </Card>

      <Card className="flex-1 min-h-0 p-3 bg-white overflow-y-auto">
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
          <ul className="space-y-1.5" data-testid="portal-plexus-tasks-list">
            {data.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2"
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
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                      {t.status}
                    </span>
                  )}
                </div>
                {t.description ? (
                  <div className="mt-1 text-[11px] text-slate-700 line-clamp-3">{t.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
