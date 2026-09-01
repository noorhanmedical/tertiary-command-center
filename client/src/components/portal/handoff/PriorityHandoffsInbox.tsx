// Priority / Team Handoffs inbox (Phase 5C / K11).
//
// The receiving PCS's inbound handoffs, rendered as a DISTINCT section above
// standard assigned work — never mixed invisibly into the normal queue. P1/P2
// require acknowledgement before completion (K10). Reads GET
// /api/engagement/handoffs/inbox; acts via POST /:id/acknowledge|complete.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowDownToLine } from "lucide-react";
import {
  SketchSurface, SketchSectionHeader, SketchBadge, SketchButton,
} from "@/components/playground/sketch/SketchPrimitives";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Handoff = {
  id: number;
  executionCaseId: number;
  patientScreeningId: number | null;
  fromUserId: string | null;
  priorityLevel: string;
  reason: string;
  note: string | null;
  dueAt: string | null;
  status: string;
  acknowledgedAt: string | null;
  // Phase 6B — SLA exposure (age / overdue / awaiting-ack). Present on the
  // inbox read; drives the overdue indicator (no auto-escalation).
  sla?: {
    ageMs: number;
    isOverdue: boolean;
    awaitingAck: boolean;
    overdueForAck: boolean;
  };
};

function requiresAck(pl: string): boolean {
  return pl === "P1" || pl === "P2";
}

export function PriorityHandoffsInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery<Handoff[]>({
    queryKey: ["/api/engagement/handoffs/inbox"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/handoffs/inbox", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load handoffs");
      return res.json();
    },
    refetchInterval: 20_000,
  });

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "acknowledge" | "complete" }) =>
      apiRequest("POST", `/api/engagement/handoffs/${id}/${action}`, {}),
    onSuccess: (_r, vars) => {
      toast({ title: vars.action === "acknowledge" ? "Acknowledged" : "Completed" });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement/handoffs/inbox"] });
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  // Only show the section when there ARE inbound handoffs (keeps the queue
  // clean); loading is quiet.
  if (isLoading || data.length === 0) return null;

  return (
    <div className="mb-2" data-testid="priority-handoffs-inbox">
      <SketchSectionHeader
        seedId="handoffs-inbox-header"
        icon={<ArrowDownToLine className="h-4 w-4" />}
        title="Priority / Team Handoffs"
        right={<span className="text-[10px] text-slate-500">{data.length}</span>}
      />
      <SketchSurface seedId="handoffs-inbox-list" padded className="space-y-1.5">
        {data.map((h) => {
          const needsAck = requiresAck(h.priorityLevel) && !h.acknowledgedAt;
          return (
            <div key={h.id} className="rounded-lg border border-l-2 px-2 py-1.5"
                 style={{ borderColor: "rgba(148,163,184,0.35)", borderLeftColor: h.priorityLevel === "P1" ? "#b91c1c" : "#b45309" }}
                 data-testid={`handoff-inbox-${h.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SketchBadge tone={h.priorityLevel === "P1" ? "red" : h.priorityLevel === "P2" ? "gold" : "blue"}>{h.priorityLevel}</SketchBadge>
                  <span className="truncate text-xs font-medium text-slate-900">{h.reason}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Phase 6B — overdue / awaiting-ack SLA indicator. */}
                  {h.sla?.overdueForAck ? (
                    <SketchBadge tone="red" data-testid={`handoff-overdue-${h.id}`}>overdue ack</SketchBadge>
                  ) : h.sla?.isOverdue ? (
                    <SketchBadge tone="red" data-testid={`handoff-overdue-${h.id}`}>overdue</SketchBadge>
                  ) : null}
                  <SketchBadge tone={h.status === "acknowledged" ? "green" : "graphite"}>{h.status}</SketchBadge>
                </div>
              </div>
              {h.note ? <div className="mt-0.5 text-[11px] text-slate-600 line-clamp-2">{h.note}</div> : null}
              <div className="mt-1 flex items-center gap-1.5">
                {needsAck ? (
                  <SketchButton size="sm" seedId={`ack-${h.id}`} onClick={() => act.mutate({ id: h.id, action: "acknowledge" })} disabled={act.isPending} data-testid={`handoff-ack-${h.id}`}>
                    Acknowledge
                  </SketchButton>
                ) : (
                  <SketchButton size="sm" variant="secondary" seedId={`done-${h.id}`} onClick={() => act.mutate({ id: h.id, action: "complete" })} disabled={act.isPending} data-testid={`handoff-complete-${h.id}`}>
                    Complete
                  </SketchButton>
                )}
                {h.dueAt ? (
                  <span className="text-[10px] text-slate-500">due {new Date(h.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </SketchSurface>
    </div>
  );
}
