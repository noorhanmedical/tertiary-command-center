import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ringCentralProvider } from "@/features/command-center/providers/ringCentralProvider";
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

function StatusPill({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "sky";
}) {
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
              <Button size="sm" variant="outline" type="button">
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
              </Button>
            </a>
            <a href={doc.downloadUrl} download data-testid={`call-proof-download-${testKey}`}>
              <Button size="sm" variant="ghost" type="button">
                <Download className="h-3.5 w-3.5" />
              </Button>
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
}: CallWorkspaceProps) {
  const { toast } = useToast();
  const screeningId = ctx.patientScreeningId;

  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [defaultOutcome, setDefaultOutcome] = useState<OutreachCallOutcome | undefined>(
    undefined,
  );
  const [callSession, setCallSession] = useState<PhoneCallSession | null>(null);
  const [dialing, setDialing] = useState(false);
  const [ringCentralUnwired, setRingCentralUnwired] = useState(false);

  const ringCentralEnabled = isRingCentralClickToCallEnabled();

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

  async function startCall() {
    if (!phone) {
      toast({
        title: "No phone number on file",
        description: "Add a phone number before placing a call.",
        variant: "destructive",
      });
      return;
    }
    setDialing(true);
    try {
      const session = await ringCentralProvider.startCall({
        phoneNumber: phone,
        patientName: ctx.patientName,
        patientUuid: screeningId != null ? String(screeningId) : undefined,
      });
      // The RingCentral adapter is dormant in this environment: it returns a
      // synthetic "pending" session instead of placing a real call. Never
      // present that as a live call — surface the honest connection boundary.
      if (!session?.callId || session.callId.includes("pending")) {
        setRingCentralUnwired(true);
        setCallSession(null);
        return;
      }
      setRingCentralUnwired(false);
      setCallSession(session);
    } catch (e) {
      toast({
        title: "Could not start call",
        description: e instanceof Error ? e.message : "RingCentral call failed.",
        variant: "destructive",
      });
    } finally {
      setDialing(false);
    }
  }

  async function endCall() {
    if (callSession) {
      try {
        await ringCentralProvider.endCall(callSession.callId);
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
      <Card className="p-4 bg-white">
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
              <Badge key={s} variant="secondary" data-testid={`call-target-${s}`}>
                {s}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ─── RingCentral dialer panel ───────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="call-workspace-dialer">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">RingCentral dialer</div>
          {ringCentralEnabled && !ringCentralUnwired ? (
            <StatusPill label="Click-to-call enabled" tone="emerald" />
          ) : (
            <StatusPill label="Integration required" tone="amber" />
          )}
        </div>

        {!ringCentralEnabled || ringCentralUnwired ? (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-3 text-[12px] text-amber-900"
            data-testid="call-ringcentral-boundary"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">RingCentral connection required</div>
              <p className="mt-0.5 text-amber-800">
                Click-to-call is not connected for this environment. Place the call
                manually{phone ? ` to ${phone}` : ""}, then log the outcome below. No
                call is placed from here until RingCentral is connected.
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
                <Button
                  type="button"
                  onClick={startCall}
                  disabled={dialing || !phone}
                  data-testid="call-ringcentral-start"
                >
                  {dialing ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneCall className="mr-1 h-4 w-4" />
                  )}
                  {dialing ? "Dialing…" : "Start call"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={endCall}
                  data-testid="call-ringcentral-end"
                >
                  <PhoneOff className="mr-1 h-4 w-4" /> End call
                </Button>
              )}
              <span className="text-[11px] text-slate-500">
                Disposition is logged below — a placed call is never marked complete
                automatically.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* ─── Proof documents ────────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="call-workspace-proof">
        <div className="mb-2">
          <div className="text-sm font-semibold text-slate-900">Why this patient?</div>
          <div className="text-[11px] text-slate-500">
            Supporting documents that explain the qualification. Open or download to
            review before calling.
          </div>
        </div>
        <div className="space-y-2">
          <ProofDocRow
            label="Clinician PDF"
            icon={<FileText className="h-4 w-4" />}
            doc={proof.clinicianPdf}
            isLoading={proof.isLoading}
          />
          <ProofDocRow
            label="Plexus PDF"
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
      </Card>

      {/* ─── Disposition logging ────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="call-workspace-disposition">
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
            <button
              key={o.value}
              type="button"
              onClick={() => openDisposition(o.value)}
              disabled={screeningId == null}
              className={`rounded-md border px-3 py-2 text-left text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONE_CLASS[o.tone]}`}
              data-testid={`call-quick-outcome-${o.value}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => openDisposition(undefined)}
            disabled={screeningId == null}
            data-testid="call-open-disposition"
          >
            <Phone className="mr-1 h-4 w-4" /> Full disposition sheet
          </Button>
        </div>
      </Card>

      {/* ─── Quick navigation ───────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="call-workspace-actions">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={onScheduleCase} data-testid="call-open-schedule">
            <CalendarDays className="mr-1 h-4 w-4" /> Open Schedule
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onOpenCase}
            data-testid="call-open-case"
          >
            <Maximize2 className="mr-1 h-4 w-4" /> Open Case
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            data-testid="call-close-tab"
          >
            Close tab
          </Button>
        </div>
      </Card>

      <DispositionSheet
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        patientId={screeningId}
        patientName={ctx.patientName}
        schedulerUserId={null}
        priorAttempts={priorAttempts}
        defaultOutcome={defaultOutcome}
      />
    </div>
  );
}
