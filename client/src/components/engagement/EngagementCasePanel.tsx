import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  User2,
  Phone,
  Building2,
  Stethoscope,
  FileText,
  Loader2,
  ExternalLink,
  Trash2,
  ClipboardList,
  ShieldAlert,
  History,
  Plus,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { PatientScreening, TestReasoning } from "@shared/schema";
import {
  type BoardRow,
  type SchedulerOption,
  type AssignedRole,
  ROLE_LABELS,
  callReasonOf,
  cooldownNames,
  dueLabel,
  fmtRel,
  openSinglePatientPacket,
  priorityOf,
  PRIORITY_LABELS,
  coverageRelation,
  sortSchedulersByCoverage,
  type JourneyEvent,
  JOURNEY_EVENT_TONE,
  journeyEventLabel,
} from "./engagementShared";
import { MemberLoadTag } from "./EngagementAssignmentBoard";

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  normal: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function Section({
  icon: Icon,
  title,
  children,
  testId,
}: {
  icon: typeof User2;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}

export function EngagementCasePanel({
  row,
  schedulers,
  memberLoad,
  assigning,
  cancelling,
  onAssign,
  onCancel,
  onClose,
}: {
  row: BoardRow | null;
  schedulers: SchedulerOption[];
  /** Open-case count per assignedTeamMemberId across the full board — drives
   *  the per-member load indicator in the team-member picker. */
  memberLoad?: Map<number, number>;
  assigning: boolean;
  cancelling: boolean;
  onAssign: (
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) => void;
  onCancel: (executionCaseIds: number[]) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [schedulerId, setSchedulerId] = useState<string>("");
  const [role, setRole] = useState<AssignedRole>("scheduler");
  const [notes, setNotes] = useState("");
  const [pdfBusy, setPdfBusy] = useState<"plexus" | "clinician" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  const psid = row?.patientScreeningId ?? null;

  // Hydrate assignment form whenever the selected case changes.
  useEffect(() => {
    setSchedulerId(
      row?.assignedTeamMemberId != null ? String(row.assignedTeamMemberId) : "",
    );
    setRole((row?.assignedRole as AssignedRole) ?? "scheduler");
    setNotes("");
    setNoteDraft("");
    setNoteOpen(false);
  }, [row?.executionCaseId, row?.assignedTeamMemberId, row?.assignedRole]);

  const patientQuery = useQuery<PatientScreening>({
    queryKey: ["/api/patients", psid],
    enabled: psid != null,
  });
  const patient = patientQuery.data;

  const executionCaseId = row?.executionCaseId ?? null;
  const journeyQuery = useQuery<{ events: JourneyEvent[] }>({
    queryKey: [
      "/api/engagement/assignment-board/cases",
      executionCaseId,
      "journey",
    ],
    enabled: executionCaseId != null,
  });
  const journeyEvents = journeyQuery.data?.events ?? [];

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      if (executionCaseId == null) throw new Error("No case selected");
      const res = await apiRequest(
        "POST",
        `/api/engagement/assignment-board/cases/${executionCaseId}/journey`,
        { note },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "/api/engagement/assignment-board/cases",
          executionCaseId,
          "journey",
        ],
      });
      setNoteDraft("");
      setNoteOpen(false);
      toast({ title: "Note added", description: "Saved to the timeline." });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not add note",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const reasoningEntries = useMemo(() => {
    const r = patient?.reasoning as
      | Record<string, TestReasoning | string>
      | null
      | undefined;
    if (!r || typeof r !== "object") return [] as Array<[string, TestReasoning | string]>;
    return Object.entries(r);
  }, [patient?.reasoning]);

  const cooldown = useMemo(() => cooldownNames(patient?.cooldownTests), [
    patient?.cooldownTests,
  ]);

  if (!row) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-8 text-center"
        data-testid="engagement-case-panel-empty"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          <ClipboardList className="h-7 w-7" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
          No case selected
        </p>
        <p className="mt-1 max-w-[220px] text-xs text-slate-400 dark:text-slate-500">
          Pick a patient from the worklist to review their qualification and
          assign the call.
        </p>
      </div>
    );
  }

  const priority = priorityOf(row);
  const services = row.selectedServices ?? [];
  const nextActionDate = row.nextActionAt
    ? new Date(row.nextActionAt).toISOString().slice(0, 10)
    : "";

  async function handlePdf(mode: "plexus" | "clinician") {
    if (psid == null || !row) return;
    setPdfBusy(mode);
    const result = await openSinglePatientPacket(
      psid,
      row.patientName,
      row.scheduleDate ?? null,
      mode,
    );
    setPdfBusy(null);
    if (!result.ok) {
      toast({
        title: "Could not open packet",
        description: result.error,
        variant: "destructive",
      });
    }
  }

  function handleSave() {
    if (psid == null) {
      toast({
        title: "Cannot assign",
        description: "This case is not linked to a patient screening.",
        variant: "destructive",
      });
      return;
    }
    const sid = Number.parseInt(schedulerId, 10);
    if (!Number.isFinite(sid)) {
      toast({
        title: "Pick a team member",
        description: "Choose who should own this call.",
        variant: "destructive",
      });
      return;
    }
    onAssign([psid], sid, {
      reason: notes.trim() || undefined,
      role,
    });
  }

  return (
    <div
      className="flex h-full flex-col"
      data-testid="engagement-case-panel"
      data-execution-case-id={row.executionCaseId}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2
              className="truncate text-base font-semibold text-slate-900 dark:text-white"
              data-testid="engagement-case-panel-name"
            >
              {row.patientName}
            </h2>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_TONE[priority]}`}
              title="Derived priority (read-only)"
            >
              {PRIORITY_LABELS[priority]}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {row.patientDob && <span>{row.patientDob}</span>}
            {row.phoneNumber && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {row.phoneNumber}
              </span>
            )}
            {row.facility && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {row.facility}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-slate-700"
          onClick={onClose}
          aria-label="Close panel"
          data-testid="engagement-case-panel-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Call summary */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Call reason
            </div>
            <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
              {callReasonOf(row)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Next action
            </div>
            <div
              className="mt-0.5 font-medium text-slate-800 dark:text-slate-100"
              data-testid="engagement-case-panel-due"
            >
              {dueLabel(row.nextActionAt)}
            </div>
          </div>
        </div>

        {/* Target tests */}
        <Section icon={Stethoscope} title="Target tests" testId="engagement-case-panel-tests">
          {services.length ? (
            <div className="flex flex-wrap gap-1.5">
              {services.map((s) => (
                <span
                  key={s}
                  className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                >
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">No qualifying tests selected.</p>
          )}
        </Section>

        {/* Missing info */}
        {row.missingInfo?.length ? (
          <Section icon={ShieldAlert} title="Blocking gaps">
            <ul className="space-y-1">
              {row.missingInfo.map((m) => (
                <li
                  key={m}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                >
                  <ShieldAlert className="h-3 w-3 shrink-0" />
                  {m}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* Qualification reasoning */}
        <Section icon={Stethoscope} title="Qualification reasoning" testId="engagement-case-panel-reasoning">
          {patientQuery.isLoading ? (
            <p className="flex items-center gap-1.5 text-xs italic text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading clinical detail…
            </p>
          ) : reasoningEntries.length ? (
            <div className="space-y-2">
              {reasoningEntries.map(([test, value]) => {
                const obj = typeof value === "object" ? value : null;
                const text = typeof value === "string" ? value : null;
                return (
                  <div
                    key={test}
                    className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800"
                  >
                    <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                      {test}
                    </div>
                    {text && (
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {text}
                      </p>
                    )}
                    {obj?.clinician_understanding && (
                      <div className="mt-1.5">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          Clinician understanding
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                          {obj.clinician_understanding}
                        </p>
                      </div>
                    )}
                    {obj?.patient_talking_points && (
                      <div className="mt-1.5">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          Patient talking points
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                          {obj.patient_talking_points}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">
              No qualification reasoning recorded for this patient.
            </p>
          )}
        </Section>

        {/* Supporting diagnoses */}
        <Section icon={ClipboardList} title="Clinical context" testId="engagement-case-panel-clinical">
          {patientQuery.isLoading ? (
            <p className="text-xs italic text-slate-400">Loading…</p>
          ) : patient && (patient.diagnoses || patient.history || patient.medications) ? (
            <div className="space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
              {patient.diagnoses && (
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Dx: </span>
                  {patient.diagnoses}
                </div>
              )}
              {patient.history && (
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Hx: </span>
                  {patient.history}
                </div>
              )}
              {patient.medications && (
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Rx: </span>
                  {patient.medications}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">No clinical context on file.</p>
          )}
        </Section>

        {/* Cooldown / eligibility */}
        <Section icon={History} title="Cooldown / eligibility">
          {cooldown.length ? (
            <div className="flex flex-wrap gap-1.5">
              {cooldown.map((c) => (
                <span
                  key={c}
                  className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">No active cooldowns.</p>
          )}
        </Section>

        {/* Journey timeline — full chronological history of engagement
            events for this patient (call outcomes, assignments/
            reassignments, notes, and every other journey-event kind). */}
        <Section icon={History} title="Journey timeline" testId="engagement-case-panel-timeline">
          <div className="flex justify-end">
            {noteOpen ? null : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => setNoteOpen(true)}
                data-testid="engagement-case-panel-add-note"
              >
                <Plus className="h-3 w-3" />
                Add note
              </Button>
            )}
          </div>
          {noteOpen && (
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/40">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add context to this patient's timeline…"
                className="min-h-[56px] text-xs"
                autoFocus
                data-testid="engagement-case-panel-note-input"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  disabled={addNoteMutation.isPending}
                  onClick={() => {
                    setNoteOpen(false);
                    setNoteDraft("");
                  }}
                  data-testid="engagement-case-panel-note-cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={
                    addNoteMutation.isPending || !noteDraft.trim()
                  }
                  onClick={() => addNoteMutation.mutate(noteDraft.trim())}
                  data-testid="engagement-case-panel-note-save"
                >
                  {addNoteMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Save note
                </Button>
              </div>
            </div>
          )}
          {journeyQuery.isLoading ? (
            <p className="flex items-center gap-1.5 text-xs italic text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
            </p>
          ) : journeyQuery.isError ? (
            <p className="text-xs italic text-rose-400">
              Could not load history.
            </p>
          ) : journeyEvents.length ? (
            <ol
              className="relative max-h-72 space-y-3 overflow-y-auto border-l border-slate-200 pl-4 pr-1 dark:border-slate-800"
              data-testid="engagement-case-panel-timeline-list"
            >
              {journeyEvents.map((e, idx) => {
                const tone = JOURNEY_EVENT_TONE[e.eventType] ?? "bg-slate-300 dark:bg-slate-600";
                return (
                  <li
                    key={e.id}
                    className="relative"
                    data-testid={`engagement-case-panel-timeline-event-${e.id}`}
                  >
                    <span
                      className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                        idx === 0 ? tone : `${tone} opacity-70`
                      }`}
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        {journeyEventLabel(e.eventType)}
                      </span>
                    </div>
                    <div className="text-[11px] font-medium leading-snug text-slate-700 dark:text-slate-200">
                      {e.summary}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-400">
                      <span title={e.createdAt ? new Date(e.createdAt).toLocaleString() : undefined}>
                        {fmtRel(e.createdAt)}
                      </span>
                      {e.actorName && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{e.actorName}</span>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-800">
              <li className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-300 ring-2 ring-white dark:bg-slate-600 dark:ring-slate-900" />
                <div className="text-[11px] italic text-slate-400">
                  No call history recorded yet.
                </div>
              </li>
            </ol>
          )}
        </Section>

        {/* PDF links */}
        <Section icon={FileText} title="Packets">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={psid == null || pdfBusy !== null}
              onClick={() => handlePdf("plexus")}
              data-testid="engagement-case-panel-plexus-pdf"
            >
              {pdfBusy === "plexus" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Plexus PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={psid == null || pdfBusy !== null}
              onClick={() => handlePdf("clinician")}
              data-testid="engagement-case-panel-clinician-pdf"
            >
              {pdfBusy === "clinician" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Clinician PDF
            </Button>
            {psid != null && (
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-slate-500"
              >
                <a
                  href={`/patient-directory?patientId=${psid}`}
                  data-testid="engagement-case-panel-open-patient"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open patient
                </a>
              </Button>
            )}
          </div>
        </Section>
      </div>

      {/* Assignment form (sticky footer) */}
      <div className="space-y-2.5 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        {/* Triage controls — priority + next action. Currently derived
            and read-only: the assignment data spine has no field to
            persist these, so the controls are explicit stubs. */}
        <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Triage
            </span>
            <span className="text-[9px] italic text-slate-400">
              Derived · read-only
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                Priority
              </Label>
              <Select value={priority} disabled>
                <SelectTrigger
                  className="mt-1 h-8 text-xs"
                  data-testid="engagement-case-panel-priority"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                Next action
              </Label>
              <Input
                type="date"
                value={nextActionDate}
                disabled
                readOnly
                className="mt-1 h-8 text-xs"
                data-testid="engagement-case-panel-next-action"
              />
            </div>
          </div>
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Assign this call
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Team member
          </Label>
          <Select value={schedulerId} onValueChange={setSchedulerId}>
            <SelectTrigger
              className="mt-1 h-8 text-xs"
              data-testid="engagement-case-panel-scheduler"
            >
              <SelectValue placeholder="Pick a team member…" />
            </SelectTrigger>
            <SelectContent>
              {sortSchedulersByCoverage(schedulers, row.facility).map((s) => {
                const relation = coverageRelation(s, row.facility);
                return (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate">
                        {s.name} · {s.facility}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <MemberLoadTag
                          open={memberLoad?.get(s.id) ?? 0}
                          dailyTarget={s.dailyTarget}
                        />
                        {relation !== "none" && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                              relation === "home"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                            }`}
                            data-testid={`engagement-coverage-tag-${relation}`}
                          >
                            {relation === "home" ? "Home" : "Covers"}
                          </span>
                        )}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Role
          </Label>
          <Select value={role} onValueChange={(v) => setRole(v as AssignedRole)}>
            <SelectTrigger
              className="mt-1 h-8 text-xs"
              data-testid="engagement-case-panel-role"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as AssignedRole[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Notes
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this assignment / context for the call…"
            className="mt-1 min-h-[56px] text-xs"
            data-testid="engagement-case-panel-notes"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 flex-1 gap-1.5 text-xs"
            disabled={assigning || psid == null || !schedulerId}
            onClick={handleSave}
            data-testid="engagement-case-panel-save"
          >
            {assigning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <User2 className="h-3.5 w-3.5" />
            )}
            Save assignment
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs text-rose-600 hover:text-rose-700"
            disabled={cancelling}
            onClick={() => {
              if (
                confirm(
                  "Remove this assignment from Engagement Center? The patient record stays in Plexus IQ.",
                )
              ) {
                onCancel([row.executionCaseId]);
              }
            }}
            data-testid="engagement-case-panel-remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
