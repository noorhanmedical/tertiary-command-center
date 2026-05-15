import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  MessageSquare,
  Mail,
  FileText,
  CalendarDays,
  ClipboardList,
  Megaphone,
  FileSignature,
  FolderOpen,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  fetchPatientCommandCenter,
  type CommandCenterResponse,
} from "@/lib/portal/commandCenterApi";

// Patient Command Canvas — the centerpiece of the Team Portal patient
// view. ACS and PCS share this component verbatim.
//
// Layout, top to bottom:
//   1. Identity header (name, DOB, MRN, phone, insurance, facility,
//      patient type, engagement/appointment status badges).
//   2. Clinical Profile — HX / PMH / DX / RX / previous ancillaries /
//      cooldowns / qualifying tests / reasoning. Prominent on purpose;
//      do not bury under communications.
//   3. Latest Activity — last call / appointment / ancillary / journey
//      event. Texts and emails are listed when patient_communications
//      lands (placeholder empty for now).
//   4. Full History — folder/file icons opening per-source history.
//   5. Action strip — Schedule, Call, Text, Email, Send Marketing,
//      Plexus Tasks, Consent/Screening, Procedure Complete (ACS).
//
// All data flows from /api/portal/patient-command-center/:id which
// aggregates canonical tables. No local-only patient source of truth.

export type PatientCommandCanvasProps = {
  patientScreeningId: number;
  workspaceRole?: string;
  onSchedulePatient?: (patient: CommandCenterResponse["patient"]) => void;
  onOpenMarketingForPatient?: (patient: CommandCenterResponse["patient"]) => void;
  onOpenTasksForPatient?: (patient: CommandCenterResponse["patient"]) => void;
  onOpenPatientHistory?: (
    patient: CommandCenterResponse["patient"],
    section: HistorySection,
  ) => void;
};

export type HistorySection =
  | "all"
  | "calls"
  | "texts"
  | "emails"
  | "notes"
  | "appointments"
  | "ancillaries"
  | "marketing"
  | "journey";

