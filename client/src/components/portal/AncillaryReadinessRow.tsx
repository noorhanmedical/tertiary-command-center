// AncillaryReadinessRow — Task #610
//
// Renders the three document-readiness indicators on an ACS ancillary
// appointment card:
//   1. Informed Consent  (every patient)
//   2. Screening Form    (BrainWave / VitalWave only)
//   3. BrainWave Result PDF upload (BrainWave only)
//
// Icon states: grey = missing, green check = complete, hidden = not_required.
// Clicking a consent/screening icon opens a preview drawer (the library PDF)
// with a "Mark as Collected" action. The BrainWave icon opens a file picker
// that uploads the result PDF.

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
  FileUp,
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
  serviceType: string | null;
  patientName: string | null;
  readiness: AncillaryReadinessSummary | null | undefined;
  rowId: string;
  onChanged: () => void;
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
  serviceType,
  patientName,
  readiness,
  rowId,
  onChanged,
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
      toast({ title: "BrainWave Result PDF uploaded" });
      onChanged();
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  if (!readiness) return null;

  const showConsent = readiness.informedConsent !== "not_required";
  const showScreening = readiness.screeningForm !== "not_required";
  const showBrainwave = readiness.brainwavePdf !== "not_required";

  if (!showConsent && !showScreening && !showBrainwave) return null;

  return (
    <>
      <div
        className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2"
        data-testid={`ancillary-readiness-${rowId}`}
      >
        <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-0.5">Docs</span>

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
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100"
            title={`Informed Consent — ${readiness.informedConsent}`}
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
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100"
            title={`Screening Form — ${readiness.screeningForm}`}
            data-testid={`readiness-screening-${rowId}`}
          >
            <ClipboardList className={`h-4 w-4 ${iconClasses(readiness.screeningForm)}`} />
            {readiness.screeningForm === "complete" && (
              <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white text-emerald-600" />
            )}
          </button>
        )}

        {showBrainwave && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-50"
            title={`BrainWave Result PDF — ${readiness.brainwavePdf}`}
            data-testid={`readiness-brainwave-${rowId}`}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <FileUp className={`h-4 w-4 ${iconClasses(readiness.brainwavePdf)}`} />
            )}
            {readiness.brainwavePdf === "complete" && !uploadMutation.isPending && (
              <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white text-emerald-600" />
            )}
          </button>
        )}

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
          data-testid={`readiness-brainwave-input-${rowId}`}
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
