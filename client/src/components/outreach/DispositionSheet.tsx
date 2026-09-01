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
import { engagementCallResultEndpoint } from "@/lib/engagementCanonicalCallResultsUiFlag";
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
  Info,
  Clock,
  ShieldAlert,
  Inbox,
  PhoneForwarded,
  Unplug,
  Truck,
} from "lucide-react";
import type { OutreachCallOutcome } from "@shared/schema";

// Phase 1 Segment E Batch 4 — structured call-result selector flag.
// Default OFF: when unset/false the legacy outcome grid is the only
// disposition surface. When truthy, an additive structured selector
// appears below the legacy controls and posts canonical payloads to
// engagementCallResultEndpoint(). See:
//   docs/architecture/team-portal-structured-call-result-selector-contract.md
const STRUCTURED_SELECTOR_ENABLED = (() => {
  const v = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR;
  return v === "1" || v === "true" || v === "yes";
})();

// Phase 1 Segment E Batch 9 — primary write switch. When OFF (default
// after E9 ships) the legacy outcome grid posts to the canonical
// Engagement endpoint and the best-effort canonical mirror is gone.
// When ON, the prior dual-write behavior is restored as a one-release
// rollback fallback. See:
//   docs/architecture/team-portal-canonical-call-result-write-switch-plan.md
const LEGACY_DISPOSITION_WRITE_ENABLED = (() => {
  const v = (import.meta as { env?: Record<string, unknown> }).env
    ?.VITE_USE_LEGACY_DISPOSITION_WRITE;
  return v === "1" || v === "true" || v === "yes";
})();

const CANONICAL_OUTCOMES = [
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
  "completed",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
] as const;
type CanonicalOutcome = (typeof CANONICAL_OUTCOMES)[number];

const CANONICAL_OUTCOME_LABELS: Record<CanonicalOutcome, string> = {
  scheduled: "Scheduled",
  callback: "Callback later",
  no_answer: "No answer",
  voicemail: "Voicemail",
  wrong_number: "Wrong number",
  declined: "Declined",
  needs_records: "Needs records",
  insurance_prior_auth_issue: "Insurance / prior auth issue",
  manager_review: "Manager review",
  facility_specific_issue: "Facility-specific issue",
  completed: "Completed",
  dnc: "DNC",
  do_not_contact: "Do not contact",
  deceased: "Deceased",
  cancelled: "Cancelled",
};

const OUTREACH_TERMINAL_OUTCOMES: ReadonlySet<CanonicalOutcome> = new Set<CanonicalOutcome>([
  "completed",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
]);

type OutcomeDef = {
  value: OutreachCallOutcome;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  group: "reached" | "missed" | "other";
};