function formatDateTime(iso: string | null | undefined): string {
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

function StatusPill({ label, tone = "slate" }: { label: string; tone?: "slate" | "emerald" | "amber" | "rose" | "sky" }) {
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

function ClinicalField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) {
    return (
      <div className="rounded-md bg-slate-50 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-[11px] text-slate-400 italic">No data on file.</div>
      </div>
    );
  }
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-[12px] text-slate-900 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function HistoryIcon({
  label,
  count,
  icon,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 transition-colors"
      data-testid={testId}
    >
      <div className="text-slate-500">{icon}</div>
      <div className="text-[10px] font-medium text-slate-700">{label}</div>
      <div className="text-[10px] text-slate-500">{count}</div>
    </button>
  );
}

export function PatientCommandCanvas({
  patientScreeningId,
  workspaceRole,
  onSchedulePatient,
  onOpenMarketingForPatient,
  onOpenTasksForPatient,
  onOpenPatientHistory,
}: PatientCommandCanvasProps) {
  const [activeHistory, setActiveHistory] = useState<HistorySection>("all");

  const { data, isLoading, isError, error } = useQuery<CommandCenterResponse>({
    queryKey: ["portal-command-center", patientScreeningId],
    queryFn: () => fetchPatientCommandCenter(patientScreeningId),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-500" data-testid="patient-command-canvas-loading">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading patient…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-rose-700" data-testid="patient-command-canvas-error">
        <AlertCircle className="h-4 w-4 mr-2" />
        {error instanceof Error ? error.message : "Failed to load patient"}
      </div>
    );
  }

  const { patient, clinicalProfile, latestActivity, histories, tasks } = data;
  const isAcs = workspaceRole === "ancillaryCareSpecialist" || workspaceRole === "technician";

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4"
      data-testid="patient-command-canvas"
    >
      {/* ─── Identity header ───────────────────────────────────────── */}
      <Card className="p-4 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900" data-testid="patient-command-canvas-name">
              {patient.name}
            </div>
            <div className="mt-0.5 text-[12px] text-slate-600 flex flex-wrap items-center gap-1.5">
              {patient.dob ? <span>DOB {patient.dob}</span> : null}
              {patient.age != null ? <span>· Age {patient.age}</span> : null}
              {patient.gender ? <span>· {patient.gender}</span> : null}
              {patient.phone ? <span>· {patient.phone}</span> : null}
              {patient.insurance ? <span>· {patient.insurance}</span> : null}
              {patient.facility ? <span>· {patient.facility}</span> : null}
              {patient.patientType ? <span>· {patient.patientType}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {patient.appointmentStatus ? (
              <StatusPill label={`Appt: ${patient.appointmentStatus}`} tone="sky" />
            ) : null}
            {patient.engagementStatus ? (
              <StatusPill label={`Engagement: ${patient.engagementStatus}`} tone="slate" />
            ) : null}
            {patient.commitStatus && patient.commitStatus !== "Draft" ? (
              <StatusPill label={patient.commitStatus} tone="emerald" />
            ) : null}
            {patient.lifecycleStatus ? (
              <StatusPill label={patient.lifecycleStatus} tone="slate" />
            ) : null}
          </div>
        </div>
      </Card>

      {/* ─── Clinical Profile (prominent, never buried) ───────────── */}
      <Card className="p-4 bg-white" data-testid="patient-command-canvas-clinical">
        <div className="mb-2 text-sm font-semibold text-slate-900">Clinical Profile</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <ClinicalField label="Diagnoses (Dx)" value={clinicalProfile.diagnoses} />
          <ClinicalField label="History (Hx / PMH)" value={clinicalProfile.history} />
          <ClinicalField label="Medications (Rx)" value={clinicalProfile.medications} />
          <ClinicalField
            label="Previous ancillaries"
            value={
              clinicalProfile.noPreviousTests
                ? "No Record of Plexus Ancillary Screens"
                : clinicalProfile.previousTests
            }
          />
          <ClinicalField
            label="Qualifying tests"
            value={
              clinicalProfile.qualifyingTests?.length
                ? clinicalProfile.qualifyingTests.join(", ")
                : null
            }
          />
          <ClinicalField label="Notes" value={clinicalProfile.notes} />
        </div>
      </Card>

      {/* ─── Latest Activity ──────────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="patient-command-canvas-latest">
        <div className="mb-2 text-sm font-semibold text-slate-900">Latest activity</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ActivityRow
            label="Last call"
            timestamp={latestActivity.call?.startedAt}
            summary={
              latestActivity.call
                ? `${latestActivity.call.outcome ?? "—"}${latestActivity.call.notes ? ` · ${latestActivity.call.notes}` : ""}`
                : "No calls logged yet."
            }
          />
          <ActivityRow
            label="Next appointment"
            timestamp={latestActivity.appointment?.startsAt}
            summary={
              latestActivity.appointment
                ? `${latestActivity.appointment.eventType ?? "appointment"}${latestActivity.appointment.serviceType ? ` · ${latestActivity.appointment.serviceType}` : ""}`
                : "No appointment scheduled."
            }
          />
          <ActivityRow
            label="Last ancillary"
            timestamp={latestActivity.ancillary?.completedAt}
            summary={
              latestActivity.ancillary
                ? `${latestActivity.ancillary.serviceType ?? "Ancillary"} · ${latestActivity.ancillary.procedureStatus ?? "—"}`
                : "No ancillaries logged yet."
            }
          />
          <ActivityRow
            label="Last journey event"
            timestamp={latestActivity.journeyEvent?.createdAt}
            summary={
              latestActivity.journeyEvent
                ? `${latestActivity.journeyEvent.eventType ?? ""}${latestActivity.journeyEvent.summary ? ` · ${latestActivity.journeyEvent.summary}` : ""}`
                : "No journey events yet."
            }
          />
          <ActivityRow label="Last text" timestamp={null} summary="No text messages recorded yet." />
          <ActivityRow label="Last email" timestamp={null} summary="No emails recorded yet." />
        </div>
      </Card>

      {/* ─── Full history folders ──────────────────────────────────── */}
      <Card className="p-4 bg-white" data-testid="patient-command-canvas-history">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Full history</div>
          <span className="text-[10px] text-slate-500">Click a folder to expand below</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <HistoryIcon
            label="All"
            icon={<FolderOpen className="h-4 w-4" />}
            count={
              histories.calls.length +
              histories.appointments.length +
              histories.ancillaries.length +
              histories.journeyEvents.length
            }
            onClick={() => {
              setActiveHistory("all");
              onOpenPatientHistory?.(patient, "all");
            }}
            testId="patient-history-folder-all"
          />
          <HistoryIcon
            label="Calls"
            icon={<Phone className="h-4 w-4" />}
            count={histories.calls.length}
            onClick={() => {
              setActiveHistory("calls");
              onOpenPatientHistory?.(patient, "calls");
            }}
            testId="patient-history-folder-calls"
          />
          <HistoryIcon
            label="Texts"
            icon={<MessageSquare className="h-4 w-4" />}
            count={histories.texts.length}
            onClick={() => {
              setActiveHistory("texts");
              onOpenPatientHistory?.(patient, "texts");
            }}
            testId="patient-history-folder-texts"
          />
          <HistoryIcon
            label="Emails"
            icon={<Mail className="h-4 w-4" />}
            count={histories.emails.length}
            onClick={() => {
              setActiveHistory("emails");
              onOpenPatientHistory?.(patient, "emails");
            }}
            testId="patient-history-folder-emails"
          />
          <HistoryIcon
            label="Notes"
            icon={<FileText className="h-4 w-4" />}
            count={histories.notes.length}
            onClick={() => {
              setActiveHistory("notes");
              onOpenPatientHistory?.(patient, "notes");
            }}
            testId="patient-history-folder-notes"
          />
          <HistoryIcon
            label="Appointments"
            icon={<CalendarDays className="h-4 w-4" />}
            count={histories.appointments.length}
            onClick={() => {
              setActiveHistory("appointments");
              onOpenPatientHistory?.(patient, "appointments");
            }}
            testId="patient-history-folder-appointments"
          />
          <HistoryIcon
            label="Ancillaries"
            icon={<ClipboardList className="h-4 w-4" />}
            count={histories.ancillaries.length}
            onClick={() => {
              setActiveHistory("ancillaries");
              onOpenPatientHistory?.(patient, "ancillaries");
            }}
            testId="patient-history-folder-ancillaries"
          />
          <HistoryIcon
            label="Journey"
            icon={<FolderOpen className="h-4 w-4" />}
            count={histories.journeyEvents.length}
            onClick={() => {
              setActiveHistory("journey");
              onOpenPatientHistory?.(patient, "journey");
            }}
            testId="patient-history-folder-journey"
          />
        </div>

        <div className="mt-3">
          <HistoryPanel section={activeHistory} histories={histories} />
        </div>
      </Card>

      {/* ─── Action strip ─────────────────────────────────────────── */}
      <Card className="p-3 bg-white" data-testid="patient-command-canvas-actions">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSchedulePatient?.(patient)}
            className="gap-1.5"
            data-testid="action-schedule-patient"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Schedule
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenTasksForPatient?.(patient)}
            className="gap-1.5"
            data-testid="action-open-patient-tasks"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Plexus Tasks
            {tasks.length > 0 ? (
              <Badge className="ml-1 bg-slate-100 text-slate-700">{tasks.length}</Badge>
            ) : null}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenMarketingForPatient?.(patient)}
            className="gap-1.5"
            data-testid="action-send-marketing"
          >
            <Megaphone className="h-3.5 w-3.5" />
            Send Marketing
          </Button>
          <Button size="sm" variant="outline" disabled className="gap-1.5" title="Coming soon">
            <Phone className="h-3.5 w-3.5" />
            Call
          </Button>
          <Button size="sm" variant="outline" disabled className="gap-1.5" title="Coming soon">
            <MessageSquare className="h-3.5 w-3.5" />
            Text
          </Button>
          <Button size="sm" variant="outline" disabled className="gap-1.5" title="Coming soon">
            <Mail className="h-3.5 w-3.5" />
            Email
          </Button>
          <Button size="sm" variant="outline" disabled className="gap-1.5" title="Coming soon">
            <FileSignature className="h-3.5 w-3.5" />
            Consent / Screening
          </Button>
          {isAcs && (
            <Button size="sm" variant="outline" disabled className="gap-1.5" title="Procedure Complete is wired from the right-panel ancillary row">
              <ClipboardList className="h-3.5 w-3.5" />
              Procedure Complete
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function ActivityRow({
  label,
  timestamp,
  summary,
}: {
  label: string;
  timestamp: string | null | undefined;
  summary: string;
}) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2" data-testid={`activity-row-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div className="text-[10px] text-slate-500">{formatDateTime(timestamp)}</div>
      </div>
      <div className="mt-0.5 text-[12px] text-slate-900 truncate">{summary}</div>
    </div>
  );
}

