import React, { useEffect, useState } from "react";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { PanelPopupCard } from "../components/PanelPopupCard";
import { useCommandCenter } from "../context/CommandCenterContext";
import { PopupPatientPicker, type PickedPatient } from "../components/PopupPatientPicker";
import { getPatientDirectorySnapshot } from "@/lib/patientDirectoryApi";
import { sendOutreachEmail } from "@/lib/portal/commandCenterApi";
import { useToast } from "@/hooks/use-toast";

export function EmailDockPopup() {
  const { profile } = useCommandCenter();
  const { toast } = useToast();
  const [picked, setPicked] = useState<PickedPatient | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Prefill the recipient from the patient record when one is picked.
  useEffect(() => {
    let cancelled = false;
    if (!picked) {
      setTo("");
      return;
    }
    getPatientDirectorySnapshot(picked.patientScreeningId)
      .then((snap) => {
        if (!cancelled && snap?.profile.identity.email) setTo(snap.profile.identity.email);
      })
      .catch(() => {
        /* leave To empty so the user can type it */
      });
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("Select a patient first.");
      const recipient = to.trim();
      if (!recipient) throw new Error("Recipient email is required.");
      if (!subject.trim()) throw new Error("Subject is required.");
      if (!body.trim()) throw new Error("Body is required.");
      return sendOutreachEmail({
        patientScreeningId: picked.patientScreeningId,
        to: recipient,
        subject: subject.trim(),
        body,
      });
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: `${picked?.name ?? "Patient"}` });
      setSubject("");
      setBody("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Could not send email",
        variant: "destructive",
      });
    },
  });

  const sendError =
    sendMutation.isError && sendMutation.error instanceof Error ? sendMutation.error.message : null;

  const sendDisabled = !picked || !to.trim() || !subject.trim() || !body.trim() || sendMutation.isPending;

  const context = {
    sourceSurface: profile.surface,
    componentType: "email" as const,
    patientName: picked?.name,
    title: "Email Composer",
  };

  return (
    <PanelPopupCard title="Email" eyebrow="Composer" icon={<Mail className="h-5 w-5" />} context={context}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto" data-testid="command-left-rail-email-panel">
        <PopupPatientPicker
          picked={picked}
          onPick={setPicked}
          onClear={() => setPicked(null)}
          placeholder="Search patient to email…"
        />

        <input
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder={picked ? "recipient@example.com" : "Select a patient first"}
          disabled={!picked}
          data-testid="email-to"
        />
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          placeholder="Subject"
          disabled={!picked}
          data-testid="email-subject"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-24 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-300"
          placeholder="Write your message…"
          disabled={!picked}
          data-testid="email-body"
        />

        {sendError ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">{sendError}</div>
          </div>
        ) : null}

        <button
          type="button"
          disabled={sendDisabled}
          onClick={() => sendMutation.mutate()}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          data-testid="email-send"
        >
          {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Send
        </button>
      </div>
    </PanelPopupCard>
  );
}
