// AncillaryDocModals — Task #751
//
// The three real document workflows behind the ancillary patient action bar
// (and the Playground per-ancillary sections):
//   - "consent"    → Informed Consent (pull Library template, sign inline, or
//                    upload a signed file; save to patient chart + mark
//                    readiness).
//   - "screening"  → Screening Form (preview the matching Library template,
//                    upload the completed form, or mark collected; save to
//                    patient chart + mark readiness).
//   - "report"     → Report Upload (upload the result file → patient chart +
//                    fire all existing report side-effects via
//                    /api/case-document-readiness/complete; BrainWave also
//                    records the dedicated brainwave_pdf readiness item).
//
// The Document Library holds templates only; every completed patient document
// is written to the Patient Directory / Plexus EHR via the existing
// patient-scoped pipelines (/api/portal/uploads, /api/portal/sign-consent).
//
// The workflow body is factored into <AncillaryDocInline> so it can render
// either inline (expanded directly under the doc button in the Playground) or
// wrapped in a dialog (<AncillaryDocModals>).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
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
import { Loader2, Check, Upload, PenLine, FileText, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SignaturePad } from "@/components/portal/SignaturePad";
import type { AncillaryReadinessSummary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { getAncillaryCategory } from "@shared/ancillaryCategory";

export type AncillaryDocMode = "consent" | "screening" | "report" | null;

// One schedulable/active ancillary for a patient — the unit the doc workflows
// operate on. Each carries its own case linkage + readiness snapshot.
export type AncillaryServiceContext = {
  // Stable per-scheduled-ancillary identity (the schedule/appointment row id).
  // Distinct instances of the same serviceType (repeat/return visits) MUST keep
  // separate instanceIds so their docs link to the right execution case.
  instanceId: string;
  serviceType: string;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  readiness: AncillaryReadinessSummary | null;
  // Instance-level schedule metadata for operational context in the selector
  // and the Playground per-ancillary sections.
  startsAt?: string | null;
  status?: string | null;
};

type Props = {
  mode: AncillaryDocMode;
  onClose: () => void;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  // The patient's active ancillaries. A compact selector appears when more
  // than one is present; a single entry auto-preselects with no selector.
  services: AncillaryServiceContext[];
  initialInstanceId?: string | null;
  onChanged: () => void;
};

type ConsentTemplate = {
  id: number;
  title: string;
  description: string | null;
  filename: string;
  contentType: string;
};

// Which instance should be selected when the modal opens/reopens for a given
// opener context. Prefers the caller's instance, falling back to the first
// available ancillary. Pure so the selection contract can be unit-tested.
export function resolveOpenInstanceId(
  initialInstanceId: string | null | undefined,
  services: Pick<AncillaryServiceContext, "instanceId">[],
): string {
  return initialInstanceId ?? services[0]?.instanceId ?? "";
}

// Resolve the active ancillary from the current selection. Keys on instanceId
// so repeat/return visits of the same serviceType never collapse and always
// route to the correct execution case. Pure for unit testing.
export function resolveActiveAncillary(
  services: AncillaryServiceContext[],
  selectedInstanceId: string,
  initialInstanceId: string | null | undefined,
): AncillaryServiceContext | null {
  return (
    services.find((s) => s.instanceId === selectedInstanceId) ??
    services.find((s) => s.instanceId === initialInstanceId) ??
    services[0] ??
    null
  );
}

// Short instance-level context (time · status) for the selector, so two
// same-type appointments are distinguishable.
function instanceMeta(s: {
  startsAt?: string | null;
  status?: string | null;
}): string {
  const parts: string[] = [];
  if (s.startsAt) {
    const d = new Date(s.startsAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    }
  }
  if (s.status) parts.push(s.status);
  return parts.join(" · ");
}

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`);
  }
  return res.json();
}

async function markReadiness(params: {
  executionCaseId: number;
  itemType: "informed_consent" | "screening_form";
  serviceType: string;
}): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/portal/case-readiness/${params.executionCaseId}/mark`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemType: params.itemType,
        status: "complete",
        serviceType: params.serviceType,
      }),
    }),
  );
}

async function uploadPatientDoc(params: {
  file: File;
  patientScreeningId: number;
  kind: "informed_consent" | "screening_form" | "report";
  title: string;
}): Promise<{ id: number }> {
  const fd = new FormData();
  fd.append("file", params.file);
  fd.append("patientScreeningId", String(params.patientScreeningId));
  fd.append("kind", params.kind);
  fd.append("title", params.title);
  return jsonOrThrow(
    await fetch("/api/portal/uploads", {
      method: "POST",
      credentials: "include",
      body: fd,
    }),
  );
}

