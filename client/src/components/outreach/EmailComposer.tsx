import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Maximize2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OutreachCallItem } from "./types";

export function defaultEmailFor(p: OutreachCallItem | null, facility: string): { to: string; subject: string; body: string } {
  if (!p) return { to: "", subject: "", body: "" };
  const subject = `Scheduling your visit at ${p.facility || facility}`;
  const body = `Hi ${p.patientName.split(" ")[0] || ""},\n\nThis is your scheduler from ${p.facility || facility}. We'd like to book your upcoming ${p.qualifyingTests.join(" / ") || "screening"} visit. Please reply with a time that works best for you, or call us at the number on file.\n\nThank you,\nScheduling Team`;
  return { to: p.email || "", subject, body };
}

export function EmailComposer({
  selectedItem, facility, onExpand, fullWidth = false,
}: {
  selectedItem: OutreachCallItem | null;
  facility: string;
  onExpand?: () => void;
  fullWidth?: boolean;
}) {
  const { toast } = useToast();
  const initial = useMemo(() => defaultEmailFor(selectedItem, facility), [selectedItem, facility]);
  const [to, setTo] = useState(initial.to);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);

  useEffect(() => {
    setTo(initial.to);
    setSubject(initial.subject);
    setBody(initial.body);
  }, [initial]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("No patient selected");
      const res = await apiRequest("POST", "/api/outreach/send-email", {
        patientScreeningId: selectedItem.patientId,
        to,
        subject,
        body,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: `Sent to ${selectedItem?.patientName ?? "patient"}.` });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
    },
    onError: (err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      const cleaned = raw.replace(/^\d+:\s*/, "");
      let description = cleaned;
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed?.error) description = String(parsed.error);
      } catch { /* not JSON, use raw */ }
      toast({ title: "Email failed", description, variant: "destructive" });
    },
  });

  function handleSend() {
    if (!selectedItem) {
      toast({ title: "No patient selected", description: "Pick a patient from the call list first.", variant: "destructive" });
      return;
    }
    if (!to.trim()) {
      toast({ title: "Recipient required", description: "Add the patient's email address before sending.", variant: "destructive" });
      return;
    }
    sendMutation.mutate();
  }

  return (
    <div className="space-y-2" data-testid="email-composer">
      {!fullWidth && onExpand && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onExpand}
            title="Expand email"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:bg-emerald-50"
            data-testid="hub-expand-email"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      )}
      <div>
        <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">To</Label>
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="patient@example.com" className="mt-1 h-8 text-sm rounded-xl" data-testid="email-to" />
      </div>
      <div>
        <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Subject</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 h-8 text-sm rounded-xl" data-testid="email-subject" />
      </div>
      <div>
        <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={fullWidth ? 14 : 5}
          className="mt-1 text-sm rounded-xl"
          data-testid="email-body"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400 truncate">
          {selectedItem ? `Pre-filled for ${selectedItem.patientName}` : "Pick a patient to pre-fill"}
        </span>
        <Button size="sm" onClick={handleSend} disabled={sendMutation.isPending} className="h-8 rounded-full" data-testid="email-send">
          <Send className="h-3.5 w-3.5 mr-1" /> {sendMutation.isPending ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
