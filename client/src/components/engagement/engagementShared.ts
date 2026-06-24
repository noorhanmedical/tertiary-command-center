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
};

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
  | "ready_to_assign"
  | "due_today"
  | "overdue"
  | "due_soon"
  | "follow_up"
  | "callbacks"
  | "no_answer"
  | "left_voicemail"
  | "needs_scheduling"
  | "missing_pdf"
  | "blocked"
  | "declined"
  | "re_eligible";

export const SMART_FILTERS: Array<{ key: SmartFilterKey; label: string }> = [
  { key: "all", label: "All cases" },
  { key: "ready_to_assign", label: "Ready to Assign" },
  { key: "due_today", label: "Due Today" },
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due Soon" },
  { key: "follow_up", label: "Follow-up" },
  { key: "callbacks", label: "Callbacks" },
  { key: "no_answer", label: "No Answer" },
  { key: "left_voicemail", label: "Left Voicemail" },
  { key: "needs_scheduling", label: "Needs Scheduling" },
  { key: "missing_pdf", label: "Missing PDF" },
  { key: "blocked", label: "Blocked" },
  { key: "declined", label: "Declined" },
  { key: "re_eligible", label: "Re-Eligible" },
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
    case "missing_pdf":
      return (row.selectedServices?.length ?? 0) === 0;
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
