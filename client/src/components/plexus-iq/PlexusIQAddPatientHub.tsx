import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarCheck2, Headset, Workflow } from "lucide-react";

// 3-tile hub for the Plexus IQ "Add Patient(s)" action.
//
// Visit  → opens PlexusIQAddPatientModal with defaultPatientType="visit"
// Outreach → opens PlexusIQAddPatientModal with defaultPatientType="outreach"
// Plexus BatchFlow → opens the existing PlexusIQBulkImportModal
//
// All three write through the canonical screening_batches +
// patient_screenings path — no new tables, no parallel flows.
//
// Premium presentation: left-aligned card layout with a square icon
// box, 14px tile label, and a short copy line. No popup/panel/nav
// behavior is introduced — the tiles are still direct actions.

export type PlexusIQAddPatientHubProps = {
  open: boolean;
  onClose: () => void;
  onPickVisit: () => void;
  onPickOutreach: () => void;
  onPickBatchFlow: () => void;
};

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
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 text-left rounded border border-[#DCE2EA] bg-white px-5 py-5 cursor-pointer transition-all duration-150 hover:shadow-[0_4px_14px_rgba(15,23,42,0.08)] hover:border-[#C7D0DD] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]/30"
      data-testid={testId}
    >
      <span
        className={`inline-flex h-11 w-11 items-center justify-center rounded ${iconWrapClass}`}
      >
        {icon}
      </span>
      <span className="text-[16px] font-medium tracking-tight text-[#111827]">
        {label}
      </span>
      <span className="text-[12px] leading-relaxed text-[#667085]">
        {description}
      </span>
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
      <DialogContent
        className="max-w-3xl bg-white border border-[#DCE2EA] rounded p-0"
        data-testid="plexus-iq-add-patient-hub"
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-[#667085]">
            Plexus Clinical
          </div>
          <DialogTitle className="text-[20px] font-medium tracking-tight text-[#111827]">
            Add Patient(s)
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#667085] font-light">
            Choose how patients enter Plexus IQ. All three write through the
            same canonical patient + batch records.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 px-6 pb-6">
          <HubTile
            label="Visit"
            description="One patient with a clinic appointment."
            icon={<CalendarCheck2 className="h-5 w-5" />}
            iconWrapClass="bg-[#EFF6FF] text-[#1D4ED8]"
            onClick={() => {
              onPickVisit();
              onClose();
            }}
            testId="button-plexus-iq-add-patient-tile-visit"
          />
          <HubTile
            label="Outreach"
            description="One patient for call list — no clinic date."
            icon={<Headset className="h-5 w-5" />}
            iconWrapClass="bg-[#FFFBEB] text-[#B45309]"
            onClick={() => {
              onPickOutreach();
              onClose();
            }}
            testId="button-plexus-iq-add-patient-tile-outreach"
          />
          <HubTile
            label="Plexus BatchFlow"
            description="Paste a clinic spreadsheet. Routes by Clinic + Date."
            icon={<Workflow className="h-5 w-5" />}
            iconWrapClass="bg-[#F5F3FF] text-[#7C3AED]"
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
