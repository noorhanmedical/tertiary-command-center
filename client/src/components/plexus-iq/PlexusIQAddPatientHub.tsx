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
//
// The tiles are direct actions. The page handler closes the hub and
// opens the next modal; the inline onClose() after onPick* is a
// defensive no-op so the hub still closes even if the page handler
// forgets to.

export type PlexusIQAddPatientHubProps = {
  open: boolean;
  onClose: () => void;
  onPickVisit: () => void;
  onPickOutreach: () => void;
  onPickBatchFlow: () => void;
};

const TILE_BASE =
  "group flex flex-col items-center text-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-7 cursor-pointer transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";

const ICON_WRAP_BASE =
  "inline-flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-hover:scale-[1.03]";

function HubTile({
  label,
  description,
  icon,
  iconWrapClass,
  onClick,
  testId,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  iconWrapClass: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button type="button" onClick={onClick} className={TILE_BASE} data-testid={testId}>
      <span className={`${ICON_WRAP_BASE} ${iconWrapClass}`}>{icon}</span>
      <span className="text-base font-semibold text-slate-900">{label}</span>
      <span className="text-xs leading-snug text-slate-500">{description}</span>
    </button>
  );
}

export function PlexusIQAddPatientHub({
  open,
  onClose,
  onPickVisit,
  onPickOutreach,
  onPickBatchFlow,
}: PlexusIQAddPatientHubProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="plexus-iq-add-patient-hub">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Add Patient(s)
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 mb-4">
          Choose how patients enter Plexus IQ. All three write through the same
          canonical patient + batch records.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <HubTile
            label="Visit"
            description="One patient with a clinic appointment."
            icon={<ClipboardList className="h-7 w-7" />}
            iconWrapClass="bg-sky-50 text-sky-700"
            onClick={() => {
              onPickVisit();
              onClose();
            }}
            testId="button-plexus-iq-add-patient-tile-visit"
          />
          <HubTile
            label="Outreach"
            description="One patient for call list / no clinic date."
            icon={<Phone className="h-7 w-7" />}
            iconWrapClass="bg-amber-50 text-amber-700"
            onClick={() => {
              onPickOutreach();
              onClose();
            }}
            testId="button-plexus-iq-add-patient-tile-outreach"
          />
          <HubTile
            label="Plexus BatchFlow"
            description="Paste a clinic spreadsheet. Routes by Clinic + Date."
            icon={<Upload className="h-7 w-7" />}
            iconWrapClass="bg-indigo-50 text-indigo-700"
            onClick={() => {
              onPickBatchFlow();
              onClose();
            }}
            testId="button-plexus-iq-add-patient-tile-batchflow"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
