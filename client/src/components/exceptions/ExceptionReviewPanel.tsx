// ExceptionReviewPanel — Phase 3 PR 3.3.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchException, fetchReviewEvents,
  postAcknowledge, postAssign, postNote, postDismiss, postResolve, postReopen,
  type ExceptionRow, SEVERITY_TONE,
} from "@/lib/exceptionsApi";
import {
  fetchAiRecommendations, PROVIDER_TONE, CONFIDENCE_TONE,
  type AiRecommendation,
} from "@/lib/aiRecommendationsApi";

type Props = { exceptionId: number };

export function ExceptionReviewPanel({ exceptionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: ex, isLoading } = useQuery<ExceptionRow>({
    queryKey: ["exception", exceptionId],
    queryFn: () => fetchException(exceptionId),
  });
  const { data: events = [] } = useQuery<any[]>({
    queryKey: ["exception-review-events", exceptionId],
    queryFn: () => fetchReviewEvents(exceptionId) as Promise<any[]>,
  });
  const { data: recs = [] } = useQuery<AiRecommendation[]>({
    queryKey: ["exception-recommendations", exceptionId],
    queryFn: () => fetchAiRecommendations({ exceptionSnapshotId: exceptionId }),
  });

  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [assignToUser, setAssignToUser] = useState("");
  const [assignRole, setAssignRole] = useState("");

  const inv = (k: ReadonlyArray<string | number>) => queryClient.invalidateQueries({ queryKey: k });
  const onSuccess = (label: string) => () => {
    toast({ title: label });
    inv(["exception", exceptionId]);
    inv(["exception-review-events", exceptionId]);
    inv(["exceptions"]);
  };
  const onError = (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" });

  const ackMut = useMutation({ mutationFn: () => postAcknowledge(exceptionId), onSuccess: onSuccess("Acknowledged"), onError });
  const assignMut = useMutation({
    mutationFn: () => postAssign(exceptionId, { assignedToUserId: assignToUser || undefined, assignedRole: assignRole || undefined }),
    onSuccess: () => { onSuccess("Assigned")(); setAssignToUser(""); setAssignRole(""); }, onError,
  });
  const noteMut = useMutation({
    mutationFn: () => postNote(exceptionId, note),
    onSuccess: () => { onSuccess("Note added")(); setNote(""); }, onError,
  });
  const dismissMut = useMutation({
    mutationFn: () => postDismiss(exceptionId, reason),
    onSuccess: () => { onSuccess("Dismissed")(); setReason(""); }, onError,
  });
  const resolveMut = useMutation({
    mutationFn: () => postResolve(exceptionId, reason),
    onSuccess: () => { onSuccess("Resolved")(); setReason(""); }, onError,
  });
  const reopenMut = useMutation({ mutationFn: () => postReopen(exceptionId), onSuccess: onSuccess("Reopened"), onError });

  if (isLoading || !ex) {
    return (
      <Card className="p-3 bg-white"><div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading exception…</div></Card>
    );
  }

  const isClosed = ex.status === "resolved" || ex.status === "dismissed";
  const isSuperseded = ex.status === "superseded";
  const canMutate = !isClosed && !isSuperseded;

  return (
    <Card className="p-4 bg-white" data-testid={`exception-detail-${exceptionId}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${SEVERITY_TONE[ex.severity] ?? ""}`}>{ex.severity}</span>
        <Badge variant="outline" className="text-[10px]" data-testid={`exception-status-${exceptionId}`}>{ex.status}</Badge>
        <div className="text-sm font-semibold text-slate-900">{ex.title}</div>
      </div>
      <div className="text-[12px] text-slate-700 mb-2">{ex.explanation}</div>

      <div className="flex flex-wrap gap-2 mb-3">
        {ex.status === "open" && (
          <Button size="sm" onClick={() => ackMut.mutate()} disabled={ackMut.isPending} data-testid={`exception-acknowledge-${exceptionId}`}>Acknowledge</Button>
        )}
        {canMutate && (
          <>
            <Input value={assignToUser} onChange={(e) => setAssignToUser(e.target.value)} placeholder="user id" className="h-8 w-[140px] text-xs" data-testid={`exception-assign-user-${exceptionId}`} />
            <Input value={assignRole} onChange={(e) => setAssignRole(e.target.value)} placeholder="role" className="h-8 w-[100px] text-xs" data-testid={`exception-assign-role-${exceptionId}`} />
            <Button size="sm" variant="outline" disabled={(!assignToUser && !assignRole) || assignMut.isPending} onClick={() => assignMut.mutate()} data-testid={`exception-assign-${exceptionId}`}>Assign</Button>
          </>
        )}
        {isClosed && (
          <Button size="sm" variant="outline" disabled={reopenMut.isPending} onClick={() => reopenMut.mutate()} data-testid={`exception-reopen-${exceptionId}`}>Reopen</Button>
        )}
      </div>

      {canMutate && (
        <div className="flex flex-wrap gap-2 mb-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="h-8 flex-1 text-xs" data-testid={`exception-note-input-${exceptionId}`} />
          <Button size="sm" variant="outline" disabled={!note.trim() || noteMut.isPending} onClick={() => noteMut.mutate()} data-testid={`exception-add-note-${exceptionId}`}>Add note</Button>
        </div>
      )}

      {canMutate && (
        <div className="flex flex-wrap gap-2 mb-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (required for resolve / dismiss)" className="h-8 flex-1 text-xs" data-testid={`exception-reason-input-${exceptionId}`} />
          <Button size="sm" disabled={!reason.trim() || resolveMut.isPending} onClick={() => resolveMut.mutate()} data-testid={`exception-resolve-${exceptionId}`}>Resolve</Button>
          <Button size="sm" variant="ghost" disabled={!reason.trim() || dismissMut.isPending} onClick={() => dismissMut.mutate()} data-testid={`exception-dismiss-${exceptionId}`}>Dismiss</Button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 text-[11px] text-slate-600 mb-2">
        <div>Type: {ex.exceptionType}</div>
        <div>Entity: {ex.entityType} #{ex.entityId ?? "—"}</div>
        <div>Facility: {ex.facilityId ?? "—"}</div>
        <div>Owner role: {ex.recommendedOwnerRole ?? "—"}</div>
        <div>Detected: {new Date(ex.detectedAt).toLocaleString()}</div>
        <div>Last seen: {new Date(ex.lastSeenAt).toLocaleString()}</div>
        {ex.assignedRole ? <div>Assigned role: {ex.assignedRole}</div> : null}
        {ex.assignedToUserId ? <div>Assigned user: {ex.assignedToUserId}</div> : null}
        {ex.resolutionReason ? <div className="sm:col-span-2">Resolution: {ex.resolutionReason}</div> : null}
        {ex.dismissedReason ? <div className="sm:col-span-2">Dismissed: {ex.dismissedReason}</div> : null}
      </div>

      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer text-slate-500">source snapshot</summary>
        <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(ex.sourceSnapshot, null, 2)}</pre>
      </details>
      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer text-slate-500">policy snapshot</summary>
        <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(ex.policySnapshot, null, 2)}</pre>
      </details>

      {recs.length > 0 && (
        <div className="mt-3" data-testid={`exception-recommendations-${exceptionId}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Recommendations</div>
          <ul className="space-y-2">
            {recs.map((r) => (
              <li key={r.id} className="border rounded p-2" data-testid={`exception-recommendation-${r.id}`}>
                <div className="flex flex-wrap items-center gap-1 mb-1">
                  <Badge variant="outline" className={`text-[10px] ${PROVIDER_TONE[r.modelProvider]}`}>{r.modelProvider}</Badge>
                  <Badge variant="outline" className={`text-[10px] ${CONFIDENCE_TONE[r.confidenceLabel]}`}>{r.confidenceLabel}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <span className="text-[11px] text-slate-500">{r.recommendedAction}</span>
                </div>
                <div className="text-[12px] font-semibold text-slate-900">{r.title}</div>
                <div className="text-[11px] text-slate-700">{r.body}</div>
                <div className="text-[10px] text-slate-500 mt-1">rationale: {r.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-3" data-testid={`exception-review-events-${exceptionId}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Review events</div>
          <ul className="space-y-1">
            {events.map((e: any) => (
              <li key={e.id} className="text-[11px] text-slate-700 flex gap-2" data-testid={`exception-review-event-${e.id}`}>
                <Badge variant="outline" className="text-[10px]">{e.eventType}</Badge>
                <span>{new Date(e.createdAt).toLocaleString()}</span>
                {e.note ? <span>· {e.note}</span> : null}
                {e.reason ? <span className="text-rose-700">· {e.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
