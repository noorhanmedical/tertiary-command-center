import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneCall,
  PhoneOff,
  Voicemail,
  PhoneMissed,
  CalendarCheck,
  XCircle,
  Ban,
  Languages,
  HelpCircle,
  UserX,
  Hash,
} from "lucide-react";
import type { OutreachCallOutcome } from "@shared/schema";

type OutcomeDef = {
  value: OutreachCallOutcome;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  group: "reached" | "missed" | "other";
};

const OUTCOMES: OutcomeDef[] = [
  // Reached
  { value: "reached",          label: "Spoke with patient",  Icon: PhoneCall,     group: "reached" },
  { value: "scheduled",        label: "Scheduled",           Icon: CalendarCheck, group: "reached" },
  { value: "callback",         label: "Callback later",      Icon: PhoneCall,     group: "reached" },
  { value: "declined",         label: "Declined",            Icon: XCircle,       group: "reached" },
  { value: "not_interested",   label: "Not interested",      Icon: Ban,           group: "reached" },
  { value: "language_barrier", label: "Language barrier",    Icon: Languages,     group: "reached" },
  // Did not reach
  { value: "no_answer",        label: "No answer",           Icon: PhoneMissed,   group: "missed" },
  { value: "voicemail",        label: "Left voicemail",      Icon: Voicemail,     group: "missed" },
  { value: "busy",             label: "Busy / call dropped", Icon: PhoneOff,      group: "missed" },
  // Other
  { value: "wrong_number",     label: "Wrong number",        Icon: Hash,          group: "other" },
  { value: "deceased",         label: "Deceased",            Icon: UserX,         group: "other" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number | null;
  patientName: string;
  schedulerUserId: string | null;
  defaultOutcome?: OutreachCallOutcome;
  onLogged?: () => void;
};

function defaultCallbackIso(): string {
  // Tomorrow at 10am local
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DispositionSheet({
  open,
  onOpenChange,
  patientId,
  patientName,
  schedulerUserId,
  defaultOutcome,
  onLogged,
}: Props) {
  const [outcome, setOutcome] = useState<OutreachCallOutcome | null>(defaultOutcome ?? null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState<string>(defaultCallbackIso());
  const { toast } = useToast();

  // Reset on patient change / open
  useEffect(() => {
    if (open) {
      setOutcome(defaultOutcome ?? null);
      setNotes("");
      setCallbackAt(defaultCallbackIso());
    }
  }, [open, patientId, defaultOutcome]);

  const logCall = useMutation({
    mutationFn: async () => {
      if (patientId == null || !outcome) throw new Error("Missing patient or outcome");
      const body: Record<string, unknown> = {
        patientScreeningId: patientId,
        outcome,
        notes: notes.trim() || null,
        schedulerUserId: schedulerUserId,
      };
      if (outcome === "callback" && callbackAt) {
        body.callbackAt = new Date(callbackAt).toISOString();
      }
      const res = await apiRequest("POST", "/api/outreach/calls", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to log call");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Call logged" });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/today"] });
      onLogged?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Could not log call", description: e.message, variant: "destructive" }),
  });

  const grouped = {
    reached: OUTCOMES.filter((o) => o.group === "reached"),
    missed: OUTCOMES.filter((o) => o.group === "missed"),
    other: OUTCOMES.filter((o) => o.group === "other"),
  };

  function renderGroup(label: string, items: OutcomeDef[], colorClass: string) {
    return (
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {label}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {items.map(({ value, label: l, Icon }) => {
            const active = outcome === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                className={[
                  "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition",
                  active
                    ? `${colorClass} ring-2 ring-offset-1 ring-current`
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                ].join(" ")}
                data-testid={`disposition-option-${value}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{l}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const isCallback = outcome === "callback";
  const canSubmit = !!outcome && !logCall.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        data-testid="disposition-sheet"
      >
        <SheetHeader>
          <SheetTitle>Log call outcome</SheetTitle>
          <SheetDescription>{patientName || "—"}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {renderGroup("Reached patient", grouped.reached, "border-emerald-300 bg-emerald-50 text-emerald-800")}
          {renderGroup("Did not reach", grouped.missed, "border-amber-300 bg-amber-50 text-amber-800")}
          {renderGroup("Other", grouped.other, "border-slate-300 bg-slate-100 text-slate-700")}

          {isCallback && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3" data-testid="disposition-callback-block">
              <Label className="text-xs font-semibold text-amber-800">Callback at</Label>
              <Input
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                className="mt-1.5 rounded-xl border-amber-200 bg-white text-sm"
                data-testid="disposition-callback-input"
              />
              <p className="mt-1 text-[11px] text-amber-700/80">
                Patient will reappear in the priority queue at this time.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="disposition-notes" className="text-xs font-semibold text-slate-700">
              Notes <span className="text-slate-400">(optional)</span>
            </Label>
            <Textarea
              id="disposition-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Anything the next caller should know…"
              className="mt-1.5 resize-none rounded-2xl border-slate-200 text-sm"
              data-testid="disposition-notes"
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="disposition-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() => logCall.mutate()}
              className="rounded-full bg-indigo-600 px-5 text-white hover:bg-indigo-700 disabled:opacity-40"
              data-testid="disposition-submit"
            >
              {logCall.isPending ? "Logging…" : "Log call"}
            </Button>
          </div>

          {!outcome && (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <HelpCircle className="h-3.5 w-3.5" />
              Pick an outcome to enable logging.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
