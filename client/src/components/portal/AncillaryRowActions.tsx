// AncillaryRowActions — compact per-row action cluster for the Team Portal
// ancillary schedule: Phone · Calendar · Assignee.
//
// All three REUSE existing canonical infrastructure — no new dialing system,
// no legacy BookingDialogs, no new assignment model:
//   • Phone    → onCall(): the shell opens the existing canonical patient
//                calling workflow (Playground "call" workspace), which dials
//                through the phone-provider abstraction (manual tel: today,
//                RingCentral when live) and records disposition via the
//                engagement-center flow. executionCaseId + ancillaryCaseId are
//                carried by the shell into that workspace.
//   • Calendar → the canonical reschedule transition
//                (POST /api/global-schedule-events/:id/transition, reschedule)
//                via useScheduleEventTransition. The server preserves
//                parentEventId lineage and the ancillary episode; readiness
//                stays attached to the episode, not the old event id.
//   • Assignee → SchedulerIcon (avatar/initials + TaskDrawer selector), keyed
//                by patientScreeningId. Display-only when there is no screening.

import { useState } from "react";
import { Phone, CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SchedulerIcon } from "@/components/plexus/SchedulerIcon";
import { useScheduleEventTransition } from "@/lib/workflow/scheduleEventTransitionApi";

type Props = {
  /** global_schedule_events id — the reschedule target. Reschedule is only
   *  offered when this is a real numeric event id. */
  eventId: number | null;
  patientScreeningId: number | null;
  patientName: string | null;
  serviceType: string | null;
  startsAt: string | null;
  /** Whether this workspace may call + reschedule (PCS/scheduler-capable). */
  canSchedule: boolean;
  /** Opens the canonical patient calling workflow for this case. */
  onCall: () => void;
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time.
function toLocalInputValue(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AncillaryRowActions({
  eventId,
  patientScreeningId,
  patientName,
  serviceType,
  startsAt,
  canSchedule,
  onCall,
}: Props) {
  const { toast } = useToast();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newStartsAt, setNewStartsAt] = useState<string>("");
  const transition = useScheduleEventTransition();

  const canReschedule = canSchedule && typeof eventId === "number";

  const openReschedule = () => {
    setNewStartsAt(toLocalInputValue(startsAt));
    setRescheduleOpen(true);
  };

  const submitReschedule = () => {
    if (typeof eventId !== "number") return;
    if (!newStartsAt) {
      toast({ title: "Pick a new date and time", variant: "destructive" });
      return;
    }
    const iso = new Date(newStartsAt).toISOString();
    transition.mutate(
      { eventId, transition: "reschedule", newStartsAt: iso },
      {
        onSuccess: () => {
          toast({ title: "Ancillary rescheduled" });
          setRescheduleOpen(false);
        },
        onError: (e: unknown) =>
          toast({
            title: "Could not reschedule",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {canSchedule && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCall();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          title="Call patient"
          aria-label={`Call patient${patientName ? ` ${patientName}` : ""}`}
          data-testid={`ancillary-action-phone-${eventId ?? "na"}`}
        >
          <Phone className="h-4 w-4" />
        </button>
      )}

      {canReschedule && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openReschedule();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          title="Reschedule this ancillary"
          aria-label={`Reschedule ${serviceType ?? "ancillary"}${patientName ? ` for ${patientName}` : ""}`}
          data-testid={`ancillary-action-reschedule-${eventId ?? "na"}`}
        >
          <CalendarClock className="h-4 w-4" />
        </button>
      )}

      {patientScreeningId != null ? (
        <span onClick={(e) => e.stopPropagation()}>
          <SchedulerIcon
            patientScreeningId={patientScreeningId}
            patientName={patientName ?? undefined}
            size="sm"
          />
        </span>
      ) : (
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-500"
          title="No patient chart — assignment unavailable"
          data-testid={`ancillary-action-assignee-none-${eventId ?? "na"}`}
        >
          ?
        </span>
      )}

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-sm z-[95]" data-testid="ancillary-reschedule-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Reschedule ancillary</DialogTitle>
            <p className="text-xs text-slate-500">
              {patientName}
              {serviceType ? ` · ${serviceType}` : ""}
            </p>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-xs font-semibold text-slate-700">New date &amp; time</Label>
              <Input
                type="datetime-local"
                value={newStartsAt}
                onChange={(e) => setNewStartsAt(e.target.value)}
                className="mt-1.5 rounded-xl text-sm"
                data-testid="ancillary-reschedule-startsAt"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRescheduleOpen(false)}
                data-testid="ancillary-reschedule-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={transition.isPending}
                onClick={submitReschedule}
                data-testid="ancillary-reschedule-submit"
              >
                {transition.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving…
                  </>
                ) : (
                  "Reschedule"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
