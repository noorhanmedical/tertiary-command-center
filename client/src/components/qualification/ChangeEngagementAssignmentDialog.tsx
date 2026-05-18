import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Dialog for changing the engagement (scheduler) assignment of a
// patient. Writes through POST /api/patients/:id/engagement-assignment
// which updates patient_execution_cases.assignedTeamMemberId and
// appends a patient_journey_events row.

export type ChangeEngagementAssignmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number;
  currentSchedulerId: number | null;
};

type OptionsResponse = {
  patientFacility: string;
  schedulers: Array<{
    id: number;
    name: string;
    facility: string;
    capacityPercent: number;
    matchesFacility: boolean;
    onPtoToday?: boolean;
  }>;
};

export function ChangeEngagementAssignmentDialog({
  open,
  onOpenChange,
  patientId,
  currentSchedulerId,
}: ChangeEngagementAssignmentDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(currentSchedulerId);
  const [reason, setReason] = useState("");

  const { data: options, isLoading } = useQuery<OptionsResponse>({
    queryKey: ["engagement-assignment-options", patientId],
    queryFn: async () => {
      const res = await fetch(
        `/api/patients/${patientId}/engagement-assignment/options`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return (await res.json()) as OptionsResponse;
    },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (selectedId == null) throw new Error("Pick a scheduler first");
      const res = await fetch(
        `/api/patients/${patientId}/engagement-assignment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schedulerId: selectedId,
            reason: reason.trim() || undefined,
          }),
        },
      );
      const text = await res.text();
      let parsed: any = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        /* noop */
      }
      if (!res.ok) {
        throw new Error(parsed?.error ?? `Request failed (${res.status})`);
      }
      return parsed;
    },
    onSuccess: () => {
      toast({ title: "Assignment updated" });
      queryClient.invalidateQueries({ queryKey: ["engagement-assignment", patientId] });
      queryClient.invalidateQueries({ queryKey: ["portal-command-center", patientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });
      onOpenChange(false);
      setReason("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update assignment",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-md" data-testid="change-engagement-assignment-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Change engagement assignment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading || !options ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading options…
            </div>
          ) : (
            <>
              <div className="text-[11px] text-slate-500">
                Patient facility:{" "}
                <span className="font-medium text-slate-700">
                  {options.patientFacility || "—"}
                </span>
                {" "}— facility match first, then capacity, then name.
              </div>
              <ul className="space-y-1 max-h-60 overflow-y-auto pr-1">
                {options.schedulers.map((s) => {
                  const isCurrent = s.id === currentSchedulerId;
                  const isSelected = selectedId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? "border-indigo-300 bg-indigo-50"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                        data-testid={`change-engagement-assignment-option-${s.id}`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900 truncate">
                            {s.name}
                            {isCurrent && (
                              <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                                (current)
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {s.facility}
                            {s.matchesFacility ? " · same clinic" : ""}
                            {" · "}capacity {s.capacityPercent}%
                            {s.onPtoToday && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0 text-amber-800">
                                on PTO today
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Reason (optional)
                </Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. patient requested specific caller"
                  className="mt-1 h-8 text-xs"
                  data-testid="input-change-engagement-assignment-reason"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending || selectedId == null || selectedId === currentSchedulerId
            }
            className="gap-1.5"
            data-testid="button-change-engagement-assignment-submit"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
