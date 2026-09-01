import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { VALID_FACILITIES } from "@shared/plexus";
import { VisitOutreachKindToggle } from "@/features/command-center/tiles";
import type { CommandTileKind } from "@/features/command-center/tiles";
import { ClinicianSelector, type ClinicianContext } from "./ClinicianSelector";

type PatientType = CommandTileKind;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PlexusIQAddPatientModal({
  open,
  onClose,
  onSubmit,
  pending,
  defaultPatientType,
  defaultFacility,
  defaultScheduleDate,
}: {
  open: boolean;
  onClose: () => void;
  // Returns true on success, false on failure. The modal only resets +
  // closes when onSubmit returns true so the user keeps their input on
  // failure and can correct + retry.
  onSubmit: (input: {
    facility: string;
    scheduleDate: string;
    patientType: PatientType;
    name: string;
    time?: string;
    clinician?: ClinicianContext | null;
  }) => Promise<boolean>;
  pending: boolean;
  defaultPatientType?: PatientType;
  // Destination defaults sourced from the operating list's current
  // selection so newly added patients land in the list the user is
  // viewing. Both are overridable in the form before submitting.
  defaultFacility?: string;
  defaultScheduleDate?: string;
}) {
  const [facility, setFacility] = useState<string>(defaultFacility ?? "");
  const [scheduleDate, setScheduleDate] = useState<string>(
    defaultScheduleDate ?? todayIso(),
  );
  const [patientType, setPatientType] = useState<PatientType>(defaultPatientType ?? "visit");
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [clinician, setClinician] = useState<ClinicianContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On open, seed the form from whichever tile opened us plus the
  // operating list's current facility/date selection.
  useEffect(() => {
    if (open) {
      setPatientType(defaultPatientType ?? "visit");
      setFacility(defaultFacility ?? "");
      setScheduleDate(defaultScheduleDate ?? todayIso());
    }
  }, [open, defaultPatientType, defaultFacility, defaultScheduleDate]);

  function reset() {
    setFacility(defaultFacility ?? "");
    setScheduleDate(defaultScheduleDate ?? todayIso());
    setPatientType(defaultPatientType ?? "visit");
    setName("");
    setTime("");
    setClinician(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!facility) {
      setError("Pick a facility");
      return;
    }
    if (!scheduleDate) {
      setError("Pick a date");
      return;
    }
    setError(null);
    const ok = await onSubmit({
      facility,
      scheduleDate,
      patientType,
      name: name.trim(),
      time: time.trim() || undefined,
      clinician,
    });
    if (ok) {
      reset();
      onClose();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md rounded-2xl" data-testid="plexus-iq-add-patient-modal">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Add Patient
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="plexus-iq-add-facility" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Facility
            </Label>
            <Select value={facility} onValueChange={setFacility}>
              <SelectTrigger
                id="plexus-iq-add-facility"
                className="mt-1 h-9"
                data-testid="select-plexus-iq-add-facility"
              >
                <SelectValue placeholder="Select a facility…" />
              </SelectTrigger>
              <SelectContent>
                {VALID_FACILITIES.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Clinician sits right after Facility (facility-dependent dropdown). */}
          <ClinicianSelector facilityName={facility} value={clinician} onChange={setClinician} />

          <div>
            <Label htmlFor="plexus-iq-add-date" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Date
            </Label>
            <Input
              id="plexus-iq-add-date"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="mt-1 h-9 text-sm"
              data-testid="input-plexus-iq-add-date"
            />
          </div>

          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Type
            </Label>
            <VisitOutreachKindToggle
              surface="plexusIq"
              value={patientType}
              onChange={setPatientType}
              className="mt-1"
              testIdPrefix="button-plexus-iq-add-type"
            />
          </div>

          <div>
            <Label htmlFor="plexus-iq-add-name" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Name
            </Label>
            <Input
              id="plexus-iq-add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Patient name (optional, can be filled later)"
              className="mt-1 h-9 text-sm"
              data-testid="input-plexus-iq-add-name"
            />
          </div>

          {patientType === "visit" && (
            <div>
              <Label htmlFor="plexus-iq-add-time" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Time (optional)
              </Label>
              <Input
                id="plexus-iq-add-time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="e.g. 10:00 AM"
                className="mt-1 h-9 text-sm"
                data-testid="input-plexus-iq-add-time"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600" data-testid="text-plexus-iq-add-error">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { reset(); onClose(); }}
              data-testid="button-plexus-iq-add-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending}
              className="gap-1.5"
              data-testid="button-plexus-iq-add-submit"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Add Patient
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
