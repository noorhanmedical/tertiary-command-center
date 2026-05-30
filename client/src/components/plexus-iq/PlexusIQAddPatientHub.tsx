import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardList, Phone, Upload } from "lucide-react";

// 3-tile hub for the Plexus IQ "Add Patient(s)" action.
//
// Visit  → opens PlexusIQAddPatientModal with defaultPatientType="visit"
// Outreach → opens PlexusIQAddPatientModal with defaultPatientType="outreach"
// Plexus BatchFlow → opens the existing PlexusIQBulkImportModal
//
// All three write through the canonical screening_batches +
// patient_screenings path — no new tables, no parallel flows.

export type PlexusIQAddPatientHubProps = {
  open: boolean;
  onClose: () => void;
  onPickVisit: () => void;
  onPickOutreach: () => void;
  onPickBatchFlow: () => void;
};

const TILE_BASE =
  "flex flex-col items-center text-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-6 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400";

export function PlexusIQAddPatientHub({
  open,
  onClose,
  onPickVisit,
  onPickOutreach,
  onPickBatchFlow,
}: PlexusIQAddPatientHubProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl" data-testid="plexus-iq-add-patient-hub">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Add Patient(s)
          </DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-slate-500 mb-2">
          Pick how you're adding patients. All three write through the same
          canonical patient + batch records.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              onPickVisit();
              onClose();
            }}
            className={TILE_BASE}
            data-testid="button-plexus-iq-add-patient-tile-visit"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-700">
              <ClipboardList className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-slate-900">Visit</span>
            <span className="text-[11px] text-slate-500">
              One patient with a clinic appointment.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onPickOutreach();
              onClose();
            }}
            className={TILE_BASE}
            data-testid="button-plexus-iq-add-patient-tile-outreach"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-700">
              <Phone className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-slate-900">Outreach</span>
            <span className="text-[11px] text-slate-500">
              One patient for call list / no clinic date.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onPickBatchFlow();
              onClose();
            }}
            className={TILE_BASE}
            data-testid="button-plexus-iq-add-patient-tile-batchflow"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-slate-900">
              Plexus BatchFlow
            </span>
            <span className="text-[11px] text-slate-500">
              Paste a clinic spreadsheet. Routes by Clinic + Date columns.
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
