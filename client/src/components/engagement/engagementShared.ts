// Shared types + pure helpers for the redesigned Engagement Center
// command UI. Everything here is read-only / derivation logic — no
// schema, no new endpoints. The board row contract is the single
// source of truth (shared/contracts/engagementBoard.ts); these
// helpers only DERIVE display state (due buckets, smart-filter
// membership, priority, call reason) from the fields it already
// carries.

import type { EngagementBoardRow } from "@shared/contracts/engagementBoard";
import type { PatientScreening } from "@shared/schema";
import {
  openPatientPacketPrintPreview,
  openSchedulerPacketPrintPreview,
} from "@/lib/pdfGeneration";

export type BoardRow = EngagementBoardRow;

export type BoardSummary = {
  total: number;
  assigned: number;
  unassigned: number;
  needsInfo: number;
  byFacility: Array<{ facility: string; count: number }>;
  byAssignedTeamMember: Array<{ name: string; count: number }>;
  byEngagementStatus: Array<{ status: string; count: number }>;
};

export type BoardResponse = { rows: BoardRow[]; summary: BoardSummary };

export type SchedulerOption = {
  id: number;
  name: string;
  facility: string;
  /** Extra facilities this member explicitly covers (per-member engagement
   *  call settings). Empty/undefined when no coverage is configured. */
  facilitiesCovered?: string[];
  /** Absolute daily call target for this member (outreach_schedulers.dailyTarget).
   *  Null/undefined when no target is configured — load indicators then fall
   *  back to a plain open-case count. */
  dailyTarget?: number | null;
};

// ─── Per-member load (capacity signal) ──────────────────────────────
//
// The manual assignment picker surfaces how loaded each team member already
// is so a manager picking among several covering members can tell who has
// room. Load is the count of currently OPEN engagement cases assigned to a
// member, derived from the board rows (the board only contains active,
// non-closed cases — exactly the live workload). When a daily target is
// configured we show "open / target"; otherwise we degrade to a plain
// open-case count.

/** Count open engagement cases per assignedTeamMemberId from board rows.
 *  Build this from the FULL row set (not a filtered/visible subset) so the
 *  number reflects each member's total live workload. */
export function buildMemberLoadMap(rows: BoardRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) {
    if (r.assignedTeamMemberId != null) {
      m.set(r.assignedTeamMemberId, (m.get(r.assignedTeamMemberId) ?? 0) + 1);
    }
  }
  return m;
}

export type MemberLoadTone = "ok" | "warn" | "full" | "none";

export type MemberLoad = {
  /** Short label e.g. "12 / 20" (with target) or "12 open" (no target). */
  text: string;
  /** open ÷ dailyTarget when a positive target exists, else null. */
  ratio: number | null;
  /** Fullness tone: "none" when no target, else ok/warn/full by ratio. */
  tone: MemberLoadTone;
};

/** Derive a member's display load from their open-case count and daily target.
 *  Falls back cleanly to a plain count (tone "none") when no target is set. */
export function memberLoadOf(
  open: number,
  dailyTarget: number | null | undefined,
): MemberLoad {
  if (dailyTarget != null && dailyTarget > 0) {
    const ratio = open / dailyTarget;
    const tone: MemberLoadTone =
      ratio >= 1 ? "full" : ratio >= 0.75 ? "warn" : "ok";
    return { text: `${open} / ${dailyTarget}`, ratio, tone };
  }
  return { text: `${open} open`, ratio: null, tone: "none" };
}

// ─── Coverage-aware assignment suggestions ──────────────────────────
//
// The manual assignment picker highlights/sorts members who can serve a
// case's facility — first the member whose roster facility matches ("home"),
// then members who explicitly cover it via facilitiesCovered ("covers"). This
// lets a manager benefit from coverage routing data even when commit-time
// auto-assign is OFF. Falls back cleanly (everyone "none") when no facility is
// known or no coverage is configured.

export type CoverageRelation = "home" | "covers" | "none";

