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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  loadCallDraft,
  saveCallDraft,
  clearCallDraft,
} from "@/components/playground/sessionPersistence";
import { parseStaleWorkClaim } from "@/lib/workflow/workClaimApi";
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

// Phase 5A — the previously flag-gated "structured canonical selector" (a
// SECOND disposition grid + its own submit button + engineering "Canonical
// call result (Phase 1)" labeling) has been REMOVED. There is now exactly ONE
// employee-facing disposition surface (the grid below), which already posts to
// the canonical engagement call-result endpoint. No behavior change for the
// default deployment (the selector shipped OFF); the duplicate is simply gone.

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

// Phase 5A — the small set of everyday outcomes shown up-front. Everything else
// lives under "More outcomes" so the common path is one tap and the sheet is
// not an 18-tile wall. (All outcomes still post the SAME canonical result.)
const PRIMARY_OUTCOME_VALUES: OutreachCallOutcome[] = [
  "reached",
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "declined",
  "wrong_number",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: number | null;
  patientName: string;
  schedulerUserId: string | null;
  /** Phase 5B — the execution case being dispositioned. When provided (with an
   *  authenticated owner), the in-progress draft (outcome/notes/callback) is
   *  persisted owner+case-scoped so it survives Phone↔Calendar switches, Atlas/
   *  history navigation, transient refetch, and a stale-claim rejection.
   *  Outreach surfaces omit it → no draft persistence (unchanged behavior). */
  executionCaseId?: number | null;
  /** Number of prior call attempts. Sheet shows the auto-incremented next # (priorAttempts + 1). */
  priorAttempts?: number;
  defaultOutcome?: OutreachCallOutcome;
  /** Phase 6 — provider telephony session id for an INTEGRATED call. When
   *  present, it is sent as the disposition's callKey so the ONE canonical
   *  outreach_calls row links to this telephony evidence (external_call_id ==
   *  telephony_sessions.provider_session_id). Manual/assisted omit it. */
  providerCallKey?: string | null;
  onLogged?: () => void;
  /** Phase 5B — invoked when the disposition is REJECTED because the claim is
   *  now held by someone else (stale work). The host should refetch the queue/
   *  case. The typed note draft is preserved regardless. */
  onClaimLost?: () => void;
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
  executionCaseId,
  priorAttempts = 0,
  defaultOutcome,
  providerCallKey,
  onLogged,
  onClaimLost,
  onPushToPlayground,
  onDraftChange,
}: Props) {
  const [outcome, setOutcome] = useState<OutreachCallOutcome | null>(defaultOutcome ?? null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState<string>(defaultCallbackIso());
  const [showMore, setShowMore] = useState(false);
  // Phase 5B — set when the server rejects the log because the claim is now
  // held by someone else. Preserves the draft + disables further submits.
  const [staleClaim, setStaleClaim] = useState(false);
  const { toast } = useToast();

  // Phase 5B — the authenticated owner (shares TeamPortalShell's cached query,
  // so no extra fetch). Drafts are scoped to this owner + the execution case so
  // one user can never read another's in-progress PHI note.
  const { data: authUser } = useQuery<{ id?: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const ownerUserId = authUser?.id ?? null;
  const draftEnabled =
    ownerUserId != null && typeof executionCaseId === "number" && executionCaseId > 0;

  // Reset / hydrate on open + patient/case change. Phase 5B: when draft
  // persistence is enabled, hydrate the in-progress draft (outcome/notes/
  // callback) for THIS owner + case so it survives Phone↔Calendar, Atlas/
  // history navigation, refetch, and a stale-claim rejection. Otherwise reset.
  // Keyed on open/patient/case/defaultOutcome (NOT owner) so it never clobbers
  // what the user is typing if auth resolves mid-session.
  useEffect(() => {
    if (!open) return;
    setStaleClaim(false);
    const draft = draftEnabled ? loadCallDraft(ownerUserId, executionCaseId) : null;
    if (draft) {
      const o = (draft.outcome as OutreachCallOutcome | null) ?? defaultOutcome ?? null;
      setOutcome(o);
      setNotes(draft.notes ?? "");
      setCallbackAt(draft.callbackAt ?? defaultCallbackIso());
      setShowMore(o != null && !PRIMARY_OUTCOME_VALUES.includes(o));
    } else {
      setOutcome(defaultOutcome ?? null);
      setNotes("");
      setCallbackAt(defaultCallbackIso());
      setShowMore(defaultOutcome != null && !PRIMARY_OUTCOME_VALUES.includes(defaultOutcome));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId, executionCaseId, defaultOutcome]);

  // Phase 5B — persist the in-progress draft (owner + case scoped) as the user
  // edits, so a Phone↔Calendar switch / Atlas / refetch never loses it.
  useEffect(() => {
    if (!open || !draftEnabled) return;
    saveCallDraft(ownerUserId, executionCaseId, { outcome, notes, callbackAt });
  }, [open, draftEnabled, ownerUserId, executionCaseId, outcome, notes, callbackAt]);

  // Emit unsaved-draft state to an optional host (Playground Call workspace).
  // Dirty once an outcome is chosen or notes are typed on either the legacy or
  // structured path. Cleared when the sheet closes (draft reset above).
  useEffect(() => {
    if (!onDraftChange) return;
    if (!open) {
      onDraftChange(false);
      return;
    }
    const dirty = outcome != null || notes.trim().length > 0;
    const label = outcome || "call disposition";
    onDraftChange(dirty, dirty ? `Unsaved ${label} disposition` : undefined);
  }, [open, outcome, notes, onDraftChange]);

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
      // Phase 6 — link this disposition to the provider telephony evidence:
      // the server stores callKey as outreach_calls.external_call_id, which
      // equals telephony_sessions.provider_session_id (business ↔ evidence).
      if (providerCallKey) canonicalBody.callKey = providerCallKey;
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
      // Phase 5B — the interaction is durably complete: clear this case's draft
      // (the server already released the claim in the same transaction).
      if (draftEnabled) clearCallDraft(ownerUserId, executionCaseId);
      onLogged?.();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      // Phase 5B — a stale/concurrent claim (someone else took over, or the
      // lease lapsed and was reclaimed) is NOT a normal error: preserve the
      // draft, do NOT pretend success, surface a calm recovery state, and let
      // the host refetch the current server state.
      const stale = parseStaleWorkClaim(e);
      if (stale.stale) {
        setStaleClaim(true);
        onClaimLost?.();
        return;
      }
      toast({ title: "Could not log call", description: e.message, variant: "destructive" });
    },
  });

  const grouped = {
    reached: OUTCOMES.filter((o) => o.group === "reached"),
    missed: OUTCOMES.filter((o) => o.group === "missed"),
    other: OUTCOMES.filter((o) => o.group === "other"),
  };
  // Phase 5A — everyday outcomes up-front; the rest under "More outcomes".
  const notPrimary = (o: OutcomeDef) => !PRIMARY_OUTCOME_VALUES.includes(o.value);
  const primaryDefs = PRIMARY_OUTCOME_VALUES
    .map((v) => OUTCOMES.find((o) => o.value === v))
    .filter((o): o is OutcomeDef => !!o);
  const moreGrouped = {
    reached: grouped.reached.filter(notPrimary),
    missed: grouped.missed.filter(notPrimary),
    other: grouped.other.filter(notPrimary),
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
  // Refused is a first-class result: a non-empty reason is REQUIRED before it
  // can be saved. The reason persists canonically in outreach_calls.notes (no
  // refusal-only subsystem). Covers the refusal family (DNC + declined +
  // not-interested).
  const REFUSAL_OUTCOMES = new Set<OutreachCallOutcome>(["refused_dnc", "declined", "not_interested"]);
  const isRefusal = outcome != null && REFUSAL_OUTCOMES.has(outcome);
  const refusalReasonMissing = isRefusal && notes.trim().length === 0;
  const canSubmit = !!outcome && !logCall.isPending && !staleClaim && !refusalReasonMissing;

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
          {renderGroup("Common outcomes", primaryDefs, "border-emerald-300 bg-emerald-50 text-emerald-800")}

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            aria-expanded={showMore}
            data-testid="disposition-more-toggle"
          >
            {showMore ? "Fewer outcomes" : "More outcomes"}
          </button>

          {showMore && (
            <div className="space-y-5" data-testid="disposition-more-outcomes">
              {moreGrouped.reached.length > 0 &&
                renderGroup("Reached patient", moreGrouped.reached, "border-emerald-300 bg-emerald-50 text-emerald-800")}
              {moreGrouped.missed.length > 0 &&
                renderGroup("Did not reach", moreGrouped.missed, "border-amber-300 bg-amber-50 text-amber-800")}
              {moreGrouped.other.length > 0 &&
                renderGroup("Other", moreGrouped.other, "border-slate-300 bg-slate-100 text-slate-700")}
            </div>
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
              {isRefusal ? (
                <>Reason for refusal <span className="text-rose-500">(required)</span></>
              ) : (
                <>Notes <span className="text-slate-400">(optional)</span></>
              )}
            </Label>
            <Textarea
              id="disposition-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={isRefusal ? "Why is the patient refusing? (required)" : "Anything the next caller should know…"}
              className={`mt-1.5 resize-none rounded-2xl text-sm ${refusalReasonMissing ? "border-rose-300 focus-visible:ring-rose-400" : "border-slate-200"}`}
              data-testid="disposition-notes"
              aria-invalid={refusalReasonMissing}
              aria-required={isRefusal}
            />
            {refusalReasonMissing && (
              <p className="mt-1 text-[11px] text-rose-600" data-testid="disposition-refusal-reason-required">
                A reason is required to record a refusal.
              </p>
            )}
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

          {staleClaim && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[13px]"
              data-testid="disposition-stale-claim"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="font-semibold text-amber-900">
                    This patient is now being worked by another team member
                  </div>
                  <p className="mt-0.5 text-amber-800">
                    Your note wasn't saved and is kept below so nothing is lost. Copy it if
                    you need it, then return to the queue.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(notes).catch(() => {});
                        toast({ title: "Note copied" });
                      }}
                      data-testid="disposition-stale-copy"
                    >
                      Copy note
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onClaimLost?.();
                        onOpenChange(false);
                      }}
                      data-testid="disposition-stale-return"
                    >
                      Return to queue
                    </Button>
                  </div>
                </div>
              </div>
            </div>
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
