// Handoff dialog (Phase 5C / decisions K6, K9, K10).
//
// A PCS hands a call-list patient to an eligible teammate: choose recipient →
// see their canonical workload/capacity (via the eligibility pre-check) →
// choose P1–P5 → dueAt → reason/note → confirm. P1/P2 require the recipient to
// acknowledge (surfaced as a note). Concurrency: the confirm surfaces the
// server's structured conflict (over-capacity / facility mismatch / race)
// rather than fabricating success.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type RosterEntry = { id: string; username: string; role: string | null };
const P_LEVELS = ["P1", "P2", "P3", "P4", "P5"] as const;

type Eligibility = {
  eligible: boolean;
  code: string;
  reason: string;
  recipientCapacity?: {
    dailyCallCapacity: number;
    assigned: number;
    remainingCapacity: number;
    overCapacityAfter: number;
    workingToday: boolean;
  };
};

export function HandoffDialog({
  open,
  onOpenChange,
  executionCaseId,
  facilityId,
  patientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  executionCaseId: number;
  facilityId: string | null;
  patientName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [toUserId, setToUserId] = useState<string>("");
  const [priorityLevel, setPriorityLevel] = useState<(typeof P_LEVELS)[number]>("P3");
  const [dueAt, setDueAt] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const rosterQuery = useQuery<{ roster: RosterEntry[] }>({
    queryKey: ["/api/messaging/roster"],
    queryFn: async () => {
      const res = await fetch("/api/messaging/roster", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load teammates");
      return res.json();
    },
    enabled: open,
  });
  const roster = rosterQuery.data?.roster ?? [];

  // Live eligibility + recipient workload for the chosen recipient/priority.
  const eligibilityQuery = useQuery<Eligibility>({
    queryKey: ["/api/engagement/handoffs/eligibility", toUserId, facilityId, priorityLevel],
    queryFn: async () => {
      const url = new URL("/api/engagement/handoffs/eligibility", window.location.origin);
      url.searchParams.set("toUserId", toUserId);
      if (facilityId) url.searchParams.set("facilityId", facilityId);
      url.searchParams.set("priorityLevel", priorityLevel);
      const res = await fetch(url.pathname + url.search, { credentials: "include" });
      if (!res.ok) throw new Error("Eligibility check failed");
      return res.json();
    },
    enabled: open && !!toUserId,
  });
  const elig = eligibilityQuery.data;

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/engagement/handoffs", {
        executionCaseId,
        toUserId,
        priorityLevel,
        reason: reason.trim(),
        note: note.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Handoff sent", description: `${patientName} handed to teammate (${priorityLevel}).` });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement/handoffs/inbox"] });
      onOpenChange(false);
      reset();
    },
    onError: async (e: unknown) => {
      // Surface the server's structured conflict (over-capacity / facility
      // mismatch / lost race) instead of a generic failure.
      const msg = e instanceof Error ? e.message : "Handoff failed";
      toast({ title: "Handoff not completed", description: msg, variant: "destructive" });
    },
  });

  function reset() {
    setToUserId(""); setPriorityLevel("P3"); setDueAt(""); setReason(""); setNote("");
  }

  const requiresAck = priorityLevel === "P1" || priorityLevel === "P2";
  const canConfirm = !!toUserId && reason.trim().length > 0 && (elig?.eligible ?? false) && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md" data-testid="handoff-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4" /> Hand off — {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Recipient</label>
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger data-testid="handoff-recipient"><SelectValue placeholder="Choose a teammate" /></SelectTrigger>
              <SelectContent>
                {roster.map((r) => <SelectItem key={r.id} value={r.id}>{r.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priorityLevel} onValueChange={(v) => setPriorityLevel(v as (typeof P_LEVELS)[number])}>
                <SelectTrigger data-testid="handoff-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{P_LEVELS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">Due</label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} data-testid="handoff-due" />
            </div>
          </div>

          {/* Recipient workload / eligibility (canonical, from the pre-check). */}
          {toUserId ? (
            eligibilityQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking recipient…</div>
            ) : elig ? (
              <div className={`rounded-md border p-2 text-xs ${elig.eligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} data-testid="handoff-eligibility">
                <div className="font-medium">{elig.eligible ? "Eligible" : "Not eligible"}</div>
                <div className="text-muted-foreground">{elig.reason}</div>
                {elig.recipientCapacity ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="outline">cap {elig.recipientCapacity.dailyCallCapacity}</Badge>
                    <Badge variant="outline">assigned {elig.recipientCapacity.assigned}</Badge>
                    <Badge variant="outline">remaining {elig.recipientCapacity.remainingCapacity}</Badge>
                    {elig.recipientCapacity.overCapacityAfter > 0 ? (
                      <Badge variant="destructive">over-cap +{elig.recipientCapacity.overCapacityAfter}</Badge>
                    ) : null}
                    {!elig.recipientCapacity.workingToday ? <Badge variant="destructive">not working</Badge> : null}
                  </div>
                ) : null}
              </div>
            ) : null
          ) : null}

          {requiresAck ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-800" data-testid="handoff-ack-note">
              {priorityLevel} handoffs require the recipient to acknowledge before they can complete it.
            </div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (required)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being handed off?" data-testid="handoff-reason" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="handoff-note" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!canConfirm} data-testid="handoff-confirm">
              {createMutation.isPending ? "Sending…" : "Send handoff"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
