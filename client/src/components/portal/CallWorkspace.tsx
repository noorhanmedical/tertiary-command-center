import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSketchEnv } from "@/components/playground/sketch/PlaygroundSketchProvider";
import { SketchAwareButton } from "@/components/playground/sketch/SketchAwareButton";
import { SketchSurface, SketchBadge, SketchButton } from "@/components/playground/sketch/SketchPrimitives";
import {
  Phone,
  PhoneOff,
  PhoneCall,
  CalendarDays,
  FileText,
  FileBarChart,
  Maximize2,
  Loader2,
  AlertCircle,
  ExternalLink,
  Download,
  ShieldAlert,
  Stethoscope,
  Building2,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchPatientCommandCenter,
  type CommandCenterResponse,
} from "@/lib/portal/commandCenterApi";
import {
  useCaseProofDocs,
  isRingCentralClickToCallEnabled,
  type CallCaseContext,
  type CaseProofDoc,
} from "@/components/portal/caseWorkspace";
import {
  resolvePhoneProvider,
  getClientPhoneProviderPreferences,
  setTeamMemberPhoneProviderOverride,
  AVAILABLE_PROVIDER_IDS,
} from "@/features/command-center/providers/phoneProviderResolver";
import {
  usePhoneProviderPreferences,
  useSavePhoneProviderDefault,
} from "@/features/command-center/providers/phoneProviderSettingsApi";
import { isSelectablePhoneProviderId } from "@shared/phoneProvider";
import type { PhoneProviderId } from "@/features/command-center/providers/phoneProviderTypes";
import type { PhoneCallSession } from "@/features/command-center/providers/phoneProviderTypes";
import { DispositionSheet } from "@/components/outreach/DispositionSheet";
import type { OutreachCallOutcome } from "@shared/schema";

export type CallWorkspaceProps = {
  ctx: CallCaseContext;
  /** Open the Schedule workflow tab for this case. */
  onScheduleCase: () => void;
  /** Open the Case Overview workflow tab for this case. */
  onOpenCase: () => void;
  /** Close this Call tab. */
  onClose: () => void;
  /** Optional — bubbled from the disposition sheet's unsaved-draft state. */
  onDraftChange?: (dirty: boolean, description?: string) => void;
  /** Optional — fired after a call is successfully logged (canonical save). */
  onLogged?: () => void;
  /**
   * Optional one-shot signal: when this number increases, the disposition
   * sheet is opened. Lets a host (Playground "Save & Close") route the user to
   * complete the canonical disposition instead of silently persisting.
   */
  requestOpenDisposition?: number;
};

// Quick-disposition shortcuts. Each pre-selects an outcome in the
// canonical DispositionSheet (no new write path — the sheet posts to the
// canonical engagement call-result endpoint). Labels are honest about
// what the value means; values map to OutreachCallOutcome.
const QUICK_OUTCOMES: Array<{
  value: OutreachCallOutcome;
  label: string;
  tone: "emerald" | "amber" | "slate" | "rose";
}> = [
  { value: "reached", label: "Reached", tone: "emerald" },
  { value: "scheduled", label: "Scheduled", tone: "emerald" },
  { value: "callback", label: "Needs follow-up", tone: "amber" },
  { value: "no_answer", label: "No answer", tone: "amber" },
  { value: "voicemail", label: "Left voicemail", tone: "amber" },
  { value: "declined", label: "Declined", tone: "rose" },
  { value: "disconnected", label: "Unable to contact", tone: "rose" },
  { value: "wrong_number", label: "Wrong number", tone: "slate" },
];

const TONE_CLASS: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  amber: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  rose: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
  slate: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
};

// Context-aware panel: a SketchSurface inside the Playground canvas, a plain
// Card everywhere else (e.g. the non-Playground quick-dial Dialog). Keeps ONE
// CallWorkspace implementation while honoring the visual-split contract.
function Panel({
  children,
  seedId,
  className,
  testId,
}: {
  children: ReactNode;
  seedId: string;
  className?: string;
  testId?: string;
}) {
  const { isSketch } = useSketchEnv();
  if (isSketch) {
    return (
      <SketchSurface seedId={seedId} className={className} data-testid={testId}>
        {children}
      </SketchSurface>
    );
  }
  return (
    <Card className={`p-4 bg-white ${className ?? ""}`} data-testid={testId}>
      {children}
    </Card>
  );
}

