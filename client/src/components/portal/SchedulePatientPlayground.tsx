import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X } from "lucide-react";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import type { SchedulePatientDialogPatient } from "@/components/portal/SchedulePatientDialog";

// Expanded center-Playground scheduling view. Same data/write contracts as
// SchedulePatientDialog — pulls per-day events from global_schedule_events
// and writes through POST /api/global-schedule-events/schedule-ancillary.

export type SchedulePatientPlaygroundProps = {
  patient: SchedulePatientDialogPatient;
  selectedDate: string;
  onClose?: () => void;
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function combineLocalDateAndTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function evtTitle(evt: unknown): { title: string; sub: string } {
  const e = evt as { patientName?: string | null; serviceType?: string | null; startsAt?: string | null; status?: string | null };
  return {
    title: e.patientName ?? e.serviceType ?? "Event",
    sub: [fmtTime(e.startsAt ?? null), e.serviceType ?? "", e.status ?? ""].filter(Boolean).join(" · "),
  };
}

function EventColumn({
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
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3"
      data-testid={testId}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label} {rows.length > 0 && <span className="ml-1 text-slate-400">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">{emptyText}</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 16).map((evt, idx) => {
            const r = evtTitle(evt);
            return (
              <li
                key={idx}
                className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5 text-[11px] text-slate-700"
              >
                <div className="font-medium text-slate-900 truncate">{r.title}</div>
                {r.sub && <div className="text-[10px] text-slate-500 truncate">{r.sub}</div>}
              </li>
            );
          })}
          {rows.length > 16 && (
            <li className="text-[10px] text-slate-400 italic">
              and {rows.length - 16} more…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SchedulePatientPlayground({
  patient,
  selectedDate: initialDate,
  onClose,
}: SchedulePatientPlaygroundProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [serviceType, setServiceType] = useState<string>(patient.serviceType ?? "");
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const { data: dayContext, isLoading: contextLoading } = useQuery<PatientScheduleDayContext>({
    queryKey: [
      "schedule-patient-playground-context",
      patient.facilityId ?? null,
      patient.patientScreeningId ?? null,
      patient.executionCaseId ?? null,
      selectedDate,
    ],
    queryFn: () =>
      fetchPatientScheduleDayContext({
        facilityId: patient.facilityId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        executionCaseId: patient.executionCaseId ?? null,
        selectedDate,
      }),
  });

  const canSubmit = useMemo(() => {
    if (!(patient.patientScreeningId ?? patient.executionCaseId)) return false;
    if (!serviceType.trim()) return false;
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [patient, serviceType, selectedDate, time]);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const startsAt = combineLocalDateAndTimeToIso(selectedDate, time);
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: patient.executionCaseId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        serviceType: serviceType.trim(),
        startsAt,
        facilityId: patient.facilityId ?? null,
        note: note.trim() || null,
        metadata: { source: "schedule_patient_playground" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-workspace-ancillary-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-clinic-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-schedule-events"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-patient-playground-context"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-patient-day-context"] });
      toast({
        title: "Scheduled",
        description: `${serviceType.trim()} for ${patient.patientName ?? "patient"}.`,
      });
      setTime("");
      setNote("");
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
    <div
      className="flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="schedule-patient-playground"
    >
      <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-base font-semibold text-slate-900">Schedule Patient</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {patient.patientName ?? "Patient"}
            {patient.patientDob ? ` · DOB ${patient.patientDob}` : ""}
            {patient.facilityId ? ` · ${patient.facilityId}` : ""}
            {patient.serviceType ? ` · ${patient.serviceType}` : ""}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scheduling view"
            title="Close"
            className="inline-flex items-center justify-center h-8 w-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            data-testid="button-schedule-patient-playground-close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <div className="space-y-3">
            <div>
              <Label htmlFor="sp-pg-date" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Date
              </Label>
              <Input
                id="sp-pg-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1"
                data-testid="input-sp-pg-date"
              />
            </div>
            <div>
              <Label htmlFor="sp-pg-time" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Time
              </Label>
              <Input
                id="sp-pg-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1"
                data-testid="input-sp-pg-time"
              />
            </div>
            <div>
              <Label htmlFor="sp-pg-service" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Service type
              </Label>
              <Input
                id="sp-pg-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder="e.g. BrainWave"
                className="mt-1"
                data-testid="input-sp-pg-service-type"
              />
            </div>
            <div>
              <Label htmlFor="sp-pg-note" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Note (optional)
              </Label>
              <Textarea
                id="sp-pg-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 min-h-[100px]"
                placeholder="Context for the technician/scheduler"
                data-testid="textarea-sp-pg-note"
              />
            </div>
            <Button
              type="button"
              disabled={!canSubmit || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
              className="w-full gap-1.5"
              data-testid="button-sp-pg-submit"
            >
              {scheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule
            </Button>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Day at a glance · {selectedDate}
            </div>
            {contextLoading ? (
              <div className="text-xs text-slate-500 italic py-2">Loading day context…</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <EventColumn
                  label="Clinic Schedule"
                  rows={dayContext?.clinicEvents ?? []}
                  emptyText="No clinic visits."
                  testId="sp-pg-clinic-events"
                />
                <EventColumn
                  label="Ancillary Schedule"
                  rows={dayContext?.ancillaryEvents ?? []}
                  emptyText="No ancillary appointments."
                  testId="sp-pg-ancillary-events"
                />
                <EventColumn
                  label="This patient"
                  rows={dayContext?.patientEvents ?? []}
                  emptyText="No existing events for this patient on this day."
                  testId="sp-pg-patient-events"
                />
                <EventColumn
                  label="Availability / Blocks"
                  rows={dayContext?.availabilityBlocks ?? []}
                  emptyText="No availability blocks."
                  testId="sp-pg-availability-blocks"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
