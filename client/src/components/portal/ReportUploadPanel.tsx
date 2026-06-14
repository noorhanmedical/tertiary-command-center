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
  serviceType: string;
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
      const markRes = await fetch("/api/case-document-readiness/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionCaseId,
          patientScreeningId,
          serviceType,
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

  return (
    <Card className="p-3 bg-white" data-testid="report-upload-panel">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <FileText className="h-4 w-4 text-slate-500" /> Report upload
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