// Quick-outcome shortcut — SketchButton inside the Playground, the original
// tone-classed button in the non-Playground quick-dial Dialog.
function QuickOutcomeButton({
  value,
  label,
  tone,
  disabled,
  onSelect,
}: {
  value: string;
  label: string;
  tone: "emerald" | "amber" | "slate" | "rose";
  disabled: boolean;
  onSelect: () => void;
}) {
  const { isSketch } = useSketchEnv();
  if (isSketch) {
    const variant = tone === "rose" ? "danger" : "secondary";
    return (
      <SketchButton
        type="button"
        variant={variant}
        size="sm"
        seedId={`quick-outcome-${value}`}
        onClick={onSelect}
        disabled={disabled}
        className="justify-start"
        data-testid={`call-quick-outcome-${value}`}
      >
        {label}
      </SketchButton>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`rounded-md border px-3 py-2 text-left text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONE_CLASS[tone]}`}
      data-testid={`call-quick-outcome-${value}`}
    >
      {label}
    </button>
  );
}

// Target-service chip — SketchBadge inside the Playground, shadcn Badge in the
// non-Playground quick-dial Dialog.
function TargetChip({ label }: { label: string }) {
  const { isSketch } = useSketchEnv();
  if (isSketch) {
    return (
      <span data-testid={`call-target-${label}`}>
        <SketchBadge tone="blue">{label}</SketchBadge>
      </span>
    );
  }
  return (
    <Badge variant="secondary" data-testid={`call-target-${label}`}>
      {label}
    </Badge>
  );
}

