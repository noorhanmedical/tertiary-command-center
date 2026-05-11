import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Maximize2 } from "lucide-react";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";

// Patient-specific scheduling popup opened from right-panel patient cards.
// Separate from Plexus IQ calendar — this surface only writes to
// global_schedule_events through the canonical
// /api/global-schedule-events/schedule-ancillary route.

export type SchedulePatientDialogPatient = {
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  serviceType?: string | null;
};

export type SchedulePatientDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: SchedulePatientDialogPatient | null;
  defaultDate?: string | null;
  onOpenInPlayground?: (payload: {
    patient: SchedulePatientDialogPatient;
    selectedDate: string;
  }) => void;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function evtRowLabel(evt: unknown): { title: string; sub: string } {
  const e = evt as { patientName?: string | null; serviceType?: string | null; startsAt?: string | null; status?: string | null };
  return {
    title: e.patientName ?? e.serviceType ?? "Event",
    sub: [fmtTime(e.startsAt ?? null), e.serviceType ?? "", e.status ?? ""].filter(Boolean).join(" · "),
  };
}

function EventList({
  label,
  rows,
  emptyText,
  testId,
}: {
  label: string;
  rows: unknown[];
  emptyText: string;
  testId: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label} {rows.length > 0 && <span className="ml-1 text-slate-400">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">{emptyText}</div>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 8).map((evt, idx) => {
            const r = evtRowLabel(evt);
            return (
              <li
                key={idx}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
              >
                <div className="font-medium text-slate-900 truncate">{r.title}</div>
                {r.sub && <div className="text-[10px] text-slate-500 truncate">{r.sub}</div>}
              </li>
            );
          })}
          {rows.length > 8 && (
            <li className="text-[10px] text-slate-400 italic">
              and {rows.length - 8} more…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function combineLocalDateAndTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export function SchedulePatientDialog({
  open,
  onOpenChange,
  patient,
  defaultDate,
  onOpenInPlayground,
}: SchedulePatientDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const initialDate =
    defaultDate && /^\d{4}-\d{2}-\d{2}/.test(defaultDate)
      ? defaultDate.slice(0, 10)
      : todayIso();
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [serviceType, setServiceType] = useState<string>(patient?.serviceType ?? "");
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Reset form when a new patient is opened.
  useEffect(() => {
    if (open) {
      setSelectedDate(initialDate);
      setServiceType(patient?.serviceType ?? "");
      setTime("");
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient?.patientScreeningId, patient?.executionCaseId]);

  const { data: dayContext, isLoading: contextLoading } = useQuery<PatientScheduleDayContext>({
    queryKey: [
      "schedule-patient-day-context",
      patient?.facilityId ?? null,
      patient?.patientScreeningId ?? null,
      patient?.executionCaseId ?? null,
      selectedDate,
    ],
    queryFn: () =>
      fetchPatientScheduleDayContext({
        facilityId: patient?.facilityId ?? null,
        patientScreeningId: patient?.patientScreeningId ?? null,
        executionCaseId: patient?.executionCaseId ?? null,
        selectedDate,
      }),
    enabled: open && !!patient,
  });

  const canSubmit = useMemo(() => {
    if (!patient) return false;
    if (!(patient.patientScreeningId ?? patient.executionCaseId)) return false;
    if (!serviceType.trim()) return false;
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [patient, serviceType, selectedDate, time]);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!patient) throw new Error("No patient selected");
      const startsAt = combineLocalDateAndTimeToIso(selectedDate, time);
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: patient.executionCaseId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        serviceType: serviceType.trim(),
        startsAt,
        facilityId: patient.facilityId ?? null,
        note: note.trim() || null,
        metadata: { source: "schedule_patient_dialog" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-workspace-ancillary-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-clinic-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-schedule-events"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-patient-day-context"] });
      toast({
        title: "Scheduled",
        description: `${serviceType.trim()} for ${patient?.patientName ?? "patient"}.`,
      });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not schedule",
        description: err instanceof Error ? err.message : "Schedule write failed.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        data-testid="dialog-schedule-patient"
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <DialogTitle>Schedule Patient</DialogTitle>
              <div className="text-xs text-slate-500 mt-1">
                {patient?.patientName ?? "Patient"}
                {patient?.patientDob ? ` · DOB ${patient.patientDob}` : ""}
                {patient?.facilityId ? ` · ${patient.facilityId}` : ""}
              </div>
            </div>
            {patient && onOpenInPlayground && (
              <button
                type="button"
                onClick={() => {
                  onOpenInPlayground({ patient, selectedDate });
                  onOpenChange(false);
                }}
                aria-label="Open in Playground"
                title="Open in Playground"
                className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                data-testid="button-schedule-patient-open-in-playground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label htmlFor="schedule-patient-date" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Date
              </Label>
              <Input
                id="schedule-patient-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1"
                data-testid="input-schedule-patient-date"
              />
            </div>
            <div>
              <Label htmlFor="schedule-patient-time" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Time
              </Label>
              <Input
                id="schedule-patient-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1"
                data-testid="input-schedule-patient-time"
              />
            </div>
            <div>
              <Label htmlFor="schedule-patient-service" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Service type
              </Label>
              <Input
                id="schedule-patient-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="e.g. BrainWave"
                className="mt-1"
                data-testid="input-schedule-patient-service-type"
              />
            </div>
            <div>
              <Label htmlFor="schedule-patient-note" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Note (optional)
              </Label>
              <Textarea
                id="schedule-patient-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 min-h-[80px]"
                placeholder="Anything the technician/scheduler should know"
                data-testid="textarea-schedule-patient-note"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Day at a glance · {selectedDate}
            </div>
            {contextLoading ? (
              <div className="text-xs text-slate-500 italic py-2">Loading day context…</div>
            ) : (
              <div className="space-y-3">
                <EventList
                  label="Clinic Schedule"
                  rows={dayContext?.clinicEvents ?? []}
                  emptyText="No clinic visits."
                  testId="schedule-patient-clinic-events"
                />
                <EventList
                  label="Ancillary Schedule"
                  rows={dayContext?.ancillaryEvents ?? []}
                  emptyText="No ancillary appointments."
                  testId="schedule-patient-ancillary-events"
                />
                <EventList
                  label="This patient"
                  rows={dayContext?.patientEvents ?? []}
                  emptyText="No existing events for this patient on this day."
                  testId="schedule-patient-patient-events"
                />
                <EventList
                  label="Availability / Blocks"
                  rows={dayContext?.availabilityBlocks ?? []}
                  emptyText="No availability blocks."
                  testId="schedule-patient-availability-blocks"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-schedule-patient-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || scheduleMutation.isPending}
            onClick={() => scheduleMutation.mutate()}
            className="gap-1.5"
            data-testid="button-schedule-patient-submit"
          >
            {scheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
