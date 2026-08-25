import { Button } from "@/components/ui/button";
import { FileText, FileBarChart } from "lucide-react";
import type { PatientScreening } from "@shared/schema";
import {
  generateClinicianPDF,
  generatePlexusPDF,
} from "@/lib/pdfGeneration";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
import { auditPacketPatient, type PacketMode } from "@/lib/packetQa";
import { useToast } from "@/hooks/use-toast";

// Packet QA Gate — run a single-patient audit before the direct PDF
// helper fires. Blockers surface as a destructive toast naming the
// first few missing pieces so the operator sees WHY their packet
// isn't printable. Warnings are non-blocking and intentionally not
// surfaced from this button (the packet QA dialog is the place to
// see the full warning list).
function blockerSummary(
  patient: PatientScreening,
  mode: PacketMode,
): { blocked: boolean; messages: string[] } {
  const report = auditPacketPatient(patient, mode);
  if (report.blockers.length === 0) return { blocked: false, messages: [] };
  return {
    blocked: true,
    messages: report.blockers.slice(0, 3).map((b) => b.message),
  };
}

export type PatientPdfActionsProps = {
  patient: PatientScreening;
  facility?: string | null;
  scheduleDate?: string | null;
  compact?: boolean;
  iconOnly?: boolean;
};

export function PatientPdfActions({
  patient,
  facility,
  scheduleDate,
  compact = false,
  iconOnly = false,
}: PatientPdfActionsProps) {
  const { toast } = useToast();
  const eligible = isPatientPdfEligible(patient);
  const batchName =
    [facility, scheduleDate].filter(Boolean).join(" · ") || patient.name;
  const blockTitle = eligible
    ? undefined
    : "Complete qualification before generating PDF";

  function runPacket(mode: PacketMode) {
    if (!eligible) return;
    const qa = blockerSummary(patient, mode);
    if (qa.blocked) {
      toast({
        title: `${mode === "plexus" ? "Plexus" : "Clinician"} PDF blocked`,
        description: `Cannot print packet for ${patient.name}: ${qa.messages.join("; ")}`,
        variant: "destructive",
      });
      return;
    }
    const fn = mode === "plexus" ? generatePlexusPDF : generateClinicianPDF;
    fn(
      batchName,
      [patient],
      scheduleDate ?? null,
      (patient as { createdAt?: string | Date | null }).createdAt ?? null,
    );
  }

  if (iconOnly) {
    return (
      <div
        className="inline-flex items-center gap-1"
        data-testid={`patient-pdf-actions-${patient.id}`}
      >
        <button
          type="button"
          disabled={!eligible}
          title={blockTitle ?? "Plexus Atlas for this patient"}
          aria-label={blockTitle ?? "Plexus Atlas"}
          onClick={(e) => {
            e.stopPropagation();
            runPacket("plexus");
          }}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid={`button-patient-plexus-pdf-${patient.id}`}
        >
          <FileBarChart className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!eligible}
          title={blockTitle ?? "Clinician Atlas for this patient"}
          aria-label={blockTitle ?? "Clinician Atlas"}
          onClick={(e) => {
            e.stopPropagation();
            runPacket("clinician");
          }}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid={`button-patient-clinician-pdf-${patient.id}`}
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const buttonClass = compact
    ? "h-6 gap-1 px-2 text-[10px]"
    : "h-7 gap-1 px-2 text-[11px]";

  return (
    <div
      className="inline-flex items-center gap-1.5"
      data-testid={`patient-pdf-actions-${patient.id}`}
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!eligible}
        title={blockTitle ?? "Plexus Atlas for this patient"}
        onClick={(e) => {
          e.stopPropagation();
          if (!eligible) return;
          generatePlexusPDF(
            batchName,
            [patient],
            scheduleDate ?? null,
            (patient as { createdAt?: string | Date | null }).createdAt ?? null,
          );
        }}
        className={buttonClass}
        data-testid={`button-patient-plexus-pdf-${patient.id}`}
      >
        <FileBarChart className="h-3 w-3" />
        Plexus Atlas
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!eligible}
        title={blockTitle ?? "Clinician Atlas for this patient"}
        onClick={(e) => {
          e.stopPropagation();
          if (!eligible) return;
          generateClinicianPDF(
            batchName,
            [patient],
            scheduleDate ?? null,
            (patient as { createdAt?: string | Date | null }).createdAt ?? null,
          );
        }}
        className={buttonClass}
        data-testid={`button-patient-clinician-pdf-${patient.id}`}
      >
        <FileText className="h-3 w-3" />
        Clinician Atlas
      </Button>
    </div>
  );
}