function HistoryPanel({
  section,
  histories,
}: {
  section: HistorySection;
  histories: CommandCenterResponse["histories"];
}) {
  const rows = (() => {
    switch (section) {
      case "calls":
        return histories.calls.map((c: any, i) => ({
          key: c.id ?? i,
          when: c.startedAt,
          label: c.outcome ?? "call",
          detail: c.notes ?? null,
        }));
      case "appointments":
        return histories.appointments.map((a: any, i) => ({
          key: a.id ?? i,
          when: a.startsAt,
          label: a.eventType ?? "appointment",
          detail: a.serviceType ?? null,
        }));
      case "ancillaries":
        return histories.ancillaries.map((a: any, i) => ({
          key: a.id ?? i,
          when: a.completedAt,
          label: a.serviceType ?? "ancillary",
          detail: a.procedureStatus ?? null,
        }));
      case "notes":
        return histories.notes.map((n) => ({
          key: n.id,
          when: n.createdAt,
          label: n.serviceType ?? "note",
          detail: n.text,
        }));
      case "journey":
        return histories.journeyEvents.map((j: any, i) => ({
          key: j.id ?? i,
          when: j.createdAt,
          label: j.eventType ?? "event",
          detail: j.summary ?? null,
        }));
      case "texts":
      case "emails":
        return [];
      case "all":
      default:
        return [
          ...histories.calls.map((c: any, i) => ({ key: `c${i}`, when: c.startedAt, label: `call · ${c.outcome ?? ""}`, detail: c.notes ?? null })),
          ...histories.appointments.map((a: any, i) => ({ key: `a${i}`, when: a.startsAt, label: `appt · ${a.eventType ?? ""}`, detail: a.serviceType ?? null })),
          ...histories.ancillaries.map((a: any, i) => ({ key: `n${i}`, when: a.completedAt, label: `ancillary · ${a.serviceType ?? ""}`, detail: a.procedureStatus ?? null })),
          ...histories.journeyEvents.map((j: any, i) => ({ key: `j${i}`, when: j.createdAt, label: `journey · ${j.eventType ?? ""}`, detail: j.summary ?? null })),
        ].sort((a, b) => {
          const ad = a.when ? new Date(a.when).getTime() : 0;
          const bd = b.when ? new Date(b.when).getTime() : 0;
          return bd - ad;
        });
    }
  })();

  if (section === "texts") {
    return (
      <div className="text-[11px] text-slate-500 italic py-2">
        No text messages recorded yet. (Pending canonical patient_communications table.)
      </div>
    );
  }
  if (section === "emails") {
    return (
      <div className="text-[11px] text-slate-500 italic py-2">
        No emails recorded yet. (Pending canonical patient_communications table.)
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-2">
        No {section} on file yet.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 max-h-64 overflow-y-auto" data-testid={`patient-history-list-${section}`}>
      {rows.slice(0, 50).map((r) => (
        <li key={String(r.key)} className="rounded-md bg-slate-50 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-slate-900 truncate">{r.label}</div>
            <div className="text-[10px] text-slate-500">{formatDateTime(r.when as string | null)}</div>
          </div>
          {r.detail ? (
            <div className="text-[11px] text-slate-700 whitespace-pre-wrap line-clamp-3">{r.detail}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