const OUTCOMES: OutcomeDef[] = [
  // Reached
  { value: "reached",             label: "Spoke with patient",   Icon: PhoneCall,        group: "reached" },
  { value: "scheduled",           label: "Scheduled",            Icon: CalendarCheck,    group: "reached" },
  { value: "callback",            label: "Callback later",       Icon: Clock,            group: "reached" },
  { value: "wants_more_info",     label: "Wants more info",      Icon: Info,             group: "reached" },
  { value: "will_think_about_it", label: "Will think about it",  Icon: HelpCircle,       group: "reached" },
  { value: "declined",            label: "Declined",             Icon: XCircle,          group: "reached" },
  { value: "not_interested",      label: "Not interested",       Icon: Ban,              group: "reached" },
  { value: "refused_dnc",         label: "Refused (DNC)",        Icon: ShieldAlert,      group: "reached" },
  { value: "language_barrier",    label: "Language barrier",     Icon: Languages,        group: "reached" },
  // Did not reach
  { value: "no_answer",           label: "No answer",            Icon: PhoneMissed,      group: "missed" },
  { value: "voicemail",           label: "Left voicemail",       Icon: Voicemail,        group: "missed" },
  { value: "mailbox_full",        label: "Mailbox full",         Icon: Inbox,            group: "missed" },
  { value: "busy",                label: "Busy / call dropped",  Icon: PhoneOff,         group: "missed" },
  { value: "hung_up",             label: "Hung up",              Icon: PhoneForwarded,   group: "missed" },
  { value: "disconnected",        label: "Number disconnected",  Icon: Unplug,           group: "missed" },
  // Other
  { value: "wrong_number",        label: "Wrong number",         Icon: Hash,             group: "other" },
  { value: "moved",               label: "Patient moved",        Icon: Truck,            group: "other" },
  { value: "deceased",            label: "Deceased",             Icon: UserX,            group: "other" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number | null;
  patientName: string;
  schedulerUserId: string | null;
  /** Number of prior call attempts. Sheet shows the auto-incremented next # (priorAttempts + 1). */
  priorAttempts?: number;
  defaultOutcome?: OutreachCallOutcome;
  onLogged?: () => void;
  /**
   * Optional — emitted when the in-progress disposition draft changes. Lets a
   * host (e.g. the Playground Call workspace) reflect unsaved state. `dirty` is
   * true once an outcome is picked or notes are typed, and false after a
   * successful log or a reset. Outreach surfaces omit this and are unaffected.
   */
  onDraftChange?: (dirty: boolean, description?: string) => void;
  /** Optional — when provided, a "Push to Playground" action appears in the
   *  sheet so the caller can send this patient into the detailed Playground
   *  workspace. Outreach surfaces omit this and are unaffected. */
  onPushToPlayground?: () => void;
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
  priorAttempts = 0,
  defaultOutcome,
  onLogged,
  onPushToPlayground,
  onDraftChange,
}: Props) {
  const [outcome, setOutcome] = useState<OutreachCallOutcome | null>(defaultOutcome ?? null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState<string>(defaultCallbackIso());
  const { toast } = useToast();

  // Structured selector state (only consulted when the flag is ON).
  const [canonicalOutcome, setCanonicalOutcome] = useState<CanonicalOutcome | "">("");
  const [canonicalNotes, setCanonicalNotes] = useState("");
  const [canonicalCallbackAt, setCanonicalCallbackAt] = useState<string>(defaultCallbackIso());
  const [canonicalDesiredApptStatus, setCanonicalDesiredApptStatus] = useState<string>("scheduled");
  const [canonicalTerminalReason, setCanonicalTerminalReason] = useState<string>("");

  // Reset on patient change / open
  useEffect(() => {
    if (open) {
      setOutcome(defaultOutcome ?? null);
      setNotes("");
      setCallbackAt(defaultCallbackIso());
      setCanonicalOutcome("");
      setCanonicalNotes("");
      setCanonicalCallbackAt(defaultCallbackIso());
      setCanonicalDesiredApptStatus("scheduled");
      setCanonicalTerminalReason("");
    }
  }, [open, patientId, defaultOutcome]);

  // Emit unsaved-draft state to an optional host (Playground Call workspace).
  // Dirty once an outcome is chosen or notes are typed on either the legacy or
  // structured path. Cleared when the sheet closes (draft reset above).
  useEffect(() => {
    if (!onDraftChange) return;
    if (!open) {
      onDraftChange(false);
      return;
    }
    const hasLegacyDraft = outcome != null || notes.trim().length > 0;
    const hasCanonicalDraft = canonicalOutcome !== "" || canonicalNotes.trim().length > 0;
    const dirty = hasLegacyDraft || hasCanonicalDraft;
    const label = (outcome ?? canonicalOutcome) || "call disposition";
    onDraftChange(dirty, dirty ? `Unsaved ${label} disposition` : undefined);
  }, [open, outcome, notes, canonicalOutcome, canonicalNotes, onDraftChange]);

  const logCall = useMutation({
    mutationFn: async () => {
      if (patientId == null || !outcome) throw new Error("Missing patient or outcome");
      const trimmedNotes = notes.trim();
      const nextActionIso = outcome === "callback" && callbackAt
        ? new Date(callbackAt).toISOString()
        : null;

      if (LEGACY_DISPOSITION_WRITE_ENABLED) {
        // Rollback path — restores the pre-E9 dual-write behavior
        // exactly. Primary POST is the legacy outreach endpoint;
        // canonical mirror runs best-effort. Drop this branch one
        // release after E9 ships clean.
        const legacyBody: Record<string, unknown> = {
          patientScreeningId: patientId,
          outcome,
          notes: trimmedNotes || null,
          schedulerUserId: schedulerUserId,
        };
        if (nextActionIso) legacyBody.callbackAt = nextActionIso;
        const res = await apiRequest("POST", "/api/outreach/calls", legacyBody);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to log call");
        }
        const created = await res.json();
        try {
          const mirrorBody: Record<string, unknown> = {
            patientScreeningId: patientId,
            patientName: patientName || undefined,
            callResult: outcome,
            callDisposition: outcome,
            note: trimmedNotes || undefined,
            assignedUserId: schedulerUserId ?? undefined,
          };
          if (nextActionIso) mirrorBody.nextActionAt = nextActionIso;
          await apiRequest("POST", engagementCallResultEndpoint(), mirrorBody);
        } catch (mirrorErr) {
          console.warn("[disposition] canonical call-result mirror failed", mirrorErr);
        }
        return created;
      }

      // Default path post-E9 — canonical Engagement endpoint is the
      // sole primary write. The canonical planner owns the spine
      // (outreach_calls, journey events, triage, tasks, assignment),
      // so no secondary mirror is needed. Failures surface to the
      // caller via onError.
      const canonicalBody: Record<string, unknown> = {
        patientScreeningId: patientId,
        patientName: patientName || undefined,
        callResult: outcome,
        callDisposition: outcome,
        note: trimmedNotes || undefined,
        assignedUserId: schedulerUserId ?? undefined,
        schedulerUserId: schedulerUserId ?? undefined,
      };
      if (nextActionIso) canonicalBody.nextActionAt = nextActionIso;
      const canonicalRes = await apiRequest("POST", engagementCallResultEndpoint(), canonicalBody);
      if (!canonicalRes.ok) {
        const err = await canonicalRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to log call");
      }
      return canonicalRes.json().catch(() => ({}));
    },
    onSuccess: () => {
      toast({ title: "Call logged" });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls"] });
      // The portal renders its timeline / last-outcome / attempt pills from
      // the bulk by-patients query — invalidate it so the row updates
      // immediately, not after the next 60s poll.
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/by-patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/today"] });
      // Phase 1 Segment E Batch 10 — refresh Team Portal assigned-work
      // surfaces so the cockpit reflects engagement-completed state
      // immediately (instead of waiting for the next poll).
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/outreach-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/today-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["portal-call-history", patientId] });
      // Slice 1.4: PCS Workspace shell reads call list via the
      // canonical /api/scheduler-portal/cases feed under a separate
      // React-Query key. Invalidate both keys so the workspace shows
      // the next call without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "team-workspace-call-list",
      });
      onLogged?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Could not log call", description: e.message, variant: "destructive" }),
  });

  // Phase 1 Segment E Batch 4 — canonical structured submission.
  // Only invoked when the structured selector flag is ON. Posts the
  // E3-contract payload to engagementCallResultEndpoint(); the legacy
  // logCall flow above is unchanged and remains the OFF-flag default.
  const logCanonicalCall = useMutation({
    mutationFn: async () => {
      if (patientId == null || !canonicalOutcome) throw new Error("Missing patient or canonical outcome");
      const isCallbackOutcome = canonicalOutcome === "callback";
      const isScheduledOutcome = canonicalOutcome === "scheduled";
      const isTerminalOutcome = OUTREACH_TERMINAL_OUTCOMES.has(canonicalOutcome);
      if (isCallbackOutcome && !canonicalCallbackAt) throw new Error("Callback time required");
      if (isScheduledOutcome && !canonicalDesiredApptStatus) throw new Error("Desired appointment status required");
      if (isTerminalOutcome && !canonicalTerminalReason.trim()) throw new Error("Terminal completion reason required");
      const nextActionIso = isCallbackOutcome && canonicalCallbackAt
        ? new Date(canonicalCallbackAt).toISOString()
        : null;
      const body: Record<string, unknown> = {
        patientScreeningId: patientId,
        patientName: patientName || undefined,
        callResult: canonicalOutcome,
        callDisposition: canonicalOutcome,
        note: canonicalNotes.trim() || undefined,
        assignedUserId: schedulerUserId ?? undefined,
        callMetadata: { source: "team-portal", ringCentralCallId: null },
      };
      if (nextActionIso) body.nextActionAt = nextActionIso;
      if (isScheduledOutcome) {
        body.desiredAppointmentStatus = canonicalDesiredApptStatus;
        if (schedulerUserId) body.schedulerUserId = schedulerUserId;
      }
      if (isTerminalOutcome) {
        body.terminalCompletionReason = canonicalTerminalReason.trim();
      }
      const res = await apiRequest("POST", engagementCallResultEndpoint(), body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to log canonical call result");
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      toast({ title: "Canonical call result logged" });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/by-patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/today"] });
      // Phase 1 Segment E Batch 10 — refresh Team Portal assigned-work
      // surfaces so the cockpit reflects engagement-completed state
      // immediately (instead of waiting for the next poll).
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/outreach-call-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/today-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["portal-call-history", patientId] });
      // Slice 1.4: PCS Workspace shell reads call list via the
      // canonical /api/scheduler-portal/cases feed under a separate
      // React-Query key. Invalidate both keys so the workspace shows
      // the next call without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "team-workspace-call-list",
      });
      onLogged?.();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Could not log canonical result", description: e.message, variant: "destructive" }),
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
        className="z-[95] w-full sm:max-w-md overflow-y-auto"
        data-testid="disposition-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-3">
            <span>Log call outcome</span>
            <span
              className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700"
              data-testid="disposition-attempt-counter"
            >
              Attempt #{priorAttempts + 1}
            </span>
          </SheetTitle>
          <SheetDescription>{patientName || "—"}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {renderGroup("Reached patient", grouped.reached, "border-emerald-300 bg-emerald-50 text-emerald-800")}
          {renderGroup("Did not reach", grouped.missed, "border-amber-300 bg-amber-50 text-amber-800")}
          {renderGroup("Other", grouped.other, "border-slate-300 bg-slate-100 text-slate-700")}

          {STRUCTURED_SELECTOR_ENABLED && (
            <section
              className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3"
              data-testid="canonical-call-result-selector"
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
                Canonical call result (Phase 1)
              </p>
              <Label htmlFor="canonical-outcome" className="text-xs font-semibold text-indigo-900">
                Outcome
              </Label>
              <select
                id="canonical-outcome"
                value={canonicalOutcome}
                onChange={(e) => setCanonicalOutcome((e.target.value || "") as CanonicalOutcome | "")}
                className="mt-1.5 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm"
                data-testid="canonical-outcome-select"
              >
                <option value="">— select canonical outcome —</option>
                {CANONICAL_OUTCOMES.map((v) => (
                  <option key={v} value={v} data-testid={`canonical-outcome-option-${v}`}>
                    {CANONICAL_OUTCOME_LABELS[v]}
                  </option>
                ))}
              </select>

              {canonicalOutcome === "callback" && (
                <div className="mt-3" data-testid="canonical-callback-block">
                  <Label className="text-xs font-semibold text-indigo-900">Callback at</Label>
                  <Input
                    type="datetime-local"
                    value={canonicalCallbackAt}
                    onChange={(e) => setCanonicalCallbackAt(e.target.value)}
                    className="mt-1 rounded-xl border-indigo-200 bg-white text-sm"
                    data-testid="canonical-callback-input"
                  />
                </div>
              )}

              {canonicalOutcome === "scheduled" && (
                <div className="mt-3" data-testid="canonical-scheduled-block">
                  <Label className="text-xs font-semibold text-indigo-900">Desired appointment status</Label>
                  <Input
                    type="text"
                    value={canonicalDesiredApptStatus}
                    onChange={(e) => setCanonicalDesiredApptStatus(e.target.value)}
                    placeholder="scheduled"
                    className="mt-1 rounded-xl border-indigo-200 bg-white text-sm"
                    data-testid="canonical-desired-appt-status-input"
                  />
                </div>
              )}

              {canonicalOutcome && OUTREACH_TERMINAL_OUTCOMES.has(canonicalOutcome) && (
                <div className="mt-3" data-testid="canonical-terminal-block">
                  <Label className="text-xs font-semibold text-indigo-900">Terminal completion reason</Label>
                  <Input
                    type="text"
                    value={canonicalTerminalReason}
                    onChange={(e) => setCanonicalTerminalReason(e.target.value)}
                    placeholder="e.g. completed-outreach, dnc-request"
                    className="mt-1 rounded-xl border-indigo-200 bg-white text-sm"
                    data-testid="canonical-terminal-reason-input"
                  />
                </div>
              )}

              <div className="mt-3">
                <Label htmlFor="canonical-notes" className="text-xs font-semibold text-indigo-900">
                  Notes <span className="text-indigo-400">(optional)</span>
                </Label>
                <Textarea
                  id="canonical-notes"
                  value={canonicalNotes}
                  onChange={(e) => setCanonicalNotes(e.target.value)}
                  rows={3}
                  className="mt-1 resize-none rounded-xl border-indigo-200 bg-white text-sm"
                  data-testid="canonical-notes"
                />
              </div>

              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  disabled={!canonicalOutcome || logCanonicalCall.isPending}
                  onClick={() => logCanonicalCall.mutate()}
                  className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-40"
                  data-testid="canonical-submit"
                >
                  {logCanonicalCall.isPending ? "Logging…" : "Log canonical result"}
                </Button>
              </div>
            </section>
          )}

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

          {onPushToPlayground && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onPushToPlayground();
                onOpenChange(false);
              }}
              className="w-full rounded-full border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              data-testid="disposition-push-to-playground"
            >
              Push to Playground
            </Button>
          )}

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
