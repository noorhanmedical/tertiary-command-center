// ReportUploadPanel — Phase 2 PR 2.9
//
// Lets an ACS operator upload a report file and mark the
// case_document_readiness row in one combined action:
//   1. POST /api/portal/uploads (multipart) → blob storage + a
//      documents row.
//   2. POST /api/case-document-readiness/complete → readiness row
//      with status = uploaded.
// Both are canonical existing routes; PR 2.9 just orchestrates them
// in the panel without inventing a new writer.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  executionCaseId: number;
  patientScreeningId: number;
  /** Phase 2 hardening item 3 — must be the real test type from
   *  the canonical sources. null disables the upload and renders
   *  an honest "pick a test type first" message instead of
   *  silently uploading as "general". */
  serviceType: string | null;
};

type Stage = "idle" | "uploading" | "marking" | "done" | "error";

export function ReportUploadPanel({ executionCaseId, patientScreeningId, serviceType }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a file first");
      if (!serviceType) throw new Error("No test type — cannot upload");
      setStage("uploading");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientScreeningId", String(patientScreeningId));
      fd.append("executionCaseId", String(executionCaseId));
      fd.append("kind", "report");
      fd.append("serviceType", serviceType);
      const upRes = await fetch("/api/portal/uploads", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `upload failed (${upRes.status})`);
      }
      const uploaded = (await upRes.json()) as { id?: number; storageKey?: string };

      setStage("marking");
      // serviceType non-null check at the top of mutationFn means
      // we can safely send it here.
      const markRes = await fetch("/api/case-document-readiness/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionCaseId,
          patientScreeningId,
          serviceType: serviceType as string,
          documentType: "report",
          documentStatus: "uploaded",
          documentId: uploaded.id ?? null,
          storageKey: uploaded.storageKey ?? null,
        }),
      });
      if (!markRes.ok) {
        const body = await markRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `readiness failed (${markRes.status})`);
      }
      return markRes.json();
    },
    onSuccess: () => {
      setStage("done");
      toast({ title: "Report uploaded" });
      queryClient.invalidateQueries({ queryKey: ["acs-workflow-snapshot", executionCaseId] });
      queryClient.invalidateQueries({ queryKey: ["portal-command-center", patientScreeningId] });
      queryClient.invalidateQueries({ queryKey: ["communication-timeline", patientScreeningId] });
      setFile(null);
    },
    onError: (err: Error) => {
      setStage("error");
      setErrorMsg(err.message);
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  // Phase 2 hardening item 3 — honest disabled state when no test
  // type is resolvable from the canonical sources.
  if (!serviceType) {
    return (
      <Card
        className="p-3 bg-white"
        data-testid="report-upload-panel-disabled"
      >
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-slate-500" /> Report upload
        </div>
        <div className="text-[11px] text-slate-500">
          Select or attach a test type before uploading a report.
          No active test was found from document readiness rows or
          qualifying tests for this patient.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 bg-white" data-testid="report-upload-panel">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <FileText className="h-4 w-4 text-slate-500" /> Report upload
      </div>
      <div className="mb-2 text-[11px] text-slate-500">
        Active test type: <span className="font-medium text-slate-700">{serviceType}</span>
      </div>
      <input
        type="file"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setStage("idle");
          setErrorMsg(null);
        }}
        className="text-xs"
        data-testid="report-upload-file-input"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          {stage === "uploading"
            ? "Uploading…"
            : stage === "marking"
              ? "Marking readiness…"
              : stage === "error"
                ? `Failed: ${errorMsg ?? ""}`
                : stage === "done"
                  ? "Uploaded and marked readiness as 'uploaded'."
                  : "Pick a PDF or image. Upload writes through canonical /api/portal/uploads + /api/case-document-readiness/complete."}
        </div>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!file || stage === "uploading" || stage === "marking"}
          data-testid="report-upload-submit"
        >
          {stage === "uploading" || stage === "marking" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Uploading…
            </>
          ) : (
            <>
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
