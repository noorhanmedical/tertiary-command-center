import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type AuditItem = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string | null;
  facility: string | null;
  assignedTeamMemberId: number | null;
  schedulerName: string | null;
  schedulerUserId: string | null;
  engagementStatus: string | null;
  nextActionAt: string | null;
  lastCallOutcome: string | null;
  visibility: string;
  blocker: string | null;
};

type SchedulerMappingRow = {
  schedulerId: number;
  schedulerName: string;
  facility: string | null;
  mapped: boolean;
  username: string | null;
  suggestedUsername: string | null;
  suggestionReason: string | null;
};

type AuditResponse = {
  generatedAt: string;
  totalAssignedActive: number;
  counts: Record<string, number>;
  schedulerMapping: SchedulerMappingRow[];
  items: AuditItem[];
};

const VISIBILITY_STYLE: Record<string, string> = {
  visible: "bg-emerald-100 text-emerald-800 border-emerald-200",
  visible_but_overdue: "bg-amber-100 text-amber-800 border-amber-200",
  missing_user_mapping: "bg-rose-100 text-rose-800 border-rose-200",
  missing_next_action_at: "bg-orange-100 text-orange-800 border-orange-200",
  missing_patient: "bg-rose-100 text-rose-800 border-rose-200",
  needs_admin_review: "bg-violet-100 text-violet-800 border-violet-200",
  assigned_scheduler_missing: "bg-rose-100 text-rose-800 border-rose-200",
};

export default function CallListAuditPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState<unknown>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery<AuditResponse>({
    queryKey: ["/api/admin/call-list-audit"],
  });

  const runDryRun = async () => {
    setDryRunLoading(true);
    try {
      const res = await apiRequest(
        "POST",
        "/api/admin/call-list-audit/repair/dry-run",
        {},
      );
      const json = await res.json();
      setDryRun(json);
      toast({ title: "Dry-run complete", description: "No changes were written." });
    } catch (e: any) {
      toast({
        title: "Dry-run failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDryRunLoading(false);
    }
  };

  return (
    <div className={embedded ? "flex h-full w-full flex-col overflow-y-auto p-6" : "mx-auto max-w-6xl px-6 py-8"} data-testid="page-call-list-audit">
      <div className="mb-6 flex items-center justify-between">
        <div>
          {!embedded && <h1 className="text-2xl font-semibold text-slate-900">Call List Audit</h1>}
          <p className="mt-1 text-sm text-slate-500">
            Diagnoses why engagement-assigned work may not appear on a team
            member's call list. Source of truth: patient execution cases.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh-audit"
          >
            Refresh
          </Button>
          <Button
            onClick={runDryRun}
            disabled={dryRunLoading}
            data-testid="button-dry-run-repair"
          >
            {dryRunLoading ? "Running…" : "Dry-run repair"}
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Loading audit…</div>}

      {data && (
        <>
          <div className="mb-6 flex flex-wrap gap-2" data-testid="audit-counts">
            <Badge variant="outline" className="rounded-full">
              {data.totalAssignedActive} assigned active
            </Badge>
            {Object.entries(data.counts).map(([k, v]) => (
              <Badge
                key={k}
                className={`rounded-full border ${VISIBILITY_STYLE[k] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}
                data-testid={`count-${k}`}
              >
                {k.replace(/_/g, " ")}: {v}
              </Badge>
            ))}
          </div>

          <section className="mb-8">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Scheduler → user mapping
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Scheduler</th>
                    <th className="px-3 py-2">Facility</th>
                    <th className="px-3 py-2">Linked user</th>
                    <th className="px-3 py-2">Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.schedulerMapping.map((m) => (
                    <tr
                      key={m.schedulerId}
                      className="border-t border-slate-100"
                      data-testid={`mapping-row-${m.schedulerId}`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {m.schedulerName}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{m.facility ?? "—"}</td>
                      <td className="px-3 py-2">
                        {m.mapped ? (
                          <Badge className="rounded-full border bg-emerald-100 text-emerald-800 border-emerald-200">
                            {m.username ?? "linked"}
                          </Badge>
                        ) : (
                          <Badge className="rounded-full border bg-rose-100 text-rose-800 border-rose-200">
                            unmapped
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {m.mapped ? "—" : m.suggestionReason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Assigned cases
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Patient</th>
                    <th className="px-3 py-2">Scheduler</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Next action</th>
                    <th className="px-3 py-2">Visibility</th>
                    <th className="px-3 py-2">Blocker</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr
                      key={it.executionCaseId}
                      className="border-t border-slate-100"
                      data-testid={`audit-row-${it.executionCaseId}`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {it.patientName ?? `Case #${it.executionCaseId}`}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {it.schedulerName ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {it.engagementStatus ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {it.nextActionAt
                          ? new Date(it.nextActionAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          className={`rounded-full border ${VISIBILITY_STYLE[it.visibility] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}
                        >
                          {it.visibility.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{it.blocker ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {dryRun != null && (
            <section className="mt-8">
              <h2 className="mb-2 text-lg font-semibold text-slate-900">
                Dry-run proposals (no changes written)
              </h2>
              <pre
                className="max-h-96 overflow-auto rounded-2xl border border-slate-200 bg-slate-900 p-4 text-xs text-slate-100"
                data-testid="dry-run-output"
              >
                {JSON.stringify(dryRun, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
