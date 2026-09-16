// Thin dialog wrapper around the shared SchedulingPicker so any surface (the
// permanent Manual Call List work-list, the Team Portal, etc.) can open the
// SAME simplified iOS/Zocdoc-like scheduling experience with one import. It
// adds no scheduling behavior of its own — it only frames the shared picker and
// closes on a successful canonical booking.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SchedulingPicker,
  type SchedulingPickerPatient,
} from "./SchedulingPicker";

export type SchedulingPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: SchedulingPickerPatient;
  facilityId: string | null;
  services: string[];
  initialDate?: string | null;
  onScheduled?: (result: unknown) => void;
};

export function SchedulingPickerDialog({
  open,
  onOpenChange,
  patient,
  facilityId,
  services,
  initialDate,
  onScheduled,
}: SchedulingPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden bg-slate-50 p-0">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-3">
          <DialogTitle className="text-base font-semibold text-slate-900">
            {patient.patientName ? `Schedule — ${patient.patientName}` : "Schedule"}
          </DialogTitle>
        </DialogHeader>
        <div className="p-4">
          <SchedulingPicker
            patient={patient}
            facilityId={facilityId}
            services={services}
            initialDate={initialDate}
            onCancel={() => onOpenChange(false)}
            onScheduled={(result) => {
              onScheduled?.(result);
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SchedulingPickerDialog;
