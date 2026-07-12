import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  CalendarDays,
  FileText,
  User,
  X,
  Loader2,
  AlertCircle,
  Stethoscope,
  ClipboardList,
  History,
  Activity,
  NotebookPen,
  Download,
  ExternalLink,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
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

export type CaseOverviewProps = {
  ctx: CallCaseContext;
  onCall: () => void;
  onSchedule: () => void;
  onOpenPatient: () => void;
  onClose: () => void;
};

// ── Small presentational helpers ──────────────────────────────────────

function StatusPill({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "sky" | "indigo";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-700",
    sky: "bg-sky-100 text-sky-700",
    indigo: "bg-indigo-100 text-indigo-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  icon,
  testId,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  testId: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 bg-white" data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="text-slate-500">{icon}</span>
          {title}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const has = !!value && value.trim().length > 0;
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {has ? (
        <div className="mt-0.5 text-[12px] text-slate-900 whitespace-pre-wrap break-words">
          {value}
        </div>
      ) : (
        <div className="text-[11px] italic text-slate-400">No data on file.</div>
      )}
    </div>
  );
}

function EmptyState({ label, testId }: { label: string; testId: string }) {
  return (
    <div
      className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-[11px] text-slate-400"
      data-testid={testId}
    >
      {label}
    </div>
  );
}

// ── Value extraction helpers (histories are loosely typed `any[]`) ─────

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

function pick(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = str(obj[k]);
    if (v) return v;
  }
  return null;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Coerce a per-test reasoning blob into a short readable string. The
// canonical shape is { [testName]: string | object }, so we surface any
// string leaves we find rather than dumping raw JSON.
function reasoningToText(reasoning: unknown, qualifyingTests: string[]): string | null {
  if (!reasoning) return null;
  if (typeof reasoning === "string") return reasoning.trim() || null;
  if (typeof reasoning !== "object") return null;
  const out: string[] = [];
  const entries = Object.entries(reasoning as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key.startsWith("adminReview")) continue;
    if (qualifyingTests.length && !qualifyingTests.includes(key)) {
      // Still include if value is a plain string and looks meaningful.
    }
    if (typeof value === "string" && value.trim()) {
      out.push(`${key}: ${value.trim()}`);
    } else if (value && typeof value === "object") {
      const inner = pick(value, ["summary", "reason", "rationale", "explanation", "note"]);
      if (inner) out.push(`${key}: ${inner}`);
    }
  }
  return out.length ? out.join("\n") : null;
}

// ── PDF proof link row ────────────────────────────────────────────────

