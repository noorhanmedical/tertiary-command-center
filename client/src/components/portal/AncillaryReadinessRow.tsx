// AncillaryReadinessRow
//
// Renders the three canonical document-readiness indicators on an ancillary
// schedule row, always in the SAME order and language:
//   1. Informed Consent  (every ancillary)
//   2. Screening Form    (BrainWave / VitalWave only)
//   3. Report            (every ancillary)
//
// Every state comes from canonical backend readiness (AncillaryReadinessSummary)
// — there are NO frontend-only completion flags. Icon states: subtle grey =
// missing, clean green check = complete, hidden = not_required.
//
// Consent / Screening: clicking opens a preview drawer (the Library template)
// with a "Mark as Collected" action. Report: for BrainWave the result PDF is
// uploaded inline (the dedicated brainwave_pdf item canonically satisfies
// Report — the user never sees "BrainWave PDF"); for every other service the
// Report opens the canonical report workflow in the Playground (onOpenReport).
//
// Readiness completion is bound to the SPECIFIC ancillary occurrence: the
// ancillaryCaseId (when known) is sent with every mark/upload so the backend
// never carries a completion forward across occurrences.

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileSignature,
  ClipboardList,
  FileText,
  Check,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  AncillaryReadinessSummary,
  AncillaryReadinessItemState,
} from "@/lib/workflow/teamMemberWorkspaceApi";

type Props = {
  executionCaseId: number | null;
  /** Durable per-service ancillary occurrence id, when known. Sent with every
   *  mark/upload so completion binds to THIS occurrence. */
  ancillaryCaseId?: number | null;
  serviceType: string | null;
  patientName: string | null;
  readiness: AncillaryReadinessSummary | null | undefined;
  rowId: string;
  onChanged: () => void;
  /** Opens the canonical Report workflow (Playground) for non-BrainWave
   *  services, where the result file is uploaded/linked. */
  onOpenReport?: () => void;
  /** Compact inline mode: no "Docs" label, no top border/margin — just the
   *  three icon buttons, for placement inline on a compact schedule bar. */
  compact?: boolean;
};

type PreviewItem = {
  itemType: "informed_consent" | "screening_form";
  label: string;
  docId: number | null;
};

function iconClasses(state: AncillaryReadinessItemState): string {
  return state === "complete" ? "text-emerald-600" : "text-slate-400";
}

export function AncillaryReadinessRow({
  executionCaseId,
  ancillaryCaseId,
  serviceType,
  patientName,
  readiness,
  rowId,
  onChanged,
  onOpenReport,
  compact = false,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<PreviewItem | null>(null);

  const markMutation = useMutation({
    mutationFn: async (item: PreviewItem) => {
      if (executionCaseId == null) throw new Error("No execution case for this appointment");
      const res = await fetch(
        `/api/portal/case-readiness/${executionCaseId}/mark`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemType: item.itemType,
            status: "complete",
            serviceType: serviceType ?? undefined,
            ancillaryCaseId: ancillaryCaseId ?? undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, item) => {
      toast({ title: `${item.label} marked as collected` });
      setPreview(null);
      onChanged();
    },
    onError: (err: Error) => {
      toast({ title: "Could not mark item", description: err.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (executionCaseId == null) throw new Error("No execution case for this appointment");
      const fd = new FormData();
      fd.append("file", file);
      if (serviceType) fd.append("serviceType", serviceType);
      if (ancillaryCaseId != null) fd.append("ancillaryCaseId", String(ancillaryCaseId));
      const res = await fetch(
        `/api/portal/case-readiness/${executionCaseId}/upload-brainwave-pdf`,
        { method: "POST", credentials: "include", body: fd },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report uploaded" });
      onChanged();
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  if (!readiness) return null;

  const showConsent = readiness.informedConsent !== "not_required";
  const showScreening = readiness.screeningForm !== "not_required";
  // Report applies to every ancillary. BrainWave uploads the result inline
  // (brainwave_pdf); every other service links its report via the Playground.
  const reportUploadsInline = readiness.brainwavePdf !== "not_required";
  const reportState = readiness.report;

  const onReportClick = () => {
    if (reportState === "complete") return; // already done — indicator only
    if (reportUploadsInline) {
      fileInputRef.current?.click();
    } else {
      onOpenReport?.();
    }
  };

  return (
    <>
      <div
        className={
          compact
            ? "flex items-center gap-0.5"
            : "mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2"
        }
        data-testid={`ancillary-readiness-${rowId}`}
      >
        {!compact && (
          <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-0.5">Docs</span>
        )}

        {showConsent && (
          <button
            type="button"
            onClick={() =>
              setPreview({
                itemType: "informed_consent",
                label: "Informed Consent",
                docId: readiness.informedConsentDocId,
              })
            }
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            title={`Consent — ${readiness.informedConsent === "complete" ? "complete" : "incomplete"}`}
            aria-label={`Informed consent — ${readiness.informedConsent === "complete" ? "complete" : "incomplete"}`}
            data-testid={`readiness-consent-${rowId}`}
          >
            <FileSignature className={`h-4 w-4 ${iconClasses(readiness.informedConsent)}`} />
            {readiness.informedConsent === "complete" && (
              <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white text-emerald-600" />
            )}
          </button>
        )}

        {showScreening && (
          <button
            type="button"
            onClick={() =>
              setPreview({
                itemType: "screening_form",
                label: "Screening Form",
                docId: readiness.screeningFormDocId,
              })
            }
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            title={`Screening — ${readiness.screeningForm === "complete" ? "complete" : "incomplete"}`}
            aria-label={`Screening form — ${readiness.screeningForm === "complete" ? "complete" : "incomplete"}`}
            data-testid={`readiness-screening-${rowId}`}
          >
            <ClipboardList className={`h-4 w-4 ${iconClasses(readiness.screeningForm)}`} />
            {readiness.screeningForm === "complete" && (
              <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white text-emerald-600" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onReportClick}
          disabled={uploadMutation.isPending}
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
          title={`Report — ${reportState === "complete" ? "complete" : "incomplete"}`}
          aria-label={`Report — ${reportState === "complete" ? "complete" : "incomplete"}`}
          data-testid={`readiness-report-${rowId}`}
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <FileText className={`h-4 w-4 ${iconClasses(reportState)}`} />
          )}
          {reportState === "complete" && !uploadMutation.isPending && (
            <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white text-emerald-600" />
          )}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadMutation.mutate(f);
            e.target.value = "";
          }}
          data-testid={`readiness-report-input-${rowId}`}
        />
      </div>

      <Dialog open={preview != null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl z-[95]" data-testid="readiness-preview-dialog">
          <DialogHeader>
            <DialogTitle>
              {preview?.label}
              {patientName ? ` — ${patientName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="h-[60vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {preview?.docId != null ? (
              <iframe
                title={preview.label}
                src={`/api/documents-library/${preview.docId}/file?disposition=inline`}
                className="h-full w-full"
                data-testid="readiness-preview-frame"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                No template document is configured for this item yet. You can
                still mark it as collected once you have the signed form on file.
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)} data-testid="readiness-preview-cancel">
              Close
            </Button>
            <Button
              onClick={() => preview && markMutation.mutate(preview)}
              disabled={markMutation.isPending}
              data-testid="readiness-preview-mark"
            >
              {markMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Marking…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1" /> Mark as Collected
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
