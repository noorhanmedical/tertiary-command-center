import { useEffect, useMemo, useState } from "react";
import { PhoneCall, AlertTriangle } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BackToDashboard } from "../ClinicianPortalShell";
import {
  StatCard, ServiceChip, StatusPill, SideDrawer, FilterBar, SearchInput, Section, EmptyState,
} from "../ui/primitives";
import { DataTable, type Column } from "../ui/DataTable";
import { PipelineFunnel } from "../finance/FinancePage";
import {
  type CallTask, type CallOutcome, type CallStatus, type ScheduleItem,
  type Qualification, type EngagementActivity, type Escalation,
} from "../mockData";
import { usePortalData } from "../usePortalData";

const CALL_OUTCOMES: CallOutcome[] = ["No Answer", "Left Voicemail", "Reached — Interested", "Reached — Callback", "Scheduled", "Declined"];

const STATUS_TONE: Record<CallStatus, "gray" | "amber" | "blue" | "green" | "red"> = {
  "Not Started": "gray", Attempted: "amber", Reached: "blue", Scheduled: "green", "Do Not Contact": "red",
};
const PRIORITY_TONE = { High: "red", Medium: "amber", Low: "gray" } as const;

export function PlexusEngagementPage() {
  const { data } = usePortalData();
  const eng = data?.engagement;
  const QUALIFICATIONS: Qualification[] = eng?.qualifications ?? [];
  const ENGAGEMENT_ACTIVITY: EngagementActivity[] = eng?.activity ?? [];
  const ESCALATIONS: Escalation[] = eng?.escalations ?? [];
  const STAFF = eng?.staff ?? [];
  const ENGAGEMENT_KPIS = eng?.kpis;

  const [calls, setCalls] = useState<CallTask[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const [period, setPeriod] = useState("Today");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (eng?.callTasks) setCalls(eng.callTasks);
  }, [eng?.callTasks]);
  useEffect(() => {
    if (eng?.schedule) setSchedule(eng.schedule);
  }, [eng?.schedule]);

  const active = calls.find((c) => c.id === activeId) ?? null;

  const scheduledCount = calls.filter((c) => c.status === "Scheduled").length;
  const reachedCount = calls.filter((c) => c.status === "Reached").length;
  const callbacks = calls.filter((c) => c.lastOutcome === "Reached — Callback").length;

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (serviceFilter !== "all" && !c.services.some((s) => s === serviceFilter || serviceLineMatches(s, serviceFilter))) return false;
      if (staffFilter !== "all" && c.assignedTo !== staffFilter) return false;
      if (outcomeFilter !== "all" && c.lastOutcome !== outcomeFilter) return false;
      if (q && !c.patientName.toLowerCase().includes(q) && !c.mrn.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [calls, serviceFilter, staffFilter, outcomeFilter, search]);

  function updateOutcome(id: string, outcome: CallOutcome) {
    setCalls((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const status: CallStatus = outcome === "Scheduled" ? "Scheduled"
        : outcome.startsWith("Reached") ? "Reached"
        : outcome === "Declined" ? "Do Not Contact" : "Attempted";
      return { ...c, lastOutcome: outcome, status, history: [...c.history, { label: "Outcome updated", outcome, date: nowStamp() }] };
    }));
  }

  function markScheduled(id: string) {
    const call = calls.find((c) => c.id === id);
    if (!call) return;
    updateOutcome(id, "Scheduled");
    if (!schedule.some((s) => s.mrn === call.mrn && s.service === call.services[0])) {
      setSchedule((prev) => [...prev, {
        id: `SCH-${Date.now()}`, time: "15:30", patientName: call.patientName, mrn: call.mrn, service: call.services[0],
        technician: "—", status: "Scheduled", source: "Plexus Qualification",
      }]);
    }
  }

  function setDoNotContact(id: string) {
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, status: "Do Not Contact", lastOutcome: "Declined" } : c)));
  }

  const callColumns: Column<CallTask>[] = [
    { key: "patient", header: "Patient", render: (c) => <div><div>{c.patientName}</div><div className="text-xs text-finance-text-muted">{c.mrn}</div></div> },
    { key: "qualified", header: "Qualified For", render: (c) => <div className="flex flex-wrap gap-1">{c.services.map((s) => <ServiceChip key={s} service={s} />)}</div> },
    { key: "priority", header: "Priority", render: (c) => <StatusPill label={c.priority} tone={PRIORITY_TONE[c.priority]} /> },
    { key: "assigned", header: "Assigned", render: (c) => <span className="text-xs">{c.assignedTo}</span> },
    { key: "status", header: "Call Status", render: (c) => <StatusPill label={c.status} tone={STATUS_TONE[c.status]} /> },
    { key: "outcome", header: "Last Outcome", render: (c) => <span className="text-xs text-finance-text-secondary">{c.lastOutcome}</span> },
    { key: "next", header: "Next Step", render: (c) => <span className="text-xs text-finance-text-secondary">{c.nextStep}</span> },
  ];

  return (
    <div className="space-y-6">
      <BackToDashboard />
      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Plexus Engagement</h1>
        <p className="text-sm text-finance-text-muted">Patient outreach call list and conversion pipeline.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active Call List" value={String(filteredCalls.length)} testId="ekpi-active" />
        <StatCard label="Calls Today" value={String(ENGAGEMENT_KPIS?.callsCompletedToday ?? 0)} testId="ekpi-calls" />
        <StatCard label="Scheduled Today" value={String(scheduledCount)} testId="ekpi-scheduled" />
        <StatCard label="Pending Callbacks" value={String(callbacks)} testId="ekpi-callbacks" />
      </div>

      <FilterBar>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-9 w-[130px]" data-testid="select-eng-period"><SelectValue /></SelectTrigger>
          <SelectContent>{["Today", "This week", "All"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-eng-service"><SelectValue placeholder="Service" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            <SelectItem value="BrainWave">BrainWave</SelectItem>
            <SelectItem value="VitalWave">VitalWave</SelectItem>
            <SelectItem value="Ultrasound">Ultrasound</SelectItem>
          </SelectContent>
        </Select>
        <Select value={staffFilter} onValueChange={setStaffFilter}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-eng-staff"><SelectValue placeholder="Staff" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            {STAFF.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="h-9 w-[170px]" data-testid="select-eng-outcome"><SelectValue placeholder="Outcome" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {CALL_OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search patients…" testId="input-eng-search" className="ml-auto w-56" />
      </FilterBar>

      <Section title="Live Call List" description="RingCentral dialer integration pending — outcomes tracked manually." testId="section-call-list">
        {filteredCalls.length === 0 ? (
          <EmptyState message="No call tasks match your filters." testId="empty-calls" />
        ) : (
          <DataTable columns={callColumns} rows={filteredCalls} onRowClick={(c) => { setActiveId(c.id); setNoteText(""); }} rowTestId={(c) => `row-call-${c.id}`} />
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Qualifications Completed" testId="section-qualifications">
          <DataTable
            columns={[
              { key: "patient", header: "Patient", render: (q: Qualification) => q.patientName },
              { key: "services", header: "Services", render: (q) => <div className="flex flex-wrap gap-1">{q.services.map((s) => <ServiceChip key={s} service={s} />)}</div> },
              { key: "source", header: "Source", render: (q) => <span className="text-xs">{q.source}</span> },
              { key: "status", header: "Status", render: (q) => <StatusPill label={q.status} tone={q.status === "Completed" ? "green" : "amber"} /> },
              { key: "next", header: "Next Step", render: (q) => <span className="text-xs text-finance-text-secondary">{q.nextStep}</span> },
            ]}
            rows={QUALIFICATIONS}
            rowTestId={(q) => `row-qual-${q.id}`}
          />
        </Section>

        <Section title="Today's Engagement Activity" testId="section-activity">
          <DataTable
            columns={[
              { key: "time", header: "Time", render: (a: EngagementActivity) => <span className="tabular-nums">{a.time}</span> },
              { key: "actor", header: "Staff", render: (a) => a.actor },
              { key: "action", header: "Activity", render: (a) => a.action },
              { key: "patient", header: "Patient", render: (a) => a.patientName ?? "—" },
            ]}
            rows={ENGAGEMENT_ACTIVITY}
            rowTestId={(a) => `row-activity-${a.id}`}
          />
        </Section>
      </div>

      <Section title="Live Schedule" testId="section-schedule">
        <DataTable
          columns={[
            { key: "time", header: "Time", render: (s: ScheduleItem) => <span className="tabular-nums">{s.time}</span> },
            { key: "patient", header: "Patient", render: (s) => s.patientName },
            { key: "service", header: "Service", render: (s) => <ServiceChip service={s.service} /> },
            { key: "tech", header: "Technician", render: (s) => <span className="text-xs">{s.technician}</span> },
            { key: "status", header: "Status", render: (s) => <StatusPill label={s.status} tone={s.status === "Completed" ? "green" : s.status === "In Progress" ? "blue" : s.status === "Checked In" ? "violet" : "gray"} /> },
            { key: "source", header: "Source", render: (s) => <span className="text-xs text-finance-text-secondary">{s.source}</span> },
          ]}
          rows={schedule}
          rowTestId={(s) => `row-schedule-${s.id}`}
        />
      </Section>

      <Section title="Outreach Pipeline" description="Shared with Finance — counts and values match the ancillary financial pipeline." testId="section-outreach-pipeline">
        <PipelineFunnel />
      </Section>

      <Section title="Escalations" testId="section-escalations">
        <DataTable
          columns={[
            { key: "patient", header: "Patient", render: (e: Escalation) => e.patientName },
            { key: "reason", header: "Reason", render: (e) => <span className="text-finance-text-secondary">{e.reason}</span> },
            { key: "service", header: "Service", render: (e) => <ServiceChip service={e.service} /> },
            { key: "assigned", header: "Assigned", render: (e) => <span className="text-xs">{e.assignedTo}</span> },
            { key: "age", header: "Age", align: "right", render: (e) => <span className="inline-flex items-center gap-1 text-xs"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />{e.ageDays}d</span> },
            { key: "action", header: "Action", render: () => <Button size="sm" variant="outline" className="h-7">Resolve</Button> },
          ]}
          rows={ESCALATIONS}
          rowTestId={(e) => `row-escalation-${e.id}`}
        />
      </Section>

      {/* Call detail drawer */}
      <SideDrawer
        open={!!active}
        onOpenChange={(o) => !o && setActiveId(null)}
        title={active ? active.patientName : ""}
        subtitle={active ? `${active.mrn} · ${active.age}${active.gender} · ${active.phone}` : ""}
        testId="drawer-call"
        footer={active && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => markScheduled(active.id)} data-testid="button-schedule-call"><PhoneCall className="mr-1.5 h-4 w-4" /> Schedule</Button>
            <Button size="sm" variant="outline" data-testid="button-escalate-call">Escalate</Button>
            <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setDoNotContact(active.id)} data-testid="button-dnc-call">Do Not Contact</Button>
          </div>
        )}
      >
        {active && (
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Qualified Services</div>
              <div className="flex flex-wrap gap-1.5">{active.services.map((s) => <ServiceChip key={s} service={s} />)}</div>
            </div>
            <div className="rounded-[10px] border border-finance-border bg-finance-bg-soft p-3 text-sm text-finance-text">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Qualification Reason</div>
              {active.reason}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-[11px] uppercase text-finance-text-muted">Last Appointment</div><div>{active.lastAppointment}</div></div>
              <div><div className="text-[11px] uppercase text-finance-text-muted">Assigned To</div><div>{active.assignedTo}</div></div>
              <div><div className="text-[11px] uppercase text-finance-text-muted">Priority</div><StatusPill label={active.priority} tone={PRIORITY_TONE[active.priority]} /></div>
              <div><div className="text-[11px] uppercase text-finance-text-muted">Status</div><StatusPill label={active.status} tone={STATUS_TONE[active.status]} /></div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Set Outcome</div>
              <Select value={active.lastOutcome === "—" ? undefined : active.lastOutcome} onValueChange={(v) => updateOutcome(active.id, v as CallOutcome)}>
                <SelectTrigger className="h-9" data-testid="select-call-outcome"><SelectValue placeholder="Select outcome…" /></SelectTrigger>
                <SelectContent>{CALL_OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Call History</div>
              {active.history.length === 0 ? (
                <p className="text-sm text-finance-text-muted">No call history yet.</p>
              ) : (
                <ol className="space-y-3">
                  {active.history.map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-finance-periwinkle" />
                      <div><div className="text-sm text-finance-text">{h.outcome}</div><div className="text-xs text-finance-text-muted">{h.label} · {h.date}</div></div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-finance-text-muted">Notes</div>
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a call note…" className="min-h-[72px] text-sm" data-testid="textarea-call-note" />
            </div>
          </div>
        )}
      </SideDrawer>
    </div>
  );
}

function serviceLineMatches(service: string, line: string): boolean {
  if (line === "BrainWave") return service === "BrainWave";
  if (line === "VitalWave") return service === "VitalWave";
  if (line === "Ultrasound") return service !== "BrainWave" && service !== "VitalWave";
  return false;
}

function nowStamp() {
  return "2026-06-25 " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
