// Cancel-ancillary confirmation dialog for the Team Portal.
//
// Collects the REQUIRED cancellation reason and cancels the appointment
// through the canonical transition path
// (POST /api/global-schedule-events/:id/transition {transition:"cancel"}).
// The server rejects a blank reason with 400, so the confirm button stays
// disabled until a reason is entered.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useScheduleEventTransition } from "@/lib/workflow/scheduleEventTransitionApi";

export type CancelAncillaryTarget = {
  /** global_schedule_events id (the ancillary row `.id`). */
  eventId: number;
  patientName: string;
  serviceType: string | null;
};

export function CancelAncillaryDialog({
  target,
  onOpenChange,
}: {
  target: CancelAncillaryTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const transition = useScheduleEventTransition();

  useEffect(() => {
    if (target) setReason("");
  }, [target]);

  const canConfirm = reason.trim().length > 0 && !transition.isPending;

  function confirm() {
    if (!target || !canConfirm) return;
    transition.mutate(
      { eventId: target.eventId, transition: "cancel", reason: reason.trim() },
      {
        onSuccess: () => {
          toast({
            title: "Appointment cancelled",
            description: `${target.patientName}${target.serviceType ? ` · ${target.serviceType}` : ""}`,
          });
          onOpenChange(false);
        },
        onError: (e: unknown) =>
          toast({
            title: "Cancel failed",
            description: e instanceof Error ? e.message : "Could not cancel appointment",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="cancel-ancillary-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarX className="h-4 w-4 text-rose-600" /> Cancel appointment
          </DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Cancelling{" "}
                <span className="font-medium text-slate-700">{target.patientName}</span>
                {target.serviceType ? (
                  <>
                    {" "}·{" "}
                    <span className="font-medium text-slate-700">{target.serviceType}</span>
                  </>
                ) : null}
                . This writes through the canonical schedule-event path and reopens
                the scheduling need on the patient's case.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cancel-ancillary-reason">
            Cancellation reason <span className="text-rose-600">*</span>
          </label>
          <Textarea
            id="cancel-ancillary-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. patient requested reschedule, clinic closure, insurance issue"
            rows={3}
            data-testid="cancel-ancillary-reason"
          />
          <p className="text-[11px] text-slate-400">A reason is required to cancel.</p>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="cancel-ancillary-dismiss"
          >
            Keep appointment
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={confirm}
            data-testid="cancel-ancillary-confirm"
          >
            {transition.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Cancel appointment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