function StatusPill({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "sky";
}) {
  const { isSketch } = useSketchEnv();
  if (isSketch) {
    const map = { slate: "graphite", emerald: "green", amber: "gold", rose: "red", sky: "blue" } as const;
    return <SketchBadge tone={map[tone]}>{label}</SketchBadge>;
  }
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-700",
    sky: "bg-sky-100 text-sky-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}

function ProofDocRow({
  label,
  icon,
  doc,
  isLoading,
}: {
  label: string;
  icon: React.ReactNode;
  doc: CaseProofDoc | null;
  isLoading: boolean;
}) {
  const testKey = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
      data-testid={`call-proof-${testKey}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-slate-900">{label}</div>
          <div className="truncate text-[10px] text-slate-500">
            {isLoading
              ? "Loading…"
              : doc
                ? doc.filename || doc.title || "Document on file"
                : "Not generated yet"}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : doc && doc.downloadUrl ? (
          <>
            <a
              href={doc.downloadUrl}
              target="_blank"
              rel="noreferrer"
              data-testid={`call-proof-open-${testKey}`}
            >
              <SketchAwareButton size="sm" variant="outline" type="button" seedId={`proof-open-${testKey}`}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
              </SketchAwareButton>
            </a>
            <a href={doc.downloadUrl} download data-testid={`call-proof-download-${testKey}`}>
              <SketchAwareButton size="sm" variant="ghost" type="button" seedId={`proof-dl-${testKey}`}>
                <Download className="h-3.5 w-3.5" />
              </SketchAwareButton>
            </a>
          </>
        ) : (
          <Badge variant="secondary" data-testid={`call-proof-empty-${testKey}`}>
            None
          </Badge>
        )}
      </div>
    </div>
  );
}

export function CallWorkspace({
  ctx,
  onScheduleCase,
  onOpenCase,
  onClose,
  onDraftChange,
  onLogged,
  requestOpenDisposition,
}: CallWorkspaceProps) {
  const { toast } = useToast();
  const screeningId = ctx.patientScreeningId;

  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [defaultOutcome, setDefaultOutcome] = useState<OutreachCallOutcome | undefined>(
    undefined,
  );
  const [callSession, setCallSession] = useState<PhoneCallSession | null>(null);
  const [dialing, setDialing] = useState(false);
  // The resolved provider reported a not-live/"pending" session (e.g. RingCentral
  // with no credentials) — surface the honest manual-dial boundary.
  const [providerUnwired, setProviderUnwired] = useState(false);

  const ringCentralEnabled = isRingCentralClickToCallEnabled();

  // Per-call provider switch (null → use the precedence-resolved default).
  // A per-call switch NEVER persists; making it the saved default is an
  // explicit action (the "Make default" control below).
  const [providerOverride, setProviderOverride] = useState<PhoneProviderId | null>(null);

  // Persisted defaults (admin_settings-backed) are the source of truth;
  // localStorage/env are fallback only. Scope the facility layer to this case.
  const { data: persistedPrefs } = usePhoneProviderPreferences(ctx.facilityId ?? null);
  const saveDefault = useSavePhoneProviderDefault(ctx.facilityId ?? null);
  const providerPrefs = getClientPhoneProviderPreferences(persistedPrefs ?? null);
  // Effective provider by precedence (team-member → facility → org → manual),
  // with an optional per-call switch. The UI NEVER hard-wires RingCentral.
  const resolvedProvider = resolvePhoneProvider(providerPrefs, {
    ringCentralEnabled,
    explicitProviderId: providerOverride,
  });
  // The provider currently shown in the switcher (per-call override wins).
  const activeProviderId = providerOverride ?? resolvedProvider.providerId;
  // Is the shown provider already the persisted team-member default?
  const isSavedTeamMemberDefault = persistedPrefs?.teamMemberProviderId === activeProviderId;

  const commandEnabled = typeof screeningId === "number" && screeningId > 0;
  const { data, isLoading, isError, error } = useQuery<CommandCenterResponse>({
    queryKey: ["portal-command-center", screeningId],
    queryFn: () => fetchPatientCommandCenter(screeningId as number),
    enabled: commandEnabled,
    refetchInterval: 60_000,
  });

  const proof = useCaseProofDocs(screeningId);

  const phone = data?.patient.phone ?? null;
  const diagnoses = data?.clinicalProfile?.diagnoses ?? null;
  const priorAttempts = data?.histories?.calls?.length ?? 0;
  const targetService = ctx.targetServices.filter(Boolean)[0] ?? null;

  const openDisposition = (outcome?: OutreachCallOutcome) => {
    setDefaultOutcome(outcome);
    setDispositionOpen(true);
  };

  // Host-driven open: when the Playground "Save & Close" flow bumps
  // requestOpenDisposition, surface the disposition sheet so the user can
  // complete the canonical log (we never silently persist a clinical call).
  const lastOpenReq = useRef<number | undefined>(requestOpenDisposition);
  useEffect(() => {
    if (requestOpenDisposition == null) return;
    if (lastOpenReq.current !== requestOpenDisposition) {
      lastOpenReq.current = requestOpenDisposition;
      setDispositionOpen(true);
    }
  }, [requestOpenDisposition]);

  async function startCall() {
    if (!phone) {
      toast({
        title: "No phone number on file",
        description: "Add a phone number before placing a call.",
        variant: "destructive",
      });
      return;
    }
    // If the resolved provider isn't live (e.g. RingCentral with no
    // credentials), don't even attempt — show the manual-dial boundary.
    if (!resolvedProvider.live) {
      setProviderUnwired(true);
      setCallSession(null);
      return;
    }
    setDialing(true);
    try {
      const session = await resolvedProvider.adapter.startCall({
        phoneNumber: phone,
        patientName: ctx.patientName,
        patientUuid: screeningId != null ? String(screeningId) : undefined,
      });
      // A dormant adapter returns a synthetic "pending" session instead of
      // placing a real call. Never present that as a live call — surface the
      // honest connection boundary.
      if (!session?.callId || session.callId.includes("pending")) {
        setProviderUnwired(true);
        setCallSession(null);
        return;
      }
      setProviderUnwired(false);
      setCallSession(session);
    } catch (e) {
      toast({
        title: "Could not start call",
        description: e instanceof Error ? e.message : `${resolvedProvider.adapter.label} call failed.`,
        variant: "destructive",
      });
    } finally {
      setDialing(false);
    }
  }

  async function endCall() {
    if (callSession) {
      try {
        await resolvedProvider.adapter.endCall(callSession.callId);
      } catch {
        /* ignore — the provider end is best-effort */
      }
    }
    setCallSession(null);
  }

  const headerCallReason = ctx.callReason || "Outreach call";

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4"
      data-testid="call-workspace"
    >
      {/* ─── Header ─────────────────────────────────────────────── */}
      <Panel seedId="call-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-base font-semibold text-slate-900"
              data-testid="call-workspace-name"
            >
              {ctx.patientName}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
              {ctx.patientDob ? <span>DOB {ctx.patientDob}</span> : null}
              {phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {phone}
                </span>
              ) : (
                <span className="italic text-slate-400">No phone on file</span>
              )}
              {ctx.facilityId ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {ctx.facilityId}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="inline-flex items-center gap-1 text-slate-700">
                <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium">Reason:</span> {headerCallReason}
              </span>
              {targetService ? (
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <Stethoscope className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-medium">Target:</span> {targetService}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ctx.engagementStatus ? (
              <StatusPill label={`Engagement: ${ctx.engagementStatus}`} tone="slate" />
            ) : null}
            {ctx.lifecycleStatus ? (
              <StatusPill label={ctx.lifecycleStatus} tone="sky" />
            ) : null}
            {ctx.sourcePortal ? (
              <StatusPill label={ctx.sourcePortal} tone="slate" />
            ) : null}
          </div>
        </div>
        {ctx.targetServices.filter(Boolean).length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ctx.targetServices.filter(Boolean).map((s) => (
              <TargetChip key={s} label={s} />
            ))}
          </div>
        ) : null}
      </Panel>

      {/* ─── RingCentral dialer panel ───────────────────────────── */}
      <Panel seedId="call-dialer" testId="call-workspace-dialer">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">Dialer</div>
          <div className="flex items-center gap-1.5">
            {/* Provider switcher — pick which calling method to use for this
                call. Default comes from the precedence chain (team-member →
                facility → org → manual). Persisting the choice sets the
                team-member override. */}
            <select
              value={activeProviderId}
              onChange={(e) => {
                // Per-call switch ONLY — does NOT overwrite the saved default.
                // Making it the default is the explicit "Make default" action.
                const v = e.target.value as PhoneProviderId;
                setProviderOverride(v);
                setProviderUnwired(false);
              }}
              className="h-6 rounded-md border border-slate-200 bg-white px-1 text-[11px] text-slate-700"
              data-testid="call-provider-select"
              title="Calling method (this call only)"
            >
              {AVAILABLE_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {id === "ringcentral" ? "RingCentral" : id === "manual" ? "Manual" : id}
                </option>
              ))}
            </select>
            {/* Explicit make-default: persists the shown provider as this
                team member's saved default (does not affect other users).
                Also mirrors to localStorage so the offline fallback agrees. */}
            {isSavedTeamMemberDefault ? (
              <span
                className="text-[10px] font-medium text-emerald-600"
                data-testid="call-provider-default-badge"
              >
                Default
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!isSelectablePhoneProviderId(activeProviderId)) return;
                  saveDefault.mutate({ scope: "team_member", providerId: activeProviderId });
                  setTeamMemberPhoneProviderOverride(activeProviderId);
                }}
                disabled={saveDefault.isPending}
                className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                data-testid="call-provider-make-default"
                title="Save as my default calling method"
              >
                Make default
              </button>
            )}
            {resolvedProvider.live ? (
              <StatusPill label="Ready" tone="emerald" />
            ) : (
              <StatusPill label="Integration required" tone="amber" />
            )}
          </div>
        </div>

        {!resolvedProvider.live || providerUnwired ? (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-3 text-[12px] text-amber-900"
            data-testid="call-provider-boundary"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">
                {resolvedProvider.adapter.label} connection required
              </div>
              <p className="mt-0.5 text-amber-800">
                {resolvedProvider.adapter.label} click-to-call is not connected for
                this environment. Place the call manually{phone ? ` to ${phone}` : ""},
                then log the outcome below. No call is placed from here until a live
                calling provider is connected.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Calling
                </div>
                <div className="truncate text-[13px] font-medium text-slate-900">
                  {phone ?? "No phone on file"}
                </div>
              </div>
              {callSession ? (
                <StatusPill
                  label={`Status: ${callSession.status}`}
                  tone={callSession.status === "active" ? "emerald" : "sky"}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!callSession ? (
                <SketchAwareButton
                  type="button"
                  onClick={startCall}
                  disabled={dialing || !phone}
                  seedId="call-start"
                  data-testid="call-ringcentral-start"
                >
                  {dialing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneCall className="mr-1 h-4 w-4" />
                  )}
                  {dialing ? "Dialing…" : "Start call"}
                </SketchAwareButton>
              ) : (
                <SketchAwareButton
                  type="button"
                  variant="destructive"
                  onClick={endCall}
                  seedId="call-end"
                  data-testid="call-ringcentral-end"
                >
                  <PhoneOff className="mr-1 h-4 w-4" /> End call
                </SketchAwareButton>
              )}
              <span className="text-[11px] text-slate-500">
                Disposition is logged below — a placed call is never marked complete
                automatically.
              </span>
            </div>
          </div>
        )}
      </Panel>

      {/* ─── Proof documents ────────────────────────────────────── */}
      <Panel seedId="call-proof" testId="call-workspace-proof">
        <div className="mb-2">
          <div className="text-sm font-semibold text-slate-900">Why this patient?</div>
          <div className="text-[11px] text-slate-500">
            Supporting documents that explain the qualification. Open or download to
            review before calling.
          </div>
        </div>
        <div className="space-y-2">
          <ProofDocRow
            label="Clinician Atlas"
            icon={<FileText className="h-4 w-4" />}
            doc={proof.clinicianPdf}
            isLoading={proof.isLoading}
          />
          <ProofDocRow
            label="Plexus Atlas"
            icon={<FileBarChart className="h-4 w-4" />}
            doc={proof.plexusPdf}
            isLoading={proof.isLoading}
          />
        </div>
        {diagnoses ? (
          <div className="mt-3 rounded-md bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Supporting diagnoses
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-slate-900">
              {diagnoses}
            </div>
          </div>
        ) : null}
        {isError ? (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-700">
            <AlertCircle className="h-3.5 w-3.5" />
            {error instanceof Error ? error.message : "Failed to load patient context"}
          </div>
        ) : null}
        {isLoading ? (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading patient context…
          </div>
        ) : null}
      </Panel>

      {/* ─── Disposition logging ────────────────────────────────── */}
      <Panel seedId="call-disposition" testId="call-workspace-disposition">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">Log call outcome</div>
            <div className="text-[11px] text-slate-500">
              Attempt #{priorAttempts + 1} · posts to the canonical call-result endpoint.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_OUTCOMES.map((o) => (
            <QuickOutcomeButton
              key={o.value}
              value={o.value}
              label={o.label}
              tone={o.tone}
              disabled={screeningId == null}
              onSelect={() => openDisposition(o.value)}
            />
          ))}
        </div>
        <div className="mt-3">
          <SketchAwareButton
            type="button"
            variant="outline"
            onClick={() => openDisposition(undefined)}
            disabled={screeningId == null}
            seedId="call-open-disposition"
            data-testid="call-open-disposition"
          >
            <Phone className="mr-1 h-4 w-4" /> Full disposition sheet
          </SketchAwareButton>
        </div>
      </Panel>

      {/* ─── Quick navigation ───────────────────────────────────── */}
      <Panel seedId="call-actions" testId="call-workspace-actions">
        <div className="flex flex-wrap items-center gap-2">
          <SketchAwareButton type="button" onClick={onScheduleCase} seedId="call-open-schedule" data-testid="call-open-schedule">
            <CalendarDays className="mr-1 h-4 w-4" /> Open Schedule
          </SketchAwareButton>
          <SketchAwareButton
            type="button"
            variant="outline"
            onClick={onOpenCase}
            seedId="call-open-case"
            data-testid="call-open-case"
          >
            <Maximize2 className="mr-1 h-4 w-4" /> Open Case
          </SketchAwareButton>
          <SketchAwareButton
            type="button"
            variant="ghost"
            onClick={onClose}
            seedId="call-close-tab"
            data-testid="call-close-tab"
          >
            Close tab
          </SketchAwareButton>
        </div>
      </Panel>

      <DispositionSheet
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        patientId={screeningId}
        patientName={ctx.patientName}
        schedulerUserId={null}
        priorAttempts={priorAttempts}
        defaultOutcome={defaultOutcome}
        onDraftChange={onDraftChange}
        onLogged={onLogged}
      />
    </div>
  );
}