function normFacility(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** How a team member relates to a case's facility. */
export function coverageRelation(
  s: SchedulerOption,
  facility: string | null | undefined,
): CoverageRelation {
  const target = normFacility(facility);
  if (!target) return "none";
  if (normFacility(s.facility) === target) return "home";
  if ((s.facilitiesCovered ?? []).some((f) => normFacility(f) === target))
    return "covers";
  return "none";
}

const COVERAGE_RANK: Record<CoverageRelation, number> = {
  home: 0,
  covers: 1,
  none: 2,
};

/** Sort schedulers so the case's facility "home" member comes first, then
 *  coverage members, then everyone else — alphabetical within each tier. When
 *  no facility is supplied the order is plain alphabetical (no regression). */
export function sortSchedulersByCoverage(
  schedulers: SchedulerOption[],
  facility: string | null | undefined,
): SchedulerOption[] {
  return [...schedulers].sort((a, b) => {
    const ra = COVERAGE_RANK[coverageRelation(a, facility)];
    const rb = COVERAGE_RANK[coverageRelation(b, facility)];
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

/** The single facility shared by every selected row, or null when the
 *  selection spans multiple (or zero) facilities — used to decide whether a
 *  bulk picker can show coverage suggestions. */
export function commonFacility(
  facilities: Array<string | null | undefined>,
): string | null {
  const distinct = new Set(
    facilities.map((f) => (f ?? "").trim()).filter((f) => f.length > 0),
  );
  return distinct.size === 1 ? Array.from(distinct)[0] : null;
}

export type AssignedRole =
  | "scheduler"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

export const ROLE_LABELS: Record<AssignedRole, string> = {
  scheduler: "Scheduler",
  patientCareSpecialist: "Patient Care Specialist",
  ancillaryCareSpecialist: "Ancillary Care Specialist",
};

// ─── Smart filters (left rail) ──────────────────────────────────────

export type SmartFilterKey =
  | "all"
  // Assignment state (baskets folded in)
  | "ready_to_assign"
  | "assigned"
  // Call type (server-derived taxonomy)
  | "visit_scheduling"
  | "outreach_scheduling"
  | "repeat_test_due"
  // Due windows
  | "due_today"
  | "overdue"
  | "due_soon"
  // Work state
  | "follow_up"
  | "callbacks"
  | "no_answer"
  | "left_voicemail"
  | "needs_scheduling"
  | "blocked"
  | "declined"
  | "re_eligible";

export type SmartFilterGroup = "state" | "call_type" | "due" | "work";

export const SMART_FILTER_GROUP_LABELS: Record<SmartFilterGroup, string> = {
  state: "Assignment",
  call_type: "Call Type",
  due: "Due Window",
  work: "Work State",
};

export const SMART_FILTER_GROUP_ORDER: SmartFilterGroup[] = [
  "state",
  "call_type",
  "due",
  "work",
];

export const SMART_FILTERS: Array<{
  key: SmartFilterKey;
  label: string;
  group?: SmartFilterGroup;
}> = [
  { key: "all", label: "All cases" },
  { key: "ready_to_assign", label: "Ready to Assign", group: "state" },
  { key: "assigned", label: "Assigned", group: "state" },
  { key: "visit_scheduling", label: "Visit Scheduling", group: "call_type" },
  { key: "outreach_scheduling", label: "Outreach Scheduling", group: "call_type" },
  { key: "repeat_test_due", label: "Repeat Test Due", group: "call_type" },
  { key: "due_today", label: "Due Today", group: "due" },
  { key: "overdue", label: "Overdue", group: "due" },
  { key: "due_soon", label: "Due Soon", group: "due" },
  { key: "follow_up", label: "Follow-up", group: "work" },
  { key: "callbacks", label: "Callbacks", group: "work" },
  { key: "no_answer", label: "No Answer", group: "work" },
  { key: "left_voicemail", label: "Left Voicemail", group: "work" },
  { key: "needs_scheduling", label: "Needs Scheduling", group: "work" },
  { key: "blocked", label: "Blocked", group: "work" },
  { key: "declined", label: "Declined", group: "work" },
  { key: "re_eligible", label: "Re-Eligible", group: "work" },
];

// ─── Date / due-bucket helpers ──────────────────────────────────────

export type DueBucket = "overdue" | "today" | "tomorrow" | "this_week" | "later";

export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "this_week",
  "later",
];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This Week",
  later: "Later",
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dueBucketOf(iso: string | null): DueBucket {
  if (!iso) return "later";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "later";
  const todayStart = startOfTodayMs();
  const dayMs = 86_400_000;
  const todayEnd = todayStart + dayMs;
  const tomorrowEnd = todayEnd + dayMs;
  const weekEnd = todayStart + dayMs * 7;
  if (t < todayStart) return "overdue";
  if (t < todayEnd) return "today";
  if (t < tomorrowEnd) return "tomorrow";
  if (t < weekEnd) return "this_week";
  return "later";
}

export function dueLabel(iso: string | null): string {
  if (!iso) return "No due date";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "No due date";
  const bucket = dueBucketOf(iso);
  if (bucket === "overdue") {
    const days = Math.max(1, Math.round((startOfTodayMs() - t) / 86_400_000));
    return days <= 1 ? "Overdue" : `Overdue ${days}d`;
  }
  if (bucket === "today") return "Due today";
  if (bucket === "tomorrow") return "Due tomorrow";
  return `Due ${new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "just now";
  const m = Math.round(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// ─── Derived display fields ─────────────────────────────────────────

export function callReasonOf(row: BoardRow): string {
  const bucket = (row.engagementBucket ?? "").toLowerCase();
  if (bucket === "outreach") return "Outreach call";
  if (bucket === "scheduling_triage") return "Scheduling triage";
  if (bucket === "visit") return "Visit follow-up";
  if (row.patientType) return `${row.patientType} follow-up`;
  return "Engagement call";
}

export function targetTestOf(row: BoardRow): { primary: string | null; extra: number } {
  const s = row.selectedServices ?? [];
  if (s.length === 0) return { primary: null, extra: 0 };
  return { primary: s[0], extra: s.length - 1 };
}

export type Priority = "high" | "medium" | "normal";

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  normal: "Normal",
};

// Priority is DERIVED (read-only) from due proximity + missing info.
// The existing assign endpoint + board contract carry no priority
// column, and this task forbids new endpoints / schema / contract
// changes, so the UI surfaces priority but does not persist a setter.
export function priorityOf(row: BoardRow): Priority {
  const bucket = dueBucketOf(row.nextActionAt);
  if (bucket === "overdue") return "high";
  if (bucket === "today") return "medium";
  if (row.missingInfo?.length) return "medium";
  return "normal";
}

export function matchesSmartFilter(row: BoardRow, key: SmartFilterKey): boolean {
  const status = (row.engagementStatus ?? "").toLowerCase();
  const summary = (row.lastActivitySummary ?? "").toLowerCase();
  const both = `${status} ${summary}`;
  const bucket = dueBucketOf(row.nextActionAt);
  switch (key) {
    case "all":
      return true;
    case "ready_to_assign":
      return row.assignedTeamMemberId == null;
    case "assigned":
      return row.assignedTeamMemberId != null;
    case "visit_scheduling":
      return row.callType === "Visit Patient Scheduling";
    case "outreach_scheduling":
      return row.callType === "Outreach Patient Scheduling";
    case "repeat_test_due":
      return row.callType === "Repeat Test Due";
    case "due_today":
      return bucket === "today";
    case "overdue":
      return bucket === "overdue";
    case "due_soon":
      return bucket === "tomorrow" || bucket === "this_week";
    case "follow_up":
      return /follow/.test(both);
    case "callbacks":
      return /call ?back/.test(both);
    case "no_answer":
      return /no[ _-]?answer|unreachable|did not answer/.test(both);
    case "left_voicemail":
      return /voicemail|left (a )?message|\bvm\b/.test(both);
    case "needs_scheduling":
      return (
        (row.engagementBucket ?? "").toLowerCase() === "scheduling_triage" ||
        /needs? schedul|to schedule|unscheduled/.test(both)
      );
    case "blocked":
      return (row.missingInfo?.length ?? 0) > 0;
    case "declined":
      return /declin/.test(both);
    case "re_eligible":
      return /re[- _]?elig|eligible again|re-?qualif/.test(both);
    default:
      return true;
  }
}

export function countBySmartFilter(
  rows: BoardRow[],
): Record<SmartFilterKey, number> {
  const out = {} as Record<SmartFilterKey, number>;
  for (const { key } of SMART_FILTERS) out[key] = 0;
  for (const row of rows) {
    for (const { key } of SMART_FILTERS) {
      if (matchesSmartFilter(row, key)) out[key] += 1;
    }
  }
  return out;
}

// ─── Cooldown (defensive shape parsing) ─────────────────────────────

export function cooldownNames(c: unknown): string[] {
  if (!c) return [];
  if (Array.isArray(c)) {
    return c
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const obj = x as Record<string, unknown>;
          return (
            (obj.test as string) ??
            (obj.name as string) ??
            (obj.testName as string) ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean) as string[];
  }
  if (typeof c === "object") return Object.keys(c as Record<string, unknown>);
  return [];
}

// ─── Single-patient PDF packet (reuses existing print-preview lib) ──

export async function openSinglePatientPacket(
  patientScreeningId: number,
  patientName: string,
  scheduleDate: string | null,
  mode: "plexus" | "clinician",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/patients/${patientScreeningId}`, {
      credentials: "include",
    });
    if (!res.ok) {
      return { ok: false, error: `Could not load patient (HTTP ${res.status}).` };
    }
    const patient = (await res.json()) as PatientScreening;
    const result = openPatientPacketPrintPreview({
      mode,
      batchName: `${patient.facility ?? "Patient"} · ${patientName}`,
      patients: [patient],
      scheduleDate,
      createdAt: null,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: "Popup blocked. Allow popups to print this packet.",
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown PDF error.",
    };
  }
}

// Combined packet for a multi-patient selection. Patients are fetched
// then grouped by facility|schedule-date into one stacked print-preview
// popup (parity with the prior grouped-packet workflow). Reuses the
// existing scheduler-packet print-preview lib — no new endpoints.
export type BulkPacketRef = {
  patientScreeningId: number | null;
  patientName: string;
  facility: string | null;
  scheduleDate: string | null;
};

export async function openBulkPatientPackets(
  refs: BulkPacketRef[],
  mode: "plexus" | "clinician",
): Promise<
  | { ok: true; rendered: number; dropped: string[] }
  | { ok: false; error: string }
> {
  const withId = refs.filter((r) => r.patientScreeningId != null);
  if (withId.length === 0) {
    return { ok: false, error: "No selected patients are linked to a screening." };
  }
  try {
    const fetched = await Promise.all(
      withId.map(async (r) => {
        const res = await fetch(`/api/patients/${r.patientScreeningId}`, {
          credentials: "include",
        });
        if (!res.ok) return null;
        return { ref: r, patient: (await res.json()) as PatientScreening };
      }),
    );
    const loaded = fetched.filter(
      (x): x is { ref: BulkPacketRef; patient: PatientScreening } => x !== null,
    );
    if (loaded.length === 0) {
      return { ok: false, error: "Could not load the selected patients." };
    }
    const groupMap = new Map<
      string,
      { label: string; patients: PatientScreening[]; scheduleDate: string | null }
    >();
    for (const { ref, patient } of loaded) {
      const facility = ref.facility ?? patient.facility ?? "Unassigned";
      const date = ref.scheduleDate ?? null;
      const key = `${facility}|${date ?? "no-date"}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          label: `${facility}${date ? ` · ${date}` : ""}`,
          patients: [],
          scheduleDate: date,
        });
      }
      groupMap.get(key)!.patients.push(patient);
    }
    const result = openSchedulerPacketPrintPreview({
      mode,
      schedulerName: "Engagement selection",
      groups: Array.from(groupMap.values()),
      createdAt: null,
    });
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "popup-blocked"
            ? "Popup blocked. Allow popups to print this packet."
            : "No packets to render for this selection.",
      };
    }
    return {
      ok: true,
      rendered: result.renderedGroupCount,
      dropped: result.droppedGroups,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown PDF error.",
    };
  }
}

// ─── Journey timeline (shared by case panel + baskets slide-over) ───
//
// One journey event as returned by
// GET /api/engagement/assignment-board/cases/:executionCaseId/journey.

export type JourneyEvent = {
  id: number;
  eventType: string;
  eventSource: string;
  summary: string;
  actorName: string | null;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
};

// Dot colour per event-type family — calls vs. assignments vs. docs/billing
// vs. lifecycle — so the timeline reads at a glance.
export const JOURNEY_EVENT_TONE: Record<string, string> = {
  call_result_logged: "bg-indigo-500",
  engagement_assigned: "bg-emerald-500",
  engagement_assignment_changed: "bg-emerald-500",
  scheduler_assigned: "bg-emerald-500",
  engagement_assignment_cancelled: "bg-rose-500",
  schedule_cancelled: "bg-rose-500",
  schedule_no_show: "bg-rose-500",
  scheduled_ancillary: "bg-sky-500",
  schedule_rescheduled: "bg-amber-500",
  schedule_confirmed: "bg-emerald-500",
  screening_committed: "bg-violet-500",
  execution_case_created: "bg-violet-500",
  execution_case_updated: "bg-slate-400",
  task_created: "bg-amber-500",
  document_sent: "bg-cyan-500",
  document_completed: "bg-cyan-500",
  billing_payment_updated: "bg-teal-500",
  added_to_invoice: "bg-teal-500",
  note_added: "bg-amber-400",
};

// Human label for a journey event-type. Falls back to a humanized form of
// any unknown kind (the column is plain text and may grow new kinds).
export function journeyEventLabel(eventType: string): string {
  const LABELS: Record<string, string> = {
    call_result_logged: "Call outcome",
    engagement_assigned: "Assigned",
    engagement_assignment_changed: "Reassigned",
    engagement_assignment_cancelled: "Assignment cancelled",
    scheduler_assigned: "Scheduler assigned",
    scheduled_ancillary: "Scheduled",
    schedule_cancelled: "Cancelled",
    schedule_rescheduled: "Rescheduled",
    schedule_no_show: "No show",
    schedule_confirmed: "Confirmed",
    screening_committed: "Committed",
    execution_case_created: "Case opened",
    execution_case_updated: "Case updated",
    task_created: "Task created",
    document_sent: "Document sent",
    document_completed: "Document completed",
    billing_payment_updated: "Payment updated",
    added_to_invoice: "Added to invoice",
    note_added: "Note",
  };
  return (
    LABELS[eventType] ??
    eventType
      .replace(/_/g, " ")
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}