function ProofRow({
  label,
  doc,
  isLoading,
  testId,
}: {
  label: string;
  doc: CaseProofDoc | null;
  isLoading: boolean;
  testId: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
      data-testid={testId}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-slate-800">{label}</div>
          {isLoading ? (
            <div className="text-[10px] text-slate-400">Checking documents…</div>
          ) : doc ? (
            <div className="truncate text-[10px] text-slate-500">
              {doc.title || doc.filename}
              {doc.createdAt ? ` · ${fmtDateTime(doc.createdAt)}` : ""}
            </div>
          ) : (
            <div className="text-[10px] italic text-slate-400">Not generated yet.</div>
          )}
        </div>
      </div>
      {doc && doc.downloadUrl ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            asChild
            size="sm"
            variant="outline"
            data-testid={`${testId}-open`}
          >
            <a href={doc.downloadUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost" data-testid={`${testId}-download`}>
            <a href={doc.downloadUrl} download>
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function CaseOverview({
  ctx,
  onCall,
  onSchedule,
  onOpenPatient,
  onClose,
}: CaseOverviewProps) {
  const screeningId = ctx.patientScreeningId;
  const hasScreening = typeof screeningId === "number" && screeningId > 0;

  const { data, isLoading, isError, error } = useQuery<CommandCenterResponse>({
    queryKey: ["portal-command-center", screeningId],
    queryFn: () => fetchPatientCommandCenter(screeningId as number),
    enabled: hasScreening,
    refetchInterval: 60_000,
  });

  const proof = useCaseProofDocs(screeningId);

  const patient = data?.patient ?? null;
  const clinicalProfile = data?.clinicalProfile ?? null;
  const histories = data?.histories ?? null;

  const name = patient?.name || ctx.patientName || "Patient";
  const dob = patient?.dob || ctx.patientDob || null;
  const facility = patient?.facility || ctx.facilityId || null;
  const phone = patient?.phone || null;
  const engagementStatus = patient?.engagementStatus || ctx.engagementStatus || null;
  const lifecycleStatus = patient?.lifecycleStatus || ctx.lifecycleStatus || null;
  const appointmentStatus = patient?.appointmentStatus || null;

  const targetServices =
    ctx.targetServices && ctx.targetServices.length
      ? ctx.targetServices
      : clinicalProfile?.qualifyingTests ?? [];

  const qualifyingTests = clinicalProfile?.qualifyingTests ?? [];
  const qualificationReason = reasoningToText(
    clinicalProfile?.reasoning,
    qualifyingTests,
  );

  const calls = (histories?.calls ?? []) as any[];
  const appointments = (histories?.appointments ?? []) as any[];
  const ancillaries = (histories?.ancillaries ?? []) as any[];
  const journeyEvents = (histories?.journeyEvents ?? []) as any[];
  const notes = (histories?.notes ?? []) as Array<{
    id: number;
    source: string;
    createdAt: string | null;
    text: string | null;
    serviceType: string | null;
  }>;

  const ringCentralReady = isRingCentralClickToCallEnabled();

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4"
      data-testid="case-overview"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="case-overview-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-base font-semibold text-slate-900"
              data-testid="case-overview-name"
            >
              {name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
              {dob ? <span>DOB {dob}</span> : null}
              {facility ? <span>· {facility}</span> : null}
              {ctx.sourcePortal ? <span>· {ctx.sourcePortal}</span> : null}
              {ctx.executionCaseId != null ? (
                <span>· Case #{ctx.executionCaseId}</span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {appointmentStatus ? (
                <StatusPill label={`Appt: ${appointmentStatus}`} tone="sky" />
              ) : null}
              {engagementStatus ? (
                <StatusPill label={`Engagement: ${engagementStatus}`} tone="indigo" />
              ) : null}
              {lifecycleStatus ? (
                <StatusPill label={lifecycleStatus} tone="slate" />
              ) : null}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close case overview"
            data-testid="button-case-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={onCall}
            data-testid="button-case-call"
          >
            <Phone className="mr-1.5 h-3.5 w-3.5" /> Open call suite
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onSchedule}
            data-testid="button-case-schedule"
          >
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Schedule
          </Button>
          {hasScreening ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenPatient}
              data-testid="button-case-open-patient"
            >
              <User className="mr-1.5 h-3.5 w-3.5" /> Open patient chart
            </Button>
          ) : null}
        </div>
      </Card>

      {hasScreening && isError ? (
        <Card className="p-4 bg-white" data-testid="case-overview-error">
          <div className="flex items-center gap-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4" />
            {error instanceof Error ? error.message : "Failed to load case detail"}
          </div>
        </Card>
      ) : null}

      {/* ── Why this call ──────────────────────────────────────────── */}
      <Section
        title="Why this call"
        icon={<ClipboardList className="h-4 w-4" />}
        testId="case-overview-reason"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Call reason" value={ctx.callReason} />
          <Field
            label="Target ancillary"
            value={targetServices.length ? targetServices.join(", ") : null}
          />
        </div>
      </Section>

      {/* ── Clinical justification ─────────────────────────────────── */}
      <Section
        title="Clinical justification"
        icon={<Stethoscope className="h-4 w-4" />}
        testId="case-overview-clinical"
      >
        {hasScreening && isLoading ? (
          <div className="flex items-center text-xs text-slate-500">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading clinical
            detail…
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              label="Qualification reason"
              value={qualificationReason ?? (hasScreening ? null : "Open the patient chart for full reasoning.")}
            />
            <Field
              label="Qualifying tests"
              value={qualifyingTests.length ? qualifyingTests.join(", ") : null}
            />
            <Field label="Supporting diagnoses (Dx)" value={clinicalProfile?.diagnoses} />
            <Field label="History (Hx / PMH)" value={clinicalProfile?.history} />
            <Field label="Medications (Rx)" value={clinicalProfile?.medications} />
            <Field
              label="Previous ancillaries"
              value={
                clinicalProfile?.noPreviousTests
                  ? "No Record of Plexus Ancillary Screens"
                  : clinicalProfile?.previousTests
              }
            />
          </div>
        )}
      </Section>

      {/* ── Proof documents ────────────────────────────────────────── */}
      <Section
        title="Proof documents"
        icon={<FileText className="h-4 w-4" />}
        testId="case-overview-proof"
      >
        <div className="space-y-2">
          <ProofRow
            label="Clinician PDF"
            doc={proof.clinicianPdf}
            isLoading={proof.isLoading}
            testId="case-overview-proof-clinician"
          />
          <ProofRow
            label="Plexus PDF"
            doc={proof.plexusPdf}
            isLoading={proof.isLoading}
            testId="case-overview-proof-plexus"
          />
        </div>
      </Section>

      {/* ── Contact ────────────────────────────────────────────────── */}
      <Section
        title="Contact"
        icon={<Phone className="h-4 w-4" />}
        testId="case-overview-contact"
        right={
          <Button size="sm" variant="outline" onClick={onCall} data-testid="button-case-quick-call">
            <Phone className="mr-1.5 h-3.5 w-3.5" /> Call
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Phone" value={phone} />
          <Field label="Insurance" value={patient?.insurance} />
        </div>
        {!ringCentralReady ? (
          <div
            className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800"
            data-testid="case-overview-ringcentral-boundary"
          >
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            RingCentral click-to-call is not connected. Use the call suite to log the
            outcome of a manually placed call.
          </div>
        ) : null}
      </Section>

      {/* ── Prior call attempts ────────────────────────────────────── */}
      <Section
        title="Prior call attempts"
        icon={<Phone className="h-4 w-4" />}
        testId="case-overview-calls"
        right={
          calls.length ? <StatusPill label={`${calls.length}`} tone="slate" /> : undefined
        }
      >
        {hasScreening && isLoading ? (
          <div className="flex items-center text-xs text-slate-500">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : calls.length === 0 ? (
          <EmptyState label="No call attempts logged yet." testId="case-overview-calls-empty" />
        ) : (
          <ul className="space-y-2">
            {calls.map((c, i) => {
              const id = pick(c, ["id"]) ?? String(i);
              const outcome = pick(c, ["outcome", "callResult", "callDisposition"]) ?? "—";
              const when = pick(c, ["startedAt", "createdAt", "occurredAt"]);
              const attempt = pick(c, ["attemptNumber"]);
              const callback = pick(c, ["callbackAt", "nextActionAt"]);
              const note = pick(c, ["notes", "note", "summary"]);
              return (
                <li
                  key={id}
                  className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5"
                  data-testid={`case-overview-call-row-${id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-slate-800">
                      {outcome}
                      {attempt ? (
                        <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                          · attempt #{attempt}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-slate-500">{fmtDateTime(when)}</div>
                  </div>
                  {callback ? (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      callback {fmtDateTime(callback)}
                    </div>
                  ) : null}
                  {note ? (
                    <div className="mt-1 text-[12px] text-slate-700 whitespace-pre-wrap break-words">
                      {note}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── Scheduling history ─────────────────────────────────────── */}
      <Section
        title="Scheduling history"
        icon={<CalendarDays className="h-4 w-4" />}
        testId="case-overview-scheduling"
        right={
          <Button size="sm" variant="outline" onClick={onSchedule} data-testid="button-case-quick-schedule">
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Schedule
          </Button>
        }
      >
        {hasScreening && isLoading ? (
          <div className="flex items-center text-xs text-slate-500">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : appointments.length === 0 && ancillaries.length === 0 ? (
          <EmptyState
            label="No appointments or ancillaries scheduled yet."
            testId="case-overview-scheduling-empty"
          />
        ) : (
          <ul className="space-y-2">
            {appointments.map((a, i) => {
              const id = `appt-${pick(a, ["id"]) ?? i}`;
              const type = pick(a, ["eventType", "serviceType"]) ?? "Appointment";
              const service = pick(a, ["serviceType"]);
              const when = pick(a, ["startsAt", "scheduledTime", "createdAt"]);
              const status = pick(a, ["status"]);
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-[12px]"
                  data-testid={`case-overview-appt-row-${id}`}
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">{type}</span>
                    {service && service !== type ? (
                      <span className="text-slate-500"> · {service}</span>
                    ) : null}
                    {status ? (
                      <span className="ml-1.5">
                        <StatusPill label={status} tone="sky" />
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-500">{fmtDateTime(when)}</div>
                </li>
              );
            })}
            {ancillaries.map((a, i) => {
              const id = `anc-${pick(a, ["id"]) ?? i}`;
              const service = pick(a, ["serviceType"]) ?? "Ancillary";
              const status = pick(a, ["procedureStatus", "status"]);
              const when = pick(a, ["completedAt", "startsAt", "createdAt"]);
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-[12px]"
                  data-testid={`case-overview-ancillary-row-${id}`}
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">{service}</span>
                    {status ? (
                      <span className="ml-1.5">
                        <StatusPill label={status} tone="emerald" />
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-500">{fmtDateTime(when)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── Journey timeline ───────────────────────────────────────── */}
      <Section
        title="Journey timeline"
        icon={<Activity className="h-4 w-4" />}
        testId="case-overview-journey"
      >
        {hasScreening && isLoading ? (
          <div className="flex items-center text-xs text-slate-500">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : journeyEvents.length === 0 ? (
          <EmptyState label="No journey events yet." testId="case-overview-journey-empty" />
        ) : (
          <ul className="space-y-2">
            {journeyEvents.map((e, i) => {
              const id = pick(e, ["id"]) ?? String(i);
              const type = pick(e, ["eventType"]) ?? "event";
              const source = pick(e, ["eventSource", "source"]);
              const summary = pick(e, ["summary", "note", "description"]);
              const when = pick(e, ["createdAt", "occurredAt"]);
              return (
                <li
                  key={id}
                  className="flex items-start gap-2 text-[12px] text-slate-800"
                  data-testid={`case-overview-journey-row-${id}`}
                >
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <div>
                      <span className="font-medium">{type.replace(/_/g, " ")}</span>
                      {summary ? <span className="text-slate-600"> · {summary}</span> : null}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {fmtDateTime(when)}
                      {source ? ` · ${source}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── Notes ──────────────────────────────────────────────────── */}
      <Section
        title="Notes"
        icon={<NotebookPen className="h-4 w-4" />}
        testId="case-overview-notes"
      >
        {hasScreening && isLoading ? (
          <div className="flex items-center text-xs text-slate-500">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : notes.length === 0 ? (
          <EmptyState label="No internal notes yet." testId="case-overview-notes-empty" />
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5"
                data-testid={`case-overview-note-row-${n.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-slate-600">
                    {n.source}
                    {n.serviceType ? ` · ${n.serviceType}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-500">{fmtDateTime(n.createdAt)}</div>
                </div>
                {n.text ? (
                  <div className="mt-1 text-[12px] text-slate-700 whitespace-pre-wrap break-words">
                    {n.text}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Next action ────────────────────────────────────────────── */}
      <Section
        title="Next action & status"
        icon={<History className="h-4 w-4" />}
        testId="case-overview-next-action"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="Next action"
            value={patient?.nextActionAt ? fmtDateTime(patient.nextActionAt) : null}
          />
          <Field label="Engagement status" value={engagementStatus} />
          <Field label="Lifecycle status" value={lifecycleStatus} />
          <Field label="Appointment status" value={appointmentStatus} />
        </div>
      </Section>
    </div>
  );
}
