import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import {
  logPatientCommunication,
  type LogCommunicationInput,
  type PatientCommunicationType,
} from "@/lib/portal/commandCenterApi";
import { useToast } from "@/hooks/use-toast";

// Single dialog for logging Call / Text / Email / Internal Note. No
// SMS backend exists yet, so Text is explicitly "Log Text" with a
// summary + body — not a send. Email is also "Log Email" when used
// here; actual marketing email sends go through PortalMarketingTab.

export type LogCommunicationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientScreeningId: number | null;
  patientName?: string | null;
  patientEmail?: string | null;
  patientPhone?: string | null;
  defaultType?: PatientCommunicationType;
};

const TYPE_OPTIONS: Array<{ value: PatientCommunicationType; label: string; helper: string }> = [
  { value: "call", label: "Log Call", helper: "Phone outreach outcome" },
  { value: "sms", label: "Log Text", helper: "SMS sent or attempted (logged only — no SMS backend wired)" },
  { value: "email", label: "Log Email", helper: "Plain email send/attempt (use Marketing tab for material sends)" },
  { value: "internal_note", label: "Internal Note", helper: "Team-only note on this patient's timeline" },
];

export function LogCommunicationDialog({
  open,
  onOpenChange,
  patientScreeningId,
  patientName,
  patientEmail,
  patientPhone,
  defaultType = "call",
}: LogCommunicationDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [type, setType] = useState<PatientCommunicationType>(defaultType);
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [toAddress, setToAddress] = useState(patientEmail ?? "");
  const [phone, setPhone] = useState(patientPhone ?? "");

  useEffect(() => {
    if (open) {
      setType(defaultType);
      setSummary("");
      setOutcome("");
      setBody("");
      setSubject("");
      setToAddress(patientEmail ?? "");
      setPhone(patientPhone ?? "");
    }
  }, [open, defaultType, patientEmail, patientPhone]);

  const typeMeta = useMemo(
    () => TYPE_OPTIONS.find((t) => t.value === type) ?? TYPE_OPTIONS[0],
    [type],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!patientScreeningId) throw new Error("Patient not loaded");
      if (!summary.trim()) throw new Error("Summary is required");
      const input: LogCommunicationInput = {
        patientScreeningId,
        communicationType: type,
        direction: "outbound",
        status: "logged",
        summary: summary.trim(),
        outcome: outcome.trim() || undefined,
        subject: subject.trim() || undefined,
        bodyPreview: body.trim() ? body.trim().slice(0, 280) : undefined,
        bodyFull: body.trim() || undefined,
        toAddress: type === "email" ? toAddress.trim() || undefined : undefined,
        phoneNumber:
          type === "sms" || type === "call" ? phone.trim() || undefined : undefined,
      };
      return logPatientCommunication(input);
    },
    onSuccess: () => {
      toast({
        title: `${typeMeta.label.replace(/^Log /, "")} logged`,
        description: patientName ?? undefined,
      });
      queryClient.invalidateQueries({
        queryKey: ["portal-command-center", patientScreeningId],
      });
      queryClient.invalidateQueries({ queryKey: ["portal-my-patients"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not log",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-md" data-testid="log-communication-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">{typeMeta.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  type === opt.value
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                data-testid={`log-communication-type-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="text-[10px] text-slate-500">{typeMeta.helper}</div>

          {type === "call" && (
            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Outcome
              </Label>
              <Input
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="e.g. reached, voicemail, callback"
                className="mt-1 h-8 text-xs"
                data-testid="input-log-communication-outcome"
              />
            </div>
          )}

          {type === "email" && (
            <>
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  To
                </Label>
                <Input
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  placeholder={patientEmail ?? "patient@example.com"}
                  className="mt-1 h-8 text-xs"
                  data-testid="input-log-communication-to"
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Subject
                </Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 h-8 text-xs"
                  data-testid="input-log-communication-subject"
                />
              </div>
            </>
          )}

          {type === "sms" && (
            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Phone
              </Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={patientPhone ?? "(602) 555-…"}
                className="mt-1 h-8 text-xs"
                data-testid="input-log-communication-phone"
              />
            </div>
          )}

          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Summary
            </Label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-line summary for the timeline"
              className="mt-1 h-8 text-xs"
              data-testid="input-log-communication-summary"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {type === "email" ? "Body" : type === "sms" ? "Message" : "Detail"}
            </Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 min-h-[80px] text-xs"
              placeholder="Full text (optional)"
              data-testid="textarea-log-communication-body"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            data-testid="button-log-communication-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !patientScreeningId || mutation.isPending || !summary.trim()
            }
            className="gap-1.5"
            data-testid="button-log-communication-submit"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Log {typeMeta.label.replace(/^Log /, "")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
