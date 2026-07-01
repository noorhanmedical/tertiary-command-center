import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SERVICE_OPTIONS,
  TIME_SLOTS,
  prettyTime,
} from "@/components/portal/SchedulePatientDialog";

export type CalendarQuickSchedulePayload = {
  date: string;
  time: string;
  service: string;
  patientName: string;
};

export type CalendarQuickScheduleDialogProps = {
  open: boolean;
  date: string | null;
  onOpenChange: (open: boolean) => void;
  onSchedule: (payload: CalendarQuickSchedulePayload) => void;
  onOpenInPlayground: (payload: CalendarQuickSchedulePayload) => void;
};

/**
 * Lightweight scheduling pop-up launched from the left-rail Calendar tool and
 * from clicking a date in the compact mini-calendar (task #635). Collects a
 * date, time, service, and optional patient name, then hands the selection off
 * to the full SchedulePatientDialog (Schedule) or the Playground
 * (Open in Playground). This surface only pre-fills — it never persists an
 * appointment on its own, since that requires the full patient context the
 * downstream dialog owns.
 */
export function CalendarQuickScheduleDialog({
  open,
  date,
  onOpenChange,
  onSchedule,
  onOpenInPlayground,
}: CalendarQuickScheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [service, setService] = useState<string>("");
  const [patientName, setPatientName] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSelectedDate(date ?? "");
      setTime("");
      setService("");
      setPatientName("");
    }
  }, [open, date]);

  const payload: CalendarQuickSchedulePayload = {
    date: selectedDate,
    time,
    service,
    patientName: patientName.trim(),
  };

  const canProceed = !!selectedDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-calendar-quick-schedule">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#4863A0]">
            <CalendarDays className="h-4 w-4" />
            Quick Schedule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-date">Date</Label>
            <Input
              id="quick-schedule-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              data-testid="input-quick-schedule-date"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-time">Time</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="quick-schedule-time" data-testid="select-quick-schedule-time">
                <SelectValue placeholder="Select a time" />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.map((slot) => (
                  <SelectItem key={slot} value={slot}>
                    {prettyTime(slot)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-service">Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger id="quick-schedule-service" data-testid="select-quick-schedule-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-patient">Patient name (optional)</Label>
            <Input
              id="quick-schedule-patient"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="e.g. Jane Doe"
              data-testid="input-quick-schedule-patient"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canProceed}
            onClick={() => onOpenInPlayground(payload)}
            data-testid="button-quick-schedule-playground"
          >
            Open in Playground
          </Button>
          <Button
            type="button"
            disabled={!canProceed}
            onClick={() => onSchedule(payload)}
            data-testid="button-quick-schedule-submit"
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
