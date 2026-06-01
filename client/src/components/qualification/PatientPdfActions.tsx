import { Button } from "@/components/ui/button";
import { FileText, FileBarChart } from "lucide-react";
import type { PatientScreening } from "@shared/schema";
import {
  generateClinicianPDF,
  generatePlexusPDF,
} from "@/lib/pdfGeneration";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";

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
  const eligible = isPatientPdfEligible(patient);
  const batchName =
    [facility, scheduleDate].filter(Boolean).join(" · ") || patient.name;
  const blockTitle = eligible
    ? undefined
    : "Complete qualification before generating PDF";

  if (iconOnly) {
    return (
      <div
        className="inline-flex items-center gap-1"
        data-testid={`patient-pdf-actions-${patient.id}`}
      >
        <button
          type="button"
          disabled={!eligible}
          title={blockTitle ?? "Plexus PDF for this patient"}
          aria-label={blockTitle ?? "Plexus PDF"}
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
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid={`button-patient-plexus-pdf-${patient.id}`}
        >
          <FileBarChart className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!eligible}
          title={blockTitle ?? "Clinician PDF for this patient"}
          aria-label={blockTitle ?? "Clinician PDF"}
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
        title={blockTitle ?? "Plexus PDF for this patient"}
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
        Plexus PDF
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!eligible}
        title={blockTitle ?? "Clinician PDF for this patient"}
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
        Clinician PDF
      </Button>
    </div>
  );
}