function TitleFor(mode: AncillaryDocMode): string {
  if (mode === "consent") return "Informed Consent";
  if (mode === "screening") return "Screening Form";
  if (mode === "report") return "Report Upload";
  return "";
}

// The document workflow body for a single resolved ancillary. Renders bare
// (no dialog chrome) so it can be dropped inline under a doc button, or inside
// a Dialog by <AncillaryDocModals>.
export function AncillaryDocInline({
  mode,
  active,
  patientName,
  onChanged,
  onClose,
}: {
  mode: Exclude<AncillaryDocMode, null>;
  active: AncillaryServiceContext;
  patientName: string | null;
  onChanged: () => void;
  onClose?: () => void;
}) {
  const { toast } = useToast();

  const executionCaseId = active.executionCaseId;
  const patientScreeningId = active.patientScreeningId;
  const serviceType = active.serviceType;
  const category = getAncillaryCategory(serviceType);
  const readiness = active.readiness;
  const hasChart = patientScreeningId != null;
  const hasCase = executionCaseId != null;

  const done = () => {
    onChanged();
    onClose?.();
  };

  // ── Consent state ─────────────────────────────────────────────────────────
  const [templateId, setTemplateId] = useState<string>("");
  const [signature, setSignature] = useState<string | null>(null);
  const [consentFile, setConsentFile] = useState<File | null>(null);

  const { data: consentTemplates } = useQuery<ConsentTemplate[]>({
    queryKey: ["/api/portal/consent-templates", ""],
    queryFn: async () => {
      const res = await fetch("/api/portal/consent-templates", {
        credentials: "include",
      });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? (body as ConsentTemplate[]) : [];
    },
    enabled: mode === "consent",
  });

  const signConsent = useMutation({
    mutationFn: async () => {
      if (!signature || !templateId) throw new Error("Pick a template and capture a signature");
      if (patientScreeningId == null) throw new Error("No patient chart for this walk-in");
      await jsonOrThrow(
        await fetch("/api/portal/sign-consent", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientScreeningId,
            templateDocumentId: parseInt(templateId, 10),
            signatureDataUrl: signature,
            signedBy: "patient",
            testType: serviceType,
          }),
        }),
      );
      if (executionCaseId != null) {
        await markReadiness({ executionCaseId, itemType: "informed_consent", serviceType });
      }
    },
    onSuccess: () => {
      toast({ title: "Consent signed", description: `Saved to ${patientName ?? "patient"}'s chart.` });
      setSignature(null);
      setTemplateId("");
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Could not sign consent", description: err.message, variant: "destructive" }),
  });

  const uploadConsent = useMutation({
    mutationFn: async () => {
      if (!consentFile) throw new Error("Choose a signed consent file");
      if (patientScreeningId == null) throw new Error("No patient chart for this walk-in");
      await uploadPatientDoc({
        file: consentFile,
        patientScreeningId,
        kind: "informed_consent",
        title: `Informed Consent — ${patientName ?? "patient"}${serviceType ? ` (${serviceType})` : ""}`,
      });
      if (executionCaseId != null) {
        await markReadiness({ executionCaseId, itemType: "informed_consent", serviceType });
      }
    },
    onSuccess: () => {
      toast({ title: "Consent uploaded", description: `Saved to ${patientName ?? "patient"}'s chart.` });
      setConsentFile(null);
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  // ── Screening state ───────────────────────────────────────────────────────
  const [screeningFile, setScreeningFile] = useState<File | null>(null);

  const uploadScreening = useMutation({
    mutationFn: async () => {
      if (!screeningFile) throw new Error("Choose a completed screening form file");
      if (patientScreeningId == null) throw new Error("No patient chart for this walk-in");
      await uploadPatientDoc({
        file: screeningFile,
        patientScreeningId,
        kind: "screening_form",
        title: `Screening Form — ${patientName ?? "patient"}${serviceType ? ` (${serviceType})` : ""}`,
      });
      if (executionCaseId != null) {
        await markReadiness({ executionCaseId, itemType: "screening_form", serviceType });
      }
    },
    onSuccess: () => {
      toast({ title: "Screening form saved", description: `Saved to ${patientName ?? "patient"}'s chart.` });
      setScreeningFile(null);
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const markConsentCollected = useMutation({
    mutationFn: async () => {
      if (executionCaseId == null) throw new Error("No execution case for this appointment");
      await markReadiness({ executionCaseId, itemType: "informed_consent", serviceType });
    },
    onSuccess: () => {
      toast({ title: "Informed consent marked as collected" });
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Could not mark item", description: err.message, variant: "destructive" }),
  });

  const markScreeningCollected = useMutation({
    mutationFn: async () => {
      if (executionCaseId == null) throw new Error("No execution case for this appointment");
      await markReadiness({ executionCaseId, itemType: "screening_form", serviceType });
    },
    onSuccess: () => {
      toast({ title: "Screening form marked as collected" });
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Could not mark item", description: err.message, variant: "destructive" }),
  });

  // ── Report state ──────────────────────────────────────────────────────────
  const [reportFile, setReportFile] = useState<File | null>(null);

  const uploadReport = useMutation({
    mutationFn: async () => {
      if (!reportFile) throw new Error("Choose a report file");
      if (patientScreeningId == null) throw new Error("No patient chart for this walk-in");
      const uploaded = await uploadPatientDoc({
        file: reportFile,
        patientScreeningId,
        kind: "report",
        title: `Report — ${patientName ?? "patient"}${serviceType ? ` (${serviceType})` : ""}`,
      });
      // Fire the existing report side-effects (order/procedure note, billing
      // doc, readiness/document status) via the canonical complete endpoint.
      await jsonOrThrow(
        await fetch("/api/case-document-readiness/complete", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            executionCaseId,
            patientScreeningId,
            serviceType: serviceType || "ancillary",
            documentType: "report",
            documentStatus: "uploaded",
            documentId: uploaded.id,
          }),
        }),
      );
      // BrainWave keeps its dedicated brainwave_pdf readiness item (used by the
      // billing readiness gate) in lockstep with the chart-saved report. This
      // is a HARD requirement for BrainWave: if it fails, the report is on the
      // chart but billing would stay silently blocked — so surface the error.
      if (category === "brainwave") {
        if (executionCaseId == null) {
          throw new Error(
            "BrainWave report needs a linked execution case to satisfy billing readiness.",
          );
        }
        const fd = new FormData();
        fd.append("file", reportFile);
        if (serviceType) fd.append("serviceType", serviceType);
        await jsonOrThrow(
          await fetch(
            `/api/portal/case-readiness/${executionCaseId}/upload-brainwave-pdf`,
            { method: "POST", credentials: "include", body: fd },
          ),
        );
      }
    },
    onSuccess: () => {
      toast({ title: "Report uploaded", description: `Saved to ${patientName ?? "patient"}'s chart.` });
      setReportFile(null);
      done();
    },
    onError: (err: Error) =>
      toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const walkInNote = !hasChart ? (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        This appointment isn't linked to a patient chart yet, so files can't be
        saved to the record. {hasCase ? "You can still mark the item as collected." : ""}
      </span>
    </div>
  ) : null;

  return (
    <div className="space-y-4" data-testid={`ancillary-doc-inline-${mode}`}>
      {walkInNote}

      {/* ── Consent ── */}
      {mode === "consent" && (
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Consent template (Document Library)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-9" data-testid="consent-template-select">
                <SelectValue
                  placeholder={
                    (consentTemplates ?? []).length === 0
                      ? "No consent templates published"
                      : "Choose a consent template"
                  }
                />
              </SelectTrigger>
              <SelectContent className="z-[96]">
                {(consentTemplates ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templateId && (
              <div className="mt-2 h-[34vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <iframe
                  title="Consent template"
                  src={`/api/documents-library/${templateId}/file?disposition=inline`}
                  className="h-full w-full"
                  data-testid="consent-template-frame"
                />
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1">
              <PenLine className="h-3.5 w-3.5" /> Sign inline
            </Label>
            {hasChart ? (
              <>
                <SignaturePad onCapture={setSignature} />
                {signature && (
                  <div className="mt-1 text-[11px] text-emerald-700">✓ Signature captured</div>
                )}
                <Button
                  className="mt-2 w-full"
                  onClick={() => signConsent.mutate()}
                  disabled={!signature || !templateId || signConsent.isPending}
                  data-testid="consent-sign-submit"
                >
                  {signConsent.isPending ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Check className="mr-1 h-4 w-4" /> Sign &amp; save to chart
                    </>
                  )}
                </Button>
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] italic text-slate-500">
                Signature workflow not connected for unlinked walk-ins. Upload
                a signed file or mark as collected instead.
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3">
            <Label className="text-xs flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" /> Or upload a signed file
            </Label>
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setConsentFile(e.target.files?.[0] ?? null)}
              data-testid="consent-upload-input"
            />
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => uploadConsent.mutate()}
              disabled={!consentFile || !hasChart || uploadConsent.isPending}
              data-testid="consent-upload-submit"
            >
              {uploadConsent.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Uploading…
                </>
              ) : (
                "Upload signed consent"
              )}
            </Button>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markConsentCollected.mutate()}
              disabled={!hasCase || markConsentCollected.isPending}
              data-testid="consent-mark-collected"
            >
              {markConsentCollected.isPending ? "Marking…" : "Mark as collected (on paper)"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Screening ── */}
      {mode === "screening" && (
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Screening form template (Document Library)</Label>
            <div className="mt-1 h-[38vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {readiness?.screeningFormDocId != null ? (
                <iframe
                  title="Screening form template"
                  src={`/api/documents-library/${readiness.screeningFormDocId}/file?disposition=inline`}
                  className="h-full w-full"
                  data-testid="screening-template-frame"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                  No screening-form template is configured for {serviceType || "this ancillary"} yet.
                  You can still upload the completed form or mark it collected.
                </div>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" /> Upload completed screening form
            </Label>
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setScreeningFile(e.target.files?.[0] ?? null)}
              data-testid="screening-upload-input"
            />
            <Button
              className="mt-2 w-full"
              onClick={() => uploadScreening.mutate()}
              disabled={!screeningFile || !hasChart || uploadScreening.isPending}
              data-testid="screening-upload-submit"
            >
              {uploadScreening.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Uploading…
                </>
              ) : (
                "Save to chart"
              )}
            </Button>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markScreeningCollected.mutate()}
              disabled={!hasCase || markScreeningCollected.isPending}
              data-testid="screening-mark-collected"
            >
              {markScreeningCollected.isPending ? "Marking…" : "Mark as collected (on paper)"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Report ── */}
      {mode === "report" && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Upload the result file for {serviceType || "this ancillary"}. It
              saves to the patient chart and updates order/procedure notes,
              billing, and readiness.
            </span>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" /> Result file (PDF / image)
            </Label>
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
              data-testid="report-upload-input"
            />
            <Button
              className="mt-2 w-full"
              onClick={() => uploadReport.mutate()}
              disabled={!reportFile || !hasChart || uploadReport.isPending}
              data-testid="report-upload-submit"
            >
              {uploadReport.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Uploading…
                </>
              ) : (
                "Upload report to chart"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AncillaryDocModals({
  mode,
  onClose,
  patientName,
  services,
  initialInstanceId,
  onChanged,
}: Props) {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(
    resolveOpenInstanceId(initialInstanceId, services),
  );

  // The modal instance is reused across ancillary rows, so re-sync the
  // selection to the opener's instance whenever it (re)opens for a different
  // ancillary. Without this, clicking row B after row A would keep A active
  // and mis-link the document to the wrong execution case.
  useEffect(() => {
    if (mode == null) return;
    const next = resolveOpenInstanceId(initialInstanceId, services);
    if (next) setSelectedInstanceId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialInstanceId]);

  const active = useMemo(
    () => resolveActiveAncillary(services, selectedInstanceId, initialInstanceId),
    [services, selectedInstanceId, initialInstanceId],
  );

  if (mode == null || !active) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="z-[95] max-w-2xl" data-testid={`ancillary-doc-modal-${mode}`}>
        <DialogHeader>
          <DialogTitle>
            {TitleFor(mode)}
            {patientName ? ` — ${patientName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Compact ancillary selector — auto-preselected when only one. */}
          {services.length > 1 && (
            <div>
              <Label className="text-xs">Ancillary</Label>
              <Select value={active.instanceId} onValueChange={setSelectedInstanceId}>
                <SelectTrigger className="h-9" data-testid="ancillary-doc-service-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[96]">
                  {services.map((s) => (
                    <SelectItem key={s.instanceId} value={s.instanceId}>
                      {s.serviceType}
                      {instanceMeta(s) ? ` — ${instanceMeta(s)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <AncillaryDocInline
            mode={mode}
            active={active}
            patientName={patientName}
            onChanged={onChanged}
            onClose={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
