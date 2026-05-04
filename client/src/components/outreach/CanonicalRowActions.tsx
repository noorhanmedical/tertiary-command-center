import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Minimal action surface for canonical execution case rows in the
// scheduler portal. Renders two small text buttons next to the existing
// journey drawer trigger. No layout / global-style changes — buttons
// inherit the row's background and use shadcn's outline button preset.

type Props = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  /** Engagement status drives whether the post-schedule "Done" action is
   *  visible. Hidden for cases that haven't been scheduled yet. */
  engagementStatus?: string | null;
  /** Refetch hook for the parent's canonical case query so the row
   *  status reflects the new state immediately. */
  onSuccess?: () => void;
};

const DOCUMENT_TYPE_OPTIONS: Array<{ value: string; label: string; defaultStatus: string }> = [
  { value: "informed_consent",    label: "Informed consent",    defaultStatus: "completed" },
  { value: "screening_form",      label: "Screening form",      defaultStatus: "completed" },
  { value: "report",              label: "Report",              defaultStatus: "uploaded" },
  { value: "order_note",          label: "Order note",          defaultStatus: "generated" },
  { value: "post_procedure_note", label: "Post-procedure note", defaultStatus: "generated" },
];

const POST_SCHEDULE_STATUSES = new Set(["scheduled", "in_progress", "completed"]);

const CALL_RESULT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "scheduled", label: "Scheduled" },
  { value: "callback", label: "Callback later" },
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "needs_records", label: "Needs records" },
  { value: "insurance_prior_auth_issue", label: "Insurance / prior auth" },
  { value: "manager_review", label: "Manager review" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
];

const DEFAULT_SERVICE_TYPES = ["BrainWave", "VitalWave"];

function defaultStartsAtIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultCallbackIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CanonicalRowActions({
  executionCaseId,
  patientScreeningId,
  patientName,
  patientDob,
  facilityId,
  engagementStatus,
  onSuccess,
}: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  const showDone = engagementStatus
    ? POST_SCHEDULE_STATUSES.has(engagementStatus)
    : false;

  return (
    <>
      <button
        type="button"
        onClick={() => setLogOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
        data-testid={`canonical-case-log-call-${executionCaseId}`}
      >
        Log
      </button>
      <button
        type="button"
        onClick={() => setSchedOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
        data-testid={`canonical-case-schedule-action-${executionCaseId}`}
      >
        Sched
      </button>
      {showDone && (
        <button
          type="button"
          onClick={() => setDoneOpen(true)}
          className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
          data-testid={`canonical-case-done-action-${executionCaseId}`}
        >
          Done
        </button>
      )}

      {logOpen && (
        <CanonicalLogCallDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          executionCaseId={executionCaseId}
          patientScreeningId={patientScreeningId}
          patientName={patientName}
          patientDob={patientDob}
          facilityId={facilityId}
          onSuccess={onSuccess}
        />
      )}
      {schedOpen && (
        <CanonicalScheduleDialog
          open={schedOpen}
          onOpenChange={setSchedOpen}
          executionCaseId={executionCaseId}
          patientScreeningId={patientScreeningId}
          patientName={patientName}
          patientDob={patientDob}
          facilityId={facilityId}
          onSuccess={onSuccess}
        />
      )}
      {doneOpen && (
        <CanonicalDoneDialog
          open={doneOpen}
          onOpenChange={setDoneOpen}
          executionCaseId={executionCaseId}
          patientScreeningId={patientScreeningId}
          patientName={patientName}
          patientDob={patientDob}
          facilityId={facilityId}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}

function CanonicalLogCallDialog({
  open,
  onOpenChange,
  executionCaseId,
  patientScreeningId,
  patientName,
  patientDob,
  facilityId,
  onSuccess,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [callResult, setCallResult] = useState<string>("callback");
  const [note, setNote] = useState<string>("");
  const [nextActionAt, setNextActionAt] = useState<string>(defaultCallbackIso());

  const submit = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        executionCaseId,
        patientScreeningId: patientScreeningId ?? undefined,
        patientName,
        patientDob: patientDob ?? undefined,
        facilityId: facilityId ?? undefined,
        callResult,
        note: note.trim() || undefined,
      };
      if (callResult === "callback" && nextActionAt) {
        body.nextActionAt = new Date(nextActionAt).toISOString();
      }
      const res = await apiRequest("POST", "/api/engagement-center/call-result", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to log call result");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call result logged" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Could not log call", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="canonical-log-call-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Log call result</DialogTitle>
          <p className="text-xs text-slate-500">{patientName}</p>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-xs font-semibold text-slate-700">Call result</Label>
            <select
              value={callResult}
              onChange={(e) => setCallResult(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              data-testid="canonical-log-call-result"
            >
              {CALL_RESULT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {callResult === "callback" && (
            <div>
              <Label className="text-xs font-semibold text-slate-700">Callback at</Label>
              <Input
                type="datetime-local"
                value={nextActionAt}
                onChange={(e) => setNextActionAt(e.target.value)}
                className="mt-1.5 rounded-xl text-sm"
                data-testid="canonical-log-call-nextActionAt"
              />
            </div>
          )}
          <div>
            <Label className="text-xs font-semibold text-slate-700">
              Note <span className="text-slate-400">(optional)</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1.5 resize-none rounded-xl text-sm"
              data-testid="canonical-log-call-note"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="canonical-log-call-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
              data-testid="canonical-log-call-submit"
            >
              {submit.isPending ? "Logging…" : "Log call"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CanonicalScheduleDialog({
  open,
  onOpenChange,
  executionCaseId,
  patientScreeningId,
  patientName,
  patientDob: _patientDob,
  facilityId,
  onSuccess,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [serviceType, setServiceType] = useState<string>(DEFAULT_SERVICE_TYPES[0]);
  const [startsAt, setStartsAt] = useState<string>(defaultStartsAtIso());
  const [note, setNote] = useState<string>("");

  const submit = useMutation({
    mutationFn: async () => {
      if (!startsAt) throw new Error("Pick a date and time");
      const body: Record<string, unknown> = {
        executionCaseId,
        patientScreeningId: patientScreeningId ?? undefined,
        serviceType,
        startsAt: new Date(startsAt).toISOString(),
        facilityId: facilityId ?? undefined,
        note: note.trim() || undefined,
      };
      const res = await apiRequest("POST", "/api/global-schedule-events/schedule-ancillary", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to schedule");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ancillary appointment scheduled" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Could not schedule", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="canonical-schedule-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Schedule ancillary</DialogTitle>
          <p className="text-xs text-slate-500">{patientName}</p>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-xs font-semibold text-slate-700">Service</Label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              data-testid="canonical-schedule-service-type"
            >
              {DEFAULT_SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-700">Starts at</Label>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1.5 rounded-xl text-sm"
              data-testid="canonical-schedule-startsAt"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-700">
              Note <span className="text-slate-400">(optional)</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1.5 resize-none rounded-xl text-sm"
              data-testid="canonical-schedule-note"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="canonical-schedule-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
              data-testid="canonical-schedule-submit"
            >
              {submit.isPending ? "Saving…" : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CanonicalDoneDialog({
  open,
  onOpenChange,
  executionCaseId,
  patientScreeningId,
  patientName,
  patientDob,
  facilityId,
  onSuccess,
}: Props & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [serviceType, setServiceType] = useState<string>(DEFAULT_SERVICE_TYPES[0]);
  const [documentType, setDocumentType] = useState<string>(DOCUMENT_TYPE_OPTIONS[0].value);
  const [documentStatus, setDocumentStatus] = useState<string>(DOCUMENT_TYPE_OPTIONS[0].defaultStatus);

  const procedureMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        executionCaseId,
        patientScreeningId: patientScreeningId ?? undefined,
        patientName,
        patientDob: patientDob ?? undefined,
        facilityId: facilityId ?? undefined,
        serviceType,
        completedAt: new Date().toISOString(),
      };
      const res = await apiRequest("POST", "/api/procedure-events/complete", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to mark procedure complete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Procedure marked complete" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/case-document-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-readiness-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
      onSuccess?.();
    },
    onError: (e: Error) =>
      toast({ title: "Could not mark procedure complete", description: e.message, variant: "destructive" }),
  });

  const docMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        executionCaseId,
        patientScreeningId: patientScreeningId ?? undefined,
        serviceType,
        documentType,
        documentStatus,
      };
      const res = await apiRequest("POST", "/api/case-document-readiness/complete", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to complete document");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document marked complete" });
      queryClient.invalidateQueries({ queryKey: ["/api/case-document-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-readiness-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-document-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
      onSuccess?.();
    },
    onError: (e: Error) =>
      toast({ title: "Could not complete document", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="canonical-done-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Procedure & docs</DialogTitle>
          <p className="text-xs text-slate-500">{patientName}</p>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-xs font-semibold text-slate-700">Service</Label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              data-testid="canonical-done-service-type"
            >
              {DEFAULT_SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Procedure
            </p>
            <Button
              type="button"
              size="sm"
              disabled={procedureMut.isPending}
              onClick={() => procedureMut.mutate()}
              className="mt-2"
              data-testid="canonical-done-procedure-submit"
            >
              {procedureMut.isPending ? "Marking…" : "Mark procedure complete"}
            </Button>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Document
            </p>
            <Label className="mt-2 block text-xs font-semibold text-slate-700">Document type</Label>
            <select
              value={documentType}
              onChange={(e) => {
                const next = e.target.value;
                setDocumentType(next);
                const def = DOCUMENT_TYPE_OPTIONS.find((o) => o.value === next);
                if (def) setDocumentStatus(def.defaultStatus);
              }}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              data-testid="canonical-done-document-type"
            >
              {DOCUMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Label className="mt-2 block text-xs font-semibold text-slate-700">Status</Label>
            <Input
              value={documentStatus}
              onChange={(e) => setDocumentStatus(e.target.value)}
              className="mt-1.5 rounded-xl text-sm"
              data-testid="canonical-done-document-status"
            />
            <Button
              type="button"
              size="sm"
              disabled={docMut.isPending}
              onClick={() => docMut.mutate()}
              className="mt-2"
              data-testid="canonical-done-document-submit"
            >
              {docMut.isPending ? "Saving…" : "Mark document complete"}
            </Button>
          </div>

          <div className="flex items-center justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="canonical-done-close"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
