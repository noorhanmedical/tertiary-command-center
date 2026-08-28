import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEngagementActivityStream } from "@/hooks/useEngagementActivityStream";
import {
  Stethoscope, HeartHandshake, Calendar as CalendarIcon, CalendarPlus, Phone, FileSignature,
  Upload, FileText, ChevronLeft, ChevronRight, Check, AlertCircle, ClipboardList,
  Sparkles, Send, Minimize2, Maximize2, FileBarChart, FilePlus, User, Bell, Bot,
  Home, BookOpen, CalendarDays, Mail, ClipboardPen, Pill, History, ShieldCheck, Users, Search, Megaphone,
  NotebookPen, ChevronDown, Wrench, PhoneCall, Pin, PinOff, Landmark,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SignaturePad } from "./SignaturePad";
import PortalWorkflowPanel from "@/components/workflow/PortalWorkflowPanel";
import { ProcedureCompleteButton } from "@/components/patient/ProcedureCompleteButton";
import { AncillaryReadinessRow } from "@/components/portal/AncillaryReadinessRow";
import type { AncillaryServiceContext } from "@/components/portal/AncillaryDocModals";
import { QualifyingEvidence } from "@/components/patient-directory/PatientChartSections";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import type { EmrQualifyingTest } from "@/types/emr";
import {
  WorkspaceModeSwitcher,
  type TeamMemberWorkspaceMode,
} from "@/components/portal/WorkspaceModeSwitcher";
// Phase 2I — real production work-queue composition (sticky mode-switcher header
// + flag-gated canonical lifecycle section in the scrollable body + existing mode
// body). The canonical section renders nothing / zero requests when OFF.
import { WorkspaceWorkQueueComposition } from "@/components/careSpecialist/WorkspaceWorkQueueComposition";
import { CanonicalLifecycleSection } from "@/components/careSpecialist/CanonicalLifecycleSection";
import {
  fetchWorkspaceCallList,
  fetchWorkspaceClinicSchedule,
  fetchWorkspaceAncillarySchedule,
  fetchTeamMembersForWorkspace,
  deriveCallReason,
  type ViewAsTeamMember,
  type ViewAsWorkspaceType,
  type TeamWorkspaceCallListItem,
  type TeamWorkspaceAncillaryAppointment,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import { fetchTeamMemberProfile } from "@/lib/workflow/teamMemberProfileApi";
import { useLocation } from "wouter";
// Left-rail tool components — shared between PCS + ACS (identical
// shell + layout).
import { CallsRepositoryPanel } from "@/components/portal/CallsRepositoryPanel";
import { PortalEmailComposerTab } from "@/components/portal/PortalEmailComposerTab";
import { PortalTemplatesResourcesTab } from "@/components/portal/PortalTemplatesResourcesTab";
import { PortalDocumentLibraryTab } from "@/components/portal/PortalDocumentLibraryTab";
import { QuickNoteTool } from "@/components/portal/QuickNoteTool";
import { InternalContactsTool } from "@/components/portal/InternalContactsTool";
import InvoiceDeskPanel from "@/components/portal/InvoiceDeskPanel";
import {
  SchedulePatientDialog,
  type SchedulePatientDialogPatient,
} from "@/components/portal/SchedulePatientDialog";
import { CalendarQuickScheduleDialog } from "@/components/portal/CalendarQuickScheduleDialog";
import { DispositionSheet } from "@/components/outreach/DispositionSheet";
import { CallRowQuickActions } from "@/components/portal/CallRowQuickActions";
import {
  CompactCallRow,
  CompactClinicRow,
  CompactAncillaryRow,
} from "@/components/portal/CompactCallRow";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";
import { CallWorkspace } from "@/components/portal/CallWorkspace";
import { SchedulingWorkspace } from "@/components/portal/SchedulingWorkspace";
import { SelectedCaseOverview } from "@/components/portal/SelectedCaseOverview";
import { SchedulePatientPlayground } from "@/components/portal/SchedulePatientPlayground";
import { PatientMiniCalendar } from "@/components/portal/PatientMiniCalendar";
import { PortalPatientDirectory } from "@/components/portal/PortalPatientDirectory";
import { PortalMyPatientsTab } from "@/components/portal/PortalMyPatientsTab";
import { PortalPatientSearchTab } from "@/components/portal/PortalPatientSearchTab";
import { PortalMarketingTab } from "@/components/portal/PortalMarketingTab";
import { PortalPlexusTasksTab } from "@/components/portal/PortalPlexusTasksTab";
import { CanonicalCommandCalendar } from "@/components/calendar/CanonicalCommandCalendar";
import { resolvePortalCapabilities } from "@/lib/portal/portalCapabilities";
import { type CanonicalMonthCellSummary } from "@/calendar";
// Task #643 — upgraded Tools workspace: launcher dock, communication
// tray, Playground floating widgets + drag-and-drop, and in-session
// workspace settings.
import { ToolDock, type DockTool, type DockGroup } from "@/components/portal/tools/ToolDock";
import { LeftRailCompactCalendar } from "@/components/portal/leftRail/LeftRailCompactCalendar";
import { CommunicationTray } from "@/components/portal/tools/CommunicationTray";
import { WorkspaceSettingsDialog } from "@/components/portal/tools/WorkspaceSettingsDialog";
import { useWorkspacePrefs, DEFAULT_WORKSPACE_PREFS, type TrayTab } from "@/components/portal/tools/workspacePrefs";
import {
  useWorkspaceWidgets,
  PlaygroundWidgetLayer,
  WIDGET_DND_MIME,
  type PlaygroundWidgetType,
  type WidgetPatientContext,
} from "@/components/portal/tools/workspaceWidgets";
import { MessageSquare, StickyNote, Settings as SettingsIcon, MessageCircle } from "lucide-react";
import { GlobalDock } from "@/components/dock/GlobalDock";
import type { DockAppDefinition } from "@/components/dock/types";
import { DockOwnershipProvider } from "@/components/dock/DockOwnershipContext";
import { PlaygroundWorkspaceProvider } from "@/components/playground";
import { PlaygroundBridge } from "@/components/playground/PlaygroundBridge";
import { PlaygroundEventListener } from "@/components/playground/PlaygroundEventListener";
import { SketchSelect } from "@/components/playground/sketch/SketchSelect";
import { SketchButton, SketchBadge } from "@/components/playground/sketch/SketchPrimitives";
import { SKETCH_COLORS } from "@/components/playground/sketch/sketchTokens";
import { dispatchOpenWorkspace } from "@/components/playground/playgroundEvents";
import { MetricsPopup } from "@/components/dock/popups/MetricsPopup";
import { NovaQuickPanel } from "@/components/nova/NovaQuickPanel";
import { PortalMessagesPanel } from "@/components/portal/messaging/PortalMessagesPanel";
import { PortalMessagesWindow } from "@/components/portal/messaging/PortalMessagesWindow";
import { useTeamMessages } from "@/components/portal/messaging/teamMessagesApi";

// The user-facing workspace role lets us distinguish PCS vs ACS for
// capability gating (procedure-side actions are ACS-only). Legacy
// direct mounts (technician / liaison) pass through unchanged via
// the compatibility classifier on `workspaceIsAncillaryCareSpecialist`
// below. New code should reference the public role names
// (patientCareSpecialist / ancillaryCareSpecialist).
type PublicWorkspaceRole =
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

// Compatibility alias — the public role plus the two legacy strings
// still accepted by historical callers. The legacy names are
// translated through `INTERNAL_ROLE` in
// `client/src/components/workflow/ClinicWorkflowPortal.tsx`.
type WorkspaceRole =
  | PublicWorkspaceRole
  | "technician"
  | "liaison";

// Internal-only role split. Kept for legacy back-compat in the
// PortalShell `role` prop (used by Plexus IQ-era direct mounts).
// New code should NOT extend this; use `WorkspaceRole` /
// `PublicWorkspaceRole` and let the capability resolver drive gating.
type Role = "technician" | "liaison";
type CenterMode = "playground" | "patient" | "scheduleDay" | "plexusPdf" | "clinicianPdf" | "consent" | "patientChart" | "calendar" | "chat";

// A same-patient visit block on the Ancillary Schedule (Phase 1). `events`
// preserves the underlying canonical service instances (each with its own
// executionCaseId / readiness) — grouping is presentation only.
type AncillaryVisitGroup = {
  key: string;
  patientName: string;
  /** Earliest start time (ms) in the block; null when all events are undated. */
  anchorMs: number | null;
  events: TeamWorkspaceAncillaryAppointment[];
};

type PortalTask = {
  id: number;
  title: string;
  description: string | null;
  taskType: string;
  urgency: string;
  patientScreeningId: number | null;
  dueDate: string | null;
  status: string;
};

type ConsentByTest = { testType: string; signed: boolean; documentId: number | null };

type TodayPatient = {
  patientScreeningId: number | null;
  name: string;
  dob: string | null;
  time: string | null;
  facility: string;
  clinicianName: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  consentByTest: ConsentByTest[];
  consentSigned: boolean;
  appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
  batchId: number | null;
  plexusPdfUrl: string | null;
  clinicianPdfUrl: string | null;
  scheduleUrl: string | null;
};

type PortalTabKind =
  | "patient"
  | "schedule"
  | "tasks"
  | "documents"
  | "myPatients"
  | "patientSearch"
  | "plexusTasks"
  | "marketing"
  // Left-rail Email tool → center-canvas composer.
  | "email"
  // Left-rail Templates / Staff Resources tool → center-canvas
  // resources catalog. Patient-facing brochures live in
  // "marketing"; staff-facing helpers live in "resources".
  | "resources"
  // Left-rail Document Library tool → center-canvas read-only
  // browse over the canonical /api/documents-library. Separate from
  // patient-facing marketing materials.
  | "documentLibrary"
  // Phase 2 PR 2.6 — Quick Note tool. Writes through canonical
  // /api/patient-notes.
  | "quickNote"
  // Phase 2 PR 2.7 — Internal Contacts tool. Reads from canonical
  // /api/contacts.
  | "internalContacts"
  // Tabbed call-list Playground workflows — each call-row action opens its
  // own tab that stays open alongside the others.
  | "call"
  | "caseSchedule"
  | "caseOverview"
  // Left-rail Calls tool → center-canvas Calls Repository (worked-call
  // archive + recall + manual add-to-call-list). Steps 6 & 7.
  | "calls"
  // Task #699 — restricted Invoice Desk over the Plexus Bank mock store
  // (create/send/resend/status/contact-note only).
  | "invoiceDesk";
type PortalTab = {
  id: string;
  kind: PortalTabKind;
  patientId?: number | null;
  patientName?: string;
  label: string;
  /** Carried by call/caseSchedule/caseOverview tabs so the center can
   *  render the Call / Schedule / Case workspaces without re-deriving. */
  caseContext?: CallCaseContext;
};

// The hardcoded demo-patient injection was removed during Phase 1
// Slice 1.1. The workspace now reads exclusively from
// `/api/portal/today` + the canonical workspace feeds. See
// docs/architecture/actual-care-tech-portals-phase-1-audit.md.

type LibraryDoc = {
  id: number;
  title: string;
  description: string | null;
  filename: string;
  contentType: string;
};

type PatientDoc = {
  id: number;
  title: string;
  kind: string;
  filename: string;
  contentType: string;
  createdAt: string;
  sourceNotes: string | null;
  downloadUrl: string;
};

type OutreachItem = {
  patientScreeningId: number;
  name: string;
  phoneNumber: string | null;
  insurance: string | null;
  qualifyingTests: string[];
  facility: string;
  appointmentStatus: string;
};

const POLL_MS = 30_000;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Shift a YYYY-MM-DD operational date by N days using LOCAL calendar math
// (no UTC parsing) so "yesterday/tomorrow" always land on the intended
// facility-local operational day and never slip across a UTC boundary.
function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Compact, human label for the right-rail date navigator. "Today" /
// "Yesterday" / "Tomorrow" relative to the local operational day, else the
// ISO date. Keeps the rail compact while making the selected day obvious.
function relativeDateLabel(iso: string): string {
  const today = todayIso();
  if (iso === today) return "Today";
  if (iso === shiftIsoDate(today, -1)) return "Yesterday";
  if (iso === shiftIsoDate(today, 1)) return "Tomorrow";
  return iso;
}

// Canonical Plexus IQ category → dot color (reuses the existing ancillary
// color language: brainwave = violet, vitalwave = rose, ultrasound = emerald).
// NOT a new color meaning — mirrors client/src/features/schedule/ancillaryMeta.
function qualificationDotClass(category: string): string {
  switch (category) {
    case "brainwave":
      return "bg-violet-500";
    case "vitalwave":
      return "bg-rose-500";
    case "ultrasound":
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}

// Map a qualifying-test name + the patient's stored reasoning into the
// EmrQualifyingTest shape QualifyingEvidence consumes. Mirrors emrModel.ts;
// no recompute — reads canonical stored evidence only.
function toClinicQualifyingTest(
  serviceName: string,
  reasoning: Record<string, unknown> | null | undefined,
): EmrQualifyingTest {
  const r = (reasoning?.[serviceName] ?? null) as Record<string, unknown> | null;
  const cat = getAncillaryCategory(serviceName);
  const bucket: EmrQualifyingTest["bucket"] =
    cat === "brainwave" || cat === "vitalwave" || cat === "ultrasound" ? cat : "ultrasound";
  const arr = (v: unknown): string[] | null => (Array.isArray(v) ? (v as string[]) : null);
  return {
    testName: serviceName,
    bucket,
    clinicianUnderstanding: (r?.clinician_understanding as string) ?? null,
    patientTalkingPoints: (r?.patient_talking_points as string) ?? null,
    confidence: (r?.confidence as string) ?? null,
    qualifyingFactors: arr(r?.qualifying_factors),
    icd10Codes: arr(r?.icd10_codes),
    pearls: arr(r?.pearls),
    approvalRequired: typeof r?.approvalRequired === "boolean" ? (r.approvalRequired as boolean) : null,
  };
}

// Clinic-schedule qualification dots: one colored dot per qualifying service
// (category color), clicking opens a popup with the stored Plexus IQ evidence
// for THAT service. Reasoning is fetched lazily (only when the popup opens)
// from the canonical /api/patients/:id read, so the row stays cheap.
function ClinicQualificationDots({
  patientScreeningId,
  qualifyingTests,
}: {
  patientScreeningId: number | null;
  qualifyingTests: string[];
}) {
  const [openTest, setOpenTest] = useState<string | null>(null);
  const { data: screening } = useQuery<{
    diagnoses: string | null;
    medications: string | null;
    reasoning: Record<string, unknown> | null;
  } | null>({
    queryKey: ["/api/patients", patientScreeningId, "clinic-qual-evidence"],
    queryFn: async () => {
      if (patientScreeningId == null) return null;
      const res = await fetch(`/api/patients/${patientScreeningId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: patientScreeningId != null && openTest != null,
    staleTime: 30_000,
  });

  const tests = (qualifyingTests ?? []).filter(Boolean);
  if (tests.length === 0) return null;

  const splitList = (s: string | null | undefined): string[] =>
    s ? s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) : [];

  return (
    <div className="mt-1 flex items-center gap-1" data-testid={`clinic-qual-dots-${patientScreeningId ?? "x"}`}>
      {tests.slice(0, 8).map((t) => {
        const cat = getAncillaryCategory(t);
        return (
          <button
            key={t}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenTest(t);
            }}
            className={`h-2.5 w-2.5 rounded-full ${qualificationDotClass(cat)} ring-1 ring-white/70 transition-transform hover:scale-125`}
            title={`${t} — why qualified`}
            aria-label={`${t} qualification`}
            data-testid={`clinic-qual-dot-${patientScreeningId ?? "x"}-${t}`}
          />
        );
      })}
      <Dialog open={openTest != null} onOpenChange={(o) => !o && setOpenTest(null)}>
        <DialogContent className="max-w-lg z-[95]" data-testid="clinic-qual-evidence-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className={`h-3 w-3 rounded-full ${qualificationDotClass(getAncillaryCategory(openTest ?? ""))}`} />
              {openTest}
            </DialogTitle>
          </DialogHeader>
          {openTest && (
            <QualifyingEvidence
              test={toClinicQualifyingTest(openTest, screening?.reasoning)}
              diagnoses={splitList(screening?.diagnoses)}
              medications={splitList(screening?.medications)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatTime(t: string | null) {
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const mm = m[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${period}`;
}

// Persist a boolean UI preference (e.g. a side-rail collapsed state) to
// localStorage, keyed per user/role. The key is allowed to be null while
// the logged-in user is still loading; persistence kicks in once a stable
// key is available. The first hydration for a given key never writes back
// to storage, so the stored preference is never clobbered by the default.
function usePersistedBool(storageKey: string | null, defaultValue: boolean) {
  const [value, setValue] = useState<boolean>(defaultValue);
  const skipPersistRef = useRef(false);
  useEffect(() => {
    if (!storageKey) return;
    skipPersistRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      setValue(raw !== null ? raw === "true" : defaultValue);
    } catch {
      setValue(defaultValue);
    }
    // defaultValue intentionally omitted — it is a stable literal here and
    // re-hydration should only follow key changes, not default churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

// Like usePersistedBool but for a small string enum (e.g. rail size). Same
// null-key / first-hydration-doesn't-clobber contract.
function usePersistedString<T extends string>(
  storageKey: string | null,
  defaultValue: T,
  allowed: readonly T[],
) {
  const [value, setValue] = useState<T>(defaultValue);
  const skipPersistRef = useRef(false);
  useEffect(() => {
    if (!storageKey) return;
    skipPersistRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      setValue(raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue);
    } catch {
      setValue(defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

// Side-rail size control, persisted per user/role alongside the collapsed state.
// Two sizes only. The LEFT rail "small" is a compact ICON rail (labels hidden,
// single column); the RIGHT rail "small" is just a thinner panel. "normal" is
// the full-width panel for both. Clicking away from an open rail collapses it.
type RailSize = "small" | "normal";
const RAIL_SIZES: readonly RailSize[] = ["small", "normal"];
const LEFT_RAIL_WIDTH: Record<RailSize, string> = {
  small: "w-[84px]",
  normal: "w-[320px]",
};
const RIGHT_RAIL_WIDTH: Record<RailSize, string> = {
  small: "w-[220px]",
  normal: "w-[340px]",
};

function MonthlyMiniCalendar({ facility, selectedDate, onSelect }: { facility: string; selectedDate: string; onSelect: (d: string) => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selectedDate);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const monthIso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const { data } = useQuery<{ days: { date: string; appointmentCount: number }[] }>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });
  const counts = new Map<string, number>();
  for (const d of data?.days ?? []) counts.set(d.date, d.appointmentCount);
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = first.getDay();
  const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: Array<{ date: string | null; count: number }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, count: 0 });
  for (let day = 1; day <= lastDate; day++) {
    const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date: ds, count: counts.get(ds) ?? 0 });
  }
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString("default", { month: "long", year: "numeric" });
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))} className="p-1 hover:bg-slate-100 rounded" data-testid="button-cal-prev">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold" data-testid="text-cal-month">{monthLabel}</span>
        <button onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))} className="p-1 hover:bg-slate-100 rounded" data-testid="button-cal-next">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-slate-400 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => (
          <button
            key={i}
            disabled={!c.date}
            onClick={() => c.date && onSelect(c.date)}
            className={`aspect-square flex flex-col items-center justify-center rounded text-xs ${
              !c.date ? "" : c.date === selectedDate ? "bg-indigo-600 text-white" : c.count > 0 ? "bg-indigo-50 text-indigo-900 hover:bg-indigo-100" : "hover:bg-slate-100"
            }`}
            data-testid={c.date ? `cal-day-${c.date}` : undefined}
          >
            {c.date && <span>{parseInt(c.date.slice(-2), 10)}</span>}
            {c.date && c.count > 0 && <span className="text-[8px] opacity-80">{c.count}</span>}
          </button>
        ))}
      </div>
    </Card>
  );
}

function ConsentDialog({
  patient,
  testType,
  open,
  onOpenChange,
  role,
}: {
  patient: TodayPatient;
  testType: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: Role;
}) {
  const { toast } = useToast();
  const [signature, setSignature] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("");

  const { data: templates } = useQuery<LibraryDoc[]>({
    queryKey: ["/api/portal/consent-templates", testType ?? ""],
    queryFn: async () => {
      const u = new URL("/api/portal/consent-templates", window.location.origin);
      if (testType) u.searchParams.set("testType", testType);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    enabled: open,
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!signature || !templateId) throw new Error("Missing signature or template");
      const res = await apiRequest("POST", "/api/portal/sign-consent", {
        patientScreeningId: patient.patientScreeningId,
        templateDocumentId: parseInt(templateId, 10),
        signatureDataUrl: signature,
        signedBy: "patient",
        testType: testType ?? "",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Consent signed", description: `${patient.name} consent saved to chart.` });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/today-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patient.patientScreeningId] });
      onOpenChange(false);
      setSignature(null);
      setTemplateId("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to sign consent", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-consent">
        <DialogHeader>
          <DialogTitle>Consent — {patient.name}{testType ? ` · ${testType}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Consent template{testType ? ` (filtered by ${testType})` : ""}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="select-consent-template">
                <SelectValue placeholder={(templates ?? []).length === 0 ? "No matching templates available" : "Choose a consent template"} />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} data-testid={`option-template-${t.id}`}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Patient signature</Label>
            <SignaturePad onCapture={setSignature} />
            {signature && <div className="text-xs text-emerald-700 mt-1">✓ Signature captured</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-consent-cancel">Cancel</Button>
          <Button
            onClick={() => signMutation.mutate()}
            disabled={!signature || !templateId || signMutation.isPending || patient.patientScreeningId == null}
            data-testid="button-consent-submit"
          >
            {signMutation.isPending ? "Saving…" : "Sign & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PatientUploadCard({ patient }: { patient: TodayPatient }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");
  const [busy, setBusy] = useState(false);

  async function onUpload() {
    if (!file || patient.patientScreeningId == null) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientScreeningId", String(patient.patientScreeningId));
      fd.append("title", title || file.name);
      fd.append("kind", kind);
      const res = await fetch("/api/portal/uploads", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      toast({ title: "Uploaded", description: file.name });
      setFile(null);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patient.patientScreeningId] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-upload-file" />
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-upload-title" />
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger data-testid="select-upload-kind"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="informed_consent">Informed consent</SelectItem>
          <SelectItem value="screening_form">Screening form</SelectItem>
          <SelectItem value="report">Report</SelectItem>
          <SelectItem value="reference">Reference</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={onUpload} disabled={!file || busy || patient.patientScreeningId == null} className="w-full" data-testid="button-upload-submit">
        <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload to chart"}
      </Button>
    </div>
  );
}

// Compact patient-scoped upload card rendered in the LEFT RAIL when a patient
// is selected. Mirrors PatientUploadCard but with header + density tuned for
// the rail. Per spec, the upload affordance lives in the left tools rail —
// not in the center patient tabs — so it is reachable without opening the
// patient chart.
function LeftRailUpload({ patientScreeningId, patientName }: { patientScreeningId: number; patientName: string }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("other");
  const [busy, setBusy] = useState(false);
  async function onUpload() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientScreeningId", String(patientScreeningId));
      fd.append("title", file.name);
      fd.append("kind", kind);
      const res = await fetch("/api/portal/uploads", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      toast({ title: "Uploaded to chart", description: file.name });
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/portal/patient-documents", patientScreeningId] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-3" data-testid="left-rail-upload">
      <div className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Upload className="h-4 w-4" /> Upload to chart
      </div>
      <div className="text-[11px] text-slate-500 mb-2 truncate">For: {patientName}</div>
      <div className="space-y-2">
        <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="leftrail-input-file" />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-8 text-xs" data-testid="leftrail-select-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="informed_consent">Informed consent</SelectItem>
            <SelectItem value="screening_form">Screening form</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="reference">Reference</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={onUpload} disabled={!file || busy} className="w-full" data-testid="leftrail-button-upload">
          <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </Card>
  );
}

function PatientDetail({ patient, role, onConsent }: { patient: TodayPatient; role: Role; onConsent: (testType: string | null) => void }) {
  const { data: docs } = useQuery<PatientDoc[]>({
    queryKey: ["/api/portal/patient-documents", patient.patientScreeningId],
    queryFn: async () => {
      const res = await fetch(`/api/portal/patient-documents/${patient.patientScreeningId}`, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: patient.patientScreeningId != null,
  });

  return (
    <div className="space-y-3" data-testid={`patient-detail-${patient.patientScreeningId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold" data-testid="text-patient-name">{patient.name}</div>
          <div className="text-sm text-slate-500">
            DOB {patient.dob ?? "—"} · {patient.facility} · Time {formatTime(patient.time)}
          </div>
        </div>
        <div className="flex gap-2">
          {patient.consentSigned ? (
            <Badge className="bg-emerald-100 text-emerald-700" data-testid="badge-consent-signed">
              <Check className="h-3 w-3 mr-1" /> All consent signed
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-800" data-testid="badge-consent-needed">
              <AlertCircle className="h-3 w-3 mr-1" /> Consent needed
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="consent" className="w-full">
        <TabsList>
          <TabsTrigger value="consent" data-testid="tab-consent">Consent</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
          <TabsTrigger value="tests" data-testid="tab-tests">Tests</TabsTrigger>
          <TabsTrigger value="upload" data-testid="tab-upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="consent" className="space-y-3">
          {patient.consentByTest.length === 0 && (
            <Card className="p-4 text-sm text-slate-500">No tests scheduled for today.</Card>
          )}
          {patient.consentByTest.map((c) => (
            <Card key={c.testType} className="p-4 flex items-center justify-between" data-testid={`consent-row-${c.testType}`}>
              <div>
                <div className="font-medium">{c.testType}</div>
                <div className="text-sm text-slate-500">
                  {c.signed ? "Consent on file for today." : "No signed consent for this test today."}
                </div>
              </div>
              {c.signed ? (
                <Badge className="bg-emerald-100 text-emerald-700" data-testid={`pill-consent-${c.testType}`}>
                  <Check className="h-3 w-3 mr-1" /> Consent ✓
                </Badge>
              ) : (
                <Button onClick={() => onConsent(c.testType)} disabled={patient.patientScreeningId == null} data-testid={`button-sign-${c.testType}`}>
                  <FileSignature className="h-4 w-4 mr-2" />
                  Sign now
                </Button>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-2">
          {(docs ?? []).length === 0 && <div className="text-sm text-slate-500">No documents on file.</div>}
          {(docs ?? []).map((d) => (
            <Card key={d.id} className="p-3 flex items-center justify-between" data-testid={`patient-doc-${d.id}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-xs text-slate-500">{d.kind} · {new Date(d.createdAt).toLocaleString()}</div>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-doc-${d.id}`}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> Open
                </a>
              </Button>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="tests">
          <Card className="p-4">
            <div className="font-medium mb-2">Qualifying tests</div>
            {patient.qualifyingTests.length === 0 ? (
              <span className="text-sm text-slate-500">None</span>
            ) : (
              <div className="space-y-2">
                {patient.qualifyingTests.map((t) => (
                  <div
                    key={t}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                    data-testid={`test-row-${t}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" data-testid={`badge-test-${t}`}>{t}</Badge>
                    </div>
                    <ProcedureCompleteButton
                      patientScreeningId={patient.patientScreeningId}
                      patientName={patient.name}
                      patientDob={patient.dob}
                      facilityId={patient.facility}
                      serviceType={t}
                    />
                  </div>
                ))}
              </div>
            )}
            {patient.appointments.length > 0 && (
              <>
                <div className="font-medium mt-4 mb-2">Today's appointments</div>
                <div className="space-y-1">
                  {patient.appointments.map((a) => (
                    <div key={a.id} className="text-sm">
                      <span className="font-medium">{formatTime(a.scheduledTime)}</span> — {a.testType}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="upload">
          <Card className="p-4">
            <div className="text-sm text-slate-500 mb-3">Upload a document to this patient's chart.</div>
            <PatientUploadCard patient={patient} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


// The legacy demo-patient profile renderer was removed in Phase 1
// Slice 1.1. The canonical PatientDetail + PatientCommandCanvas path
// renders every real-feed patient instead.
function ExpandedSectionView({ mode, src, title, onClose }: { mode: CenterMode; src: string; title: string; onClose: () => void }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm h-full flex flex-col" data-testid={`expanded-${mode}`}>
      <div className="flex items-center gap-2 px-4 py-2">
        <FileBarChart className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
          data-testid="expanded-close"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Collapse
        </button>
      </div>
      <iframe src={src} className="flex-1 w-full" title={title} data-testid={`iframe-${mode}`} />
    </div>
  );
}

function AiBar({ context }: { context: string }) {
  const [q, setQ] = useState("");
  const { toast } = useToast();
  return (
    <div className="border-t bg-white/80 backdrop-blur-sm px-4 py-3 flex items-center gap-2" data-testid="ai-bar">
      <Sparkles className="h-4 w-4 text-indigo-600" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Ask about ${context}…`}
        className="flex-1"
        data-testid="input-ai-question"
      />
      <Button
        size="sm"
        disabled={!q.trim()}
        onClick={() => {
          toast({ title: "Coming soon", description: "AI assistant will answer questions about this clinic day." });
          setQ("");
        }}
        data-testid="button-ai-send"
      >
        <Send className="h-3.5 w-3.5 mr-1" /> Ask
      </Button>
    </div>
  );
}

// Optional workspaceLabel / defaultMode flow in from ClinicWorkflowPortal
// so the same shell renders the Patient Care Specialist Workspace and the
// Ancillary Care Specialist Workspace without changing internal data
// branching. Default modes per spec: PCS → callList, ACS → clinicSchedule.
//
// `role` continues to drive existing data-aware branches inside the shell
// (technician vs liaison). When a workspace-level label is supplied, the
// header title flips to use it.
export function TeamPortalShell({
  role,
  workspaceLabel,
  defaultMode,
  workspaceRole,
}: {
  role: Role;
  workspaceLabel?: string;
  defaultMode?: TeamMemberWorkspaceMode;
  workspaceRole?: WorkspaceRole;
}) {
  // UI-only state for the right-panel mode tabs.
  //
  // Mode → canonical data source the right panel will hydrate from in a
  // later batch:
  //   clinicSchedule    → global_schedule_events (doctor_visit / same_day_add)
  //                       + patient_screenings on the day. For Ancillary
  //                       Care Specialist, consent and screening form
  //                       completion live in this mode and come from
  //                       case_document_readiness / existing document
  //                       endpoints.
  //   ancillarySchedule → global_schedule_events (ancillary_appointment)
  //                       + procedure_events.
  //   callList          → patient_execution_cases.nextActionAt
  //                       + patient_journey_events.
  //
  // For this batch the mode state is purely visual — the existing
  // right-panel list/content stays visible below the tabs regardless of
  // selection.
  const [activeWorkspaceMode, setActiveWorkspaceMode] =
    useState<TeamMemberWorkspaceMode>(defaultMode ?? "clinicSchedule");

  // Capability gating per the team-member-workspace spec:
  //   - Both PCS and ACS can call and schedule (call list, scheduling
  //     coordination, reschedule, document outcomes).
  //   - Only ACS can complete procedure-side work (mark procedure
  //     complete, primary consent/screening completion ownership).
  // Legacy direct mounts (technician / liaison) inherit ACS capability
  // since they always owned the procedure-side flow.
  // Workspace-type flag retained only as a no-profile fallback. Profile
  // capabilities take precedence (set below). Avoid using this for
  // permanent gating — admins drive workspace behavior through the Team
  // Member Profile.
  // Safest default for an unmounted-role context is PCS (read +
  // call/schedule), NOT ACS — ACS owns procedure-side actions that
  // must be granted explicitly. Routes that mean ACS always pass
  // `role="ancillaryCareSpecialist"` (or legacy technician/liaison).
  const workspaceIsAncillaryCareSpecialist =
    workspaceRole === "ancillaryCareSpecialist" ||
    workspaceRole === "technician" ||
    workspaceRole === "liaison";
  // Capability flags come from the resolved Team Member Profile. Workspace
  // name (PCS vs ACS) is no longer the gate — what the user can do is
  // determined by their profile's capabilities map. Fallbacks before the
  // profile resolves: ACS-typed workspaces default true for procedure-side
  // capabilities, PCS-typed default false. After the profile loads (see
  // workspaceProfile below), the values are overwritten from
  // profile.capabilities.* directly.
  let workspaceCanCallAndSchedule = true;
  let workspaceCanCompleteProcedure = workspaceIsAncillaryCareSpecialist;
  let workspaceCanPrimaryConsentScreening = workspaceIsAncillaryCareSpecialist;
  let workspaceCanUploadProcedureReport = workspaceIsAncillaryCareSpecialist;
  void workspaceCanPrimaryConsentScreening;
  void workspaceCanUploadProcedureReport;
  const { toast } = useToast();
  // Profile fetch — pulls the logged-in user's workspace profile from
  // admin_settings via /api/admin-settings/effective. Falls back to a
  // role-derived default when no row exists. Read-only here; profile
  // updates happen from the Admin Users page.
  const { data: currentUser } = useQuery<{ id?: string; username?: string | null; role?: string | null } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const currentUserId = currentUser?.id ?? null;
  const currentUserRole = currentUser?.role ?? null;
  const isAdmin = currentUserRole === "admin";
  // Wouter navigation — used by the admin-only Home dock button to
  // return to /home (the existing main app dashboard).
  const [, setLocation] = useLocation();

  // ADMIN VIEW-AS (Phase 1.5):
  //   - PCS workspace → list users with role "liaison"
  //   - ACS workspace → list users with role "technician"
  //   - Non-admin users never see the selector and the backend ignores
  //     the param if it leaks through.
  // The selected team member's facility allow-list narrows the feeds;
  // the admin's actual identity is preserved for audit / writes.
  const viewAsWorkspaceType: ViewAsWorkspaceType = workspaceIsAncillaryCareSpecialist
    ? "acs"
    : "pcs";
  const [viewAsTeamMemberId, setViewAsTeamMemberId] = useState<string | null>(null);
  const { data: viewAsCandidates = [] as ViewAsTeamMember[] } = useQuery({
    queryKey: ["/api/portal/team-members", viewAsWorkspaceType, isAdmin],
    queryFn: () => fetchTeamMembersForWorkspace(viewAsWorkspaceType),
    enabled: isAdmin,
  });
  // Reset the view-as selection if the workspace switches role or the
  // selected user is no longer in the candidate list.
  useEffect(() => {
    if (!isAdmin) {
      if (viewAsTeamMemberId !== null) setViewAsTeamMemberId(null);
      return;
    }
    if (
      viewAsTeamMemberId !== null &&
      !viewAsCandidates.some((u) => u.id === viewAsTeamMemberId)
    ) {
      setViewAsTeamMemberId(null);
    }
  }, [isAdmin, viewAsWorkspaceType, viewAsCandidates, viewAsTeamMemberId]);

  // The selected view-as token is a ROSTER id (outreach_schedulers.id), not
  // a login user. The call list resolves it server-side. For the workspace
  // PROFILE (capabilities / facility allow-list), only switch to the viewed-as
  // identity when the roster member is linked to a login account; otherwise
  // keep the admin's own profile so admin retains broad facility access while
  // observing.
  const selectedViewAsCandidate =
    (isAdmin && viewAsTeamMemberId
      ? viewAsCandidates.find((u) => u.id === viewAsTeamMemberId)
      : undefined) ?? null;
  // Profile fetch is keyed on the *viewed-as* user when an admin is
  // observing a roster member with a linked login, so capabilities /
  // facility allow-list / allowedServiceTypes reflect what they would see.
  const profileTargetUserId =
    selectedViewAsCandidate?.userId ? selectedViewAsCandidate.userId : currentUserId;
  const profileTargetRole = selectedViewAsCandidate?.userId
    ? (viewAsWorkspaceType === "acs" ? "technician" : "liaison")
    : currentUserRole;
  const { data: workspaceProfile } = useQuery({
    queryKey: ["/api/admin-settings/effective", "team_member", "workspace_profile", profileTargetUserId],
    queryFn: () => fetchTeamMemberProfile(profileTargetUserId as string, profileTargetRole),
    enabled: !!profileTargetUserId,
  });

  // facData refetches on admin view-as change so the facility picker
  // narrows to the selected team-member's allow-list.
  const { data: facData } = useQuery<{ facilities: string[] }>({
    queryKey: ["/api/portal/my-facilities", viewAsTeamMemberId],
    queryFn: async () => {
      const url = viewAsTeamMemberId
        ? `/api/portal/my-facilities?viewAsTeamMemberId=${encodeURIComponent(viewAsTeamMemberId)}`
        : "/api/portal/my-facilities";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
  });

  const profileViewAllFacilities = !!workspaceProfile?.capabilities?.viewAllFacilities;
  const profileAssignedFacilities = workspaceProfile?.assignedFacilityIds ?? [];

  // Profile capability overrides — driven purely by the stored profile so
  // the workspace name (PCS vs ACS) does not gate behavior. The
  // resolver below ensures procedure-side capability ALWAYS requires
  // an ACS-typed workspace at runtime (defense-in-depth).
  const portalCapabilities = resolvePortalCapabilities({
    workspaceType: workspaceIsAncillaryCareSpecialist
      ? "ancillaryCareSpecialist"
      : "patientCareSpecialist",
    profile: workspaceProfile ?? null,
  });
  workspaceCanCallAndSchedule =
    portalCapabilities.canScheduleClinicVisit ||
    portalCapabilities.canScheduleAncillary ||
    portalCapabilities.canUseCallList;
  workspaceCanCompleteProcedure = portalCapabilities.canMarkProcedureCompleted;
  workspaceCanPrimaryConsentScreening = portalCapabilities.canPrimaryConsentScreening;
  workspaceCanUploadProcedureReport = portalCapabilities.canUploadProcedureReport;
  const allowedServiceTypes = workspaceProfile?.allowedServiceTypes ?? [];
  // Apply assigned-facility allow-list when the profile has any. The
  // backend /api/portal/my-facilities is the underlying source of truth;
  // we narrow client-side so unassigned facilities don't appear in the
  // existing facility picker. Bypassed when viewAllFacilities is true.
  const facilities = useMemo(() => {
    const base = facData?.facilities ?? [];
    if (profileViewAllFacilities) return base;
    if (profileAssignedFacilities.length === 0) return base;
    const allowed = new Set(profileAssignedFacilities);
    return base.filter((f) => allowed.has(f));
  }, [facData, profileViewAllFacilities, profileAssignedFacilities]);

  const [facility, setFacility] = useState<string>("");
  useEffect(() => {
    if (!facility && facilities.length > 0) {
      // Prefer the profile's default facility when it lives inside the
      // resolved list; otherwise fall back to the first available.
      const preferred = workspaceProfile?.defaultFacilityId;
      if (preferred && facilities.includes(preferred)) {
        setFacility(preferred);
      } else {
        setFacility(facilities[0]);
      }
    }
  }, [facilities, facility, workspaceProfile?.defaultFacilityId]);

  // Admin view-as: snap the selected facility to the viewed-as roster
  // member's clinic so every right-panel feed (call list, clinic +
  // ancillary schedule) observes the same facility the member would see.
  // Without this the server narrows feeds to the member's facility while a
  // stale admin-selected clinic could yield empty/forbidden feeds.
  useEffect(() => {
    if (!isAdmin) return;
    const target = selectedViewAsCandidate?.facility ?? null;
    if (!target) return;
    if (facility === target) return;
    if (facilities.includes(target)) setFacility(target);
  }, [isAdmin, selectedViewAsCandidate?.facility, facilities, facility]);

  // Seed the right-panel default mode from the profile once it loads.
  const profileSeededRef = useRef(false);
  useEffect(() => {
    if (profileSeededRef.current) return;
    if (workspaceProfile?.defaultMode) {
      profileSeededRef.current = true;
      setActiveWorkspaceMode(workspaceProfile.defaultMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceProfile?.defaultMode]);

  // Enforce profile facility scope: if the active facility falls outside
  // the assigned-facility allow-list (and viewAllFacilities is off), snap
  // to the default or first-assigned facility. Runs once per profile-load
  // since user-driven facility changes should be respected afterwards.
  useEffect(() => {
    if (!workspaceProfile) return;
    if (profileViewAllFacilities) return;
    if (profileAssignedFacilities.length === 0) return;
    if (!facility) return;
    if (profileAssignedFacilities.includes(facility)) return;
    const preferred = workspaceProfile.defaultFacilityId;
    const next = preferred && profileAssignedFacilities.includes(preferred)
      ? preferred
      : profileAssignedFacilities[0];
    if (next && next !== facility) {
      setFacility(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceProfile, profileViewAllFacilities, profileAssignedFacilities.join("|"), facility]);

  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  // Clinic Schedule clinician filter (Phase 2). null = "All clinicians".
  // Facility-scoped clinician list comes from the canonical
  // /api/org/clinicians-by-facility-name (facility_clinicians). The clinic
  // schedule already returns a per-patient clinicianName (from the batch
  // snapshot), so filtering is a client-side match on that name.
  const [clinicClinicianFilter, setClinicClinicianFilter] = useState<string | null>(null);
  // ═══════════════════════════════════════════════════════════════════════
  // LEGACY CENTER STATE — DO NOT USE FOR NEW WORKSPACE NAVIGATION.
  // The Playground workspace engine (PlaygroundWorkspaceProvider) is the sole
  // authority for opening, focusing, and rendering center workspaces via
  // dispatchOpenWorkspace(). PlaygroundBridge always renders the center; the
  // centerMode/centerSrc/centerTitle + portalTabs + dock* state below is dead
  // for workspace ownership and retained only so the pre-Playground helper
  // chain still type-checks. New navigation MUST go through the Playground.
  // Scheduled for removal once the last legacy helper callers are deleted.
  // ═══════════════════════════════════════════════════════════════════════
  /**
   * Scheduling context only — the active patient for the left-rail
   * PatientMiniCalendar / schedule dialogs. Derived ONE-WAY from launcher
   * clicks; it must NOT drive center rendering (the Playground owns that).
   */
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  /** @deprecated Legacy center router. Playground owns center rendering. DO NOT USE. */
  const [centerMode, setCenterMode] = useState<CenterMode>("playground");
  /** @deprecated Legacy iframe/src for ExpandedSectionView. DO NOT USE. */
  const [centerSrc, setCenterSrc] = useState<string>("");
  /** @deprecated Legacy center title. DO NOT USE. */
  const [centerTitle, setCenterTitle] = useState<string>("");
  const [consentDialog, setConsentDialog] = useState<{ patient: TodayPatient; testType: string | null } | null>(null);
  const [playgroundTab, setPlaygroundTab] = useState<"overview" | "tasks" | "documents">("overview");
  const [scheduleDialogPatient, setScheduleDialogPatient] = useState<TodayPatient | null>(null);
  const [schedulePatientDialog, setSchedulePatientDialog] =
    useState<SchedulePatientDialogPatient | null>(null);
  // Patient context for the left-rail PatientMiniCalendar. Clicking the
  // calendar icon on a clinic/ancillary patient card sets this so the
  // mini calendar header switches from "facility month view" to
  // "Scheduling: <patient name>". The same icon also opens the
  // SchedulePatientDialog for the immediate action.
  const [selectedPatientForScheduling, setSelectedPatientForScheduling] =
    useState<SchedulePatientDialogPatient | null>(null);
  // Canonical team-portal calendar drawer (mirrors Plexus IQ's header
  // calendar icon → UniversalCalendarDrawer pattern).
  const [teamPortalCalendarOpen, setTeamPortalCalendarOpen] = useState(false);
  const [schedulePatientPlaygroundContext, setSchedulePatientPlaygroundContext] =
    useState<{
      patient: SchedulePatientDialogPatient;
      selectedDate: string;
      ancillaries?: AncillaryServiceContext[];
    } | null>(null);
  // Optional pre-fill date/time carried into the SchedulePatientDialog from the
  // left-rail Calendar quick-schedule pop-up (task #635). Null falls back to
  // selectedDate / no preset time.
  const [schedulePatientDialogDefaultDate, setSchedulePatientDialogDefaultDate] =
    useState<string | null>(null);
  const [schedulePatientDialogDefaultTime, setSchedulePatientDialogDefaultTime] =
    useState<string | null>(null);
  // Left-rail Calendar quick-schedule pop-up (task #635). Holds the pre-filled
  // date string while open; null = closed.
  const [calendarQuickScheduleDate, setCalendarQuickScheduleDate] =
    useState<string | null>(null);
  // Quick-call popup for the right-panel call list. Reuses the canonical
  // DispositionSheet (posts /api/engagement-center/call-result). Holds the
  // selected call-list row so we can also offer Push-to-Playground.
  const [callDialogRow, setCallDialogRow] = useState<TeamWorkspaceCallListItem | null>(null);
  // Step 3 — phone icon opens a pop-up dialer (CallWorkspace inside a Dialog)
  // instead of navigating to a Playground tab. CallWorkspace owns the honest
  // RingCentral boundary (manual-dial fallback when the provider is unwired).
  const [callWorkspaceCtx, setCallWorkspaceCtx] = useState<CallCaseContext | null>(null);
  // Step 5 — keys of call/ancillary rows mid-exit. We add a key here on a
  // one-click complete, let the row animate up (max-h-0 + opacity-0), then
  // refetch so the row disappears smoothly instead of popping out.
  const [removingRowKeys, setRemovingRowKeys] = useState<Set<string>>(new Set());
  /** @deprecated Legacy center tab list. Superseded by Playground workspaces. DO NOT USE. */
  const [portalTabs, setPortalTabs] = useState<PortalTab[]>([]);
  /** @deprecated Legacy active center tab id. Superseded by Playground activeWorkspaceId. DO NOT USE. */
  const [activePortalTabId, setActivePortalTabId] = useState<string | null>(null);
  // Left-rail Marketing → Email handoff payloads. The Marketing tool
  // pushes material IDs here when the operator chooses "Compose email
  // with selected materials"; the Email Composer adopts them and
  // clears the slot. Same pattern for the Templates / Staff Resources
  // "Insert into composer" button.
  const [pendingEmailAttachments, setPendingEmailAttachments] = useState<
    ReadonlyArray<string | number> | null
  >(null);
  const [pendingEmailTemplate, setPendingEmailTemplate] = useState<
    { subject: string; body: string } | null
  >(null);
  // GLOBAL CALENDAR ISOLATION (Phase 1.7) — the left-rail Compact
  // Global Calendar maintains its own date state independent of the
  // right-rail work queue. The right-rail feeds (call list / clinic
  // schedule / ancillary schedule) still key off `selectedDate`; this
  // separate `globalCalendarDate` is used by the center-canvas
  // calendar view only. Clicking a date in the left calendar must NOT
  // refetch the assigned-work queries, change the active patient,
  // change the facility, or affect activeWorkspaceMode.
  const [globalCalendarDate, setGlobalCalendarDate] = useState<string>(todayIso());
  // ── Task #643: upgraded Tools workspace ──────────────────────────
  // Workspace preferences (Settings), persisted per user in the DB.
  const {
    prefs: workspacePrefs,
    hydrated: workspacePrefsHydrated,
    updatePref: updateWorkspacePref,
    resetPrefs: resetWorkspacePrefs,
    flushPersist: flushWorkspacePrefs,
  } = useWorkspacePrefs(currentUserId ?? null);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  // Communication tray tab (bottom half of Tools panel).
  const [trayTab, setTrayTab] = useState<TrayTab>(workspacePrefs.defaultTrayTab);
  const trayTabInitRef = useRef(false);
  // Chat selection lifted to the shell so the docked tray and the expanded
  // Playground chat share the same active thread across both tabs. (#761)
  const [chatDirectActiveUserId, setChatDirectActiveUserId] = useState<string | null>(null);
  const [chatTeamActiveTaskId, setChatTeamActiveTaskId] = useState<number | null>(null);
  // Bumped on chat dock-tile click / expand to focus the active composer.
  const [chatFocusNonce, setChatFocusNonce] = useState(0);
  // Playground floating widgets (sticky notes / email / team-chat).
  // Attributed to the REAL logged-in user, never the admin view-as target.
  const {
    widgets: playgroundWidgets,
    addWidget: addPlaygroundWidget,
    updateWidget: updatePlaygroundWidget,
    removeWidget: removePlaygroundWidget,
  } = useWorkspaceWidgets(currentUser?.username ?? "you", currentUserId ?? null);
  // ── Task #740: iMessage-style Messaging (frontend mock only) ─────
  // A single source of truth for the inbox panel + floating window. No
  // backend — the real Twilio/direct/team messaging still lives in the
  // Communication Tray under the Tools tab and is untouched.
  // Which top-level tab the left panel shows: the Messaging inbox or the
  // Tools dock (calendar + tray + tool launchers). K7 — seeded from the
  // persisted defaultLeftTab pref (default "tools") once prefs hydrate;
  // user clicks win after that. NOT hardcoded.
  const [leftPanelTab, setLeftPanelTab] = useState<"messaging" | "tools">(
    DEFAULT_WORKSPACE_PREFS.defaultLeftTab,
  );
  const leftPanelTabInitRef = useRef(false);
  const [messagesWindowOpen, setMessagesWindowOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Phase 1 — REAL messaging. The Messaging inbox + floating window are now
  // backed by the canonical /api/messaging/* conversation model (was the
  // mockPortalMessages local state). Same UI contract; real data.
  const {
    conversations: messagingConversations,
    totalUnread: messagingUnread,
    markRead: markMessagingRead,
    sendMessage: sendMessagingMessage,
  } = useTeamMessages(currentUserId ?? null, activeConversationId);
  const openMessagesConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      setMessagesWindowOpen(true);
      markMessagingRead(id);
    },
    [markMessagingRead],
  );
  // --- Hover-only panels (task #628) ---
  // The Tools (left) and Work Queue (right) panels always REST ASIDE (slid
  // mostly off-screen at ~50% opacity, leaving a visible edge) and reveal to
  // full opacity on hover via a transient `peek` flag, hiding again on pointer
  // leave. They never unmount, so filters / scroll / selected patient / tool
  // state are preserved. The two panels are FULLY independent — revealing or
  // hiding one never affects the other. There is no persisted open/aside toggle
  // and no compact/expanded size switching (both were driven by the removed
  // pills); both panels reveal at their normal/full width.
  const [leftRailPeek, setLeftRailPeek] = useState(false);
  const [rightRailPeek, setRightRailPeek] = useState(false);
  // Pin a panel so it stays fully revealed regardless of hover. Toggled from a
  // pin button in each panel's header; independent per panel.
  const [leftRailPinned, setLeftRailPinned] = useState(false);
  const [rightRailPinned, setRightRailPinned] = useState(false);
  // Derived open state — binary, the single source of truth for the slide.
  const leftRailOpen = leftRailPinned || leftRailPeek;
  const rightRailOpen = rightRailPinned || rightRailPeek;
  // Task #643 — apply in-session Settings prefs. Pin defaults + tray tab
  // follow the workspace prefs; changing the pref updates live.
  useEffect(() => {
    setLeftRailPinned(workspacePrefs.toolsPinnedByDefault);
  }, [workspacePrefs.toolsPinnedByDefault]);
  useEffect(() => {
    setRightRailPinned(workspacePrefs.workQueuePinnedByDefault);
  }, [workspacePrefs.workQueuePinnedByDefault]);
  useEffect(() => {
    // Seed the tray tab from the persisted default ONCE, after the saved
    // prefs have hydrated from the server; user tab clicks win after that.
    if (trayTabInitRef.current || !workspacePrefsHydrated) return;
    trayTabInitRef.current = true;
    setTrayTab(workspacePrefs.defaultTrayTab);
  }, [workspacePrefs.defaultTrayTab, workspacePrefsHydrated]);
  useEffect(() => {
    // K7 — seed the top-level left tab from the persisted default ONCE,
    // after prefs hydrate; user tab clicks win after that.
    if (leftPanelTabInitRef.current || !workspacePrefsHydrated) return;
    leftPanelTabInitRef.current = true;
    setLeftPanelTab(workspacePrefs.defaultLeftTab);
  }, [workspacePrefs.defaultLeftTab, workspacePrefsHydrated]);
  const leftRailRef = useRef<HTMLDivElement>(null);
  // Task #643 — Playground surface ref for drop-point math (drag tool → widget).
  const playgroundSurfaceRef = useRef<HTMLDivElement>(null);
  const rightRailRef = useRef<HTMLDivElement>(null);
  // Deferred-close timers, one per rail. Entering the hotspot or the rail body
  // cancels the pending close; leaving schedules it. This is the mechanism that
  // treats hotspot + body (+ rail-owned popovers) as a single hover region.
  const leftRailPeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightRailPeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (leftRailPeekTimer.current) clearTimeout(leftRailPeekTimer.current);
      if (rightRailPeekTimer.current) clearTimeout(rightRailPeekTimer.current);
    };
  }, []);
  // Escape closes any hover-open (unpinned) rail. Pinned rails are unaffected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!leftRailPinned) setLeftRailPeek(false);
      if (!rightRailPinned) setRightRailPeek(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftRailPinned, rightRailPinned]);
  // TOUCH SUPPORT (task #629) — hover is unavailable on tablets / touchscreens,
  // so the hover-only reveal from task #628 leaves touch users stuck with just
  // the center canvas. On `(hover: none)` devices we switch the panels to a TAP
  // toggle instead: tapping a panel's resting edge reveals it, tapping the
  // canvas (anywhere outside the panel) slides it back aside. Pointer devices
  // keep the unchanged mouseenter/leave hover behavior. The two panels stay
  // fully independent and never unmount.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none)");
    const update = () => setIsTouchDevice(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // Click-away dismissal for the tap toggle: when a panel is revealed on a
  // touch device, a pointerdown outside that panel slides it back aside. Each
  // panel is checked independently against its own ref. No-op on pointer
  // devices. Pinned panels stay revealed regardless (pin is a separate lever).
  useEffect(() => {
    if (!isTouchDevice) return;
    if (!leftRailPeek && !rightRailPeek) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        leftRailPeek &&
        leftRailRef.current &&
        target &&
        !leftRailRef.current.contains(target)
      ) {
        setLeftRailPeek(false);
      }
      if (
        rightRailPeek &&
        rightRailRef.current &&
        target &&
        !rightRailRef.current.contains(target)
      ) {
        setRightRailPeek(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [isTouchDevice, leftRailPeek, rightRailPeek]);
  const leftRailSize = "normal" as RailSize;
  const rightRailSize = "normal" as RailSize;
  // Conventional side-panel hover model. The open trigger is a STATIONARY
  // edge hotspot (see the rail JSX), never the moving body — so there is no
  // quiver from the sliding element sweeping past the cursor, and no rect
  // guard is needed. The hotspot and the rail body are treated as ONE hover
  // region: entering either cancels a pending close; leaving either schedules
  // a close after a short delay that the next enter cancels. This absorbs the
  // hotspot→rail and rail→popover hand-offs without flicker.
  //
  // Derived open state is `isPinned || isHovered` (the `*Peek` state below is
  // the "isHovered" flag; the name is retained to avoid churning ~30 call
  // sites). Binary only — no intermediate/drag positions are ever stored.
  const RAIL_CLOSE_DELAY_MS = 200;
  const makeRailHoverOpen =
    (
      timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
      setHovered: (v: boolean) => void,
    ) =>
    () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setHovered(true);
    };
  const makeRailHoverClose =
    (
      timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
      setHovered: (v: boolean) => void,
    ) =>
    () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setHovered(false);
      }, RAIL_CLOSE_DELAY_MS);
    };
  const [aiMinimized, setAiMinimized] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [novaQuickPanelOpen, setNovaQuickPanelOpen] = useState(false);
  const [metricsPopupOpen, setMetricsPopupOpen] = useState(false);
  const [schedulePeekPatient, setSchedulePeekPatient] = useState<TodayPatient | null>(null);
  // Demo-patient consent / screening toggles removed in Phase 1
  // Slice 1.1. Consent / screening state for real patients now comes
  // from the live feed (p.consentSigned) and from the canonical
  // patient-detail surfaces.
  /** @deprecated Legacy dock-app center state. Superseded by GlobalDock + Playground workspaces. DO NOT USE. */
  const [dockOpenApps, setDockOpenApps] = useState<Array<"tasks" | "schedule" | "consent" | "chart" | "documents">>([]);
  /** @deprecated Legacy active dock-app. Superseded by Playground workspaces. DO NOT USE. */
  const [dockActiveApp, setDockActiveApp] = useState<null | "tasks" | "schedule" | "consent" | "chart" | "documents">(null);

  // The hardcoded demo-patient + demo-profile useMemo blocks were
  // removed in Phase 1 Slice 1.1. They previously prepended a
  // demo patient to every workspace's `patients` list and blocked
  // real-feed verification on staging. The workspace now renders
  // only patients returned by /api/portal/today + the three
  // canonical workspace feeds.

  // ───── Canonical right-panel mode queries ──────────────────────────
  // Day window for date-bounded endpoints (clinic + ancillary schedule).
  // /api/scheduler-portal/cases does NOT support date filters; the helper
  // applies the same window client-side over nextActionAt.
  const workspaceDayStartIso = `${selectedDate}T00:00:00.000Z`;
  const workspaceDayEndIso = `${selectedDate}T23:59:59.999Z`;

  // ADMIN VIEW-AS: every workspace feed key carries viewAsTeamMemberId
  // so the query refetches on selection change. The param is forwarded
  // to the canonical feed helpers; the backend ignores it for non-admin
  // callers as a defense-in-depth measure.
  //
  // workspaceCallListContext tells the call-list endpoint which workspace
  // is asking — PCS (liaison-role view-as) or ACS (technician-role view-
  // as). Without this hint, ACS admin view-as silently fails the role
  // compat check and falls back to admin pass-through, which would
  // show every case in the facility instead of the viewed-as user's
  // queue. See [[anthony-callista-root-cause]] and
  // docs/architecture/complete-team-portal-operations-runtime.md §B.
  const workspaceCallListContext: "pcs" | "acs" | undefined =
    workspaceRole === "patientCareSpecialist" || workspaceRole === "liaison"
      ? "pcs"
      : workspaceRole === "ancillaryCareSpecialist" || workspaceRole === "technician"
        ? "acs"
        : undefined;
  const { data: workspaceCallList = [], isLoading: workspaceCallListLoading } = useQuery({
    queryKey: [
      "team-workspace-call-list",
      workspaceRole ?? role,
      facility,
      selectedDate,
      viewAsTeamMemberId,
      workspaceCallListContext,
    ],
    queryFn: () =>
      // assignedRole is intentionally omitted — both workspaces read the
      // canonical call list; canonical priority sorting handles ordering
      // and the profile's facility scope handles narrowing. Hardcoded
      // role hints used to differ per workspace name; per spec, the
      // profile is now authoritative.
      //
      // assignedTeamMemberId is intentionally NOT passed here either —
      // the server resolves it from the session (or the view-as user)
      // via resolveCallListAssignmentScope and applies it server-side
      // as a locked filter. The client must not pass an integer id
      // because it would be ignored anyway (locked override).
      fetchWorkspaceCallList({
        facilityId: facility || null,
        // Server-side operational-day scoping (Phase 0/#11). Backlog is
        // included only for today/future by the server; past dates show
        // cases whose next action was due that day.
        date: selectedDate,
        limit: 100,
        viewAsTeamMemberId,
        workspace: workspaceCallListContext ?? null,
      }),
    enabled: !!facility,
  });

  // Warm the patient-directory resolve cache (screening id -> roster key) for
  // the top visible call-list patients so the first name clicks open the EMR
  // chart instantly instead of waiting on a cold resolve.
  useEffect(() => {
    const top = (workspaceCallList as Array<{ patientScreeningId?: number | null }>)
      .filter((r) => typeof r.patientScreeningId === "number" && r.patientScreeningId! > 0)
      .slice(0, 8);
    for (const r of top) {
      const id = r.patientScreeningId as number;
      queryClient.prefetchQuery({
        queryKey: ["/api/patients/database/resolve", String(id)],
        queryFn: async () => {
          const res = await fetch(`/api/patients/database/resolve/${id}`, {
            credentials: "include",
          });
          if (!res.ok) throw new Error("Failed to resolve patient");
          return res.json();
        },
        staleTime: 60_000,
      });
    }
  }, [workspaceCallList]);

  // Live cross-user queue refresh. Subscribes to the shared engagement activity
  // SSE so a reassignment / absence redistribution / manager-logged disposition
  // made by ANOTHER session refetches this staff member's queue within ~1s,
  // without a manual reload. Server stays authoritative (PHI-free nudge only).
  useEngagementActivityStream({ facility, selectedDate });

  const { data: workspaceClinicSchedule = [], isLoading: workspaceClinicLoading } = useQuery({
    queryKey: [
      "team-workspace-clinic-schedule",
      facility,
      selectedDate,
      viewAsTeamMemberId,
    ],
    queryFn: () =>
      fetchWorkspaceClinicSchedule({
        facilityId: facility || null,
        startDate: workspaceDayStartIso,
        endDate: workspaceDayEndIso,
        limit: 100,
        viewAsTeamMemberId,
      }),
    enabled: !!facility,
  });

  const { data: workspaceAncillarySchedule = [], isLoading: workspaceAncillaryLoading } = useQuery({
    queryKey: [
      "team-workspace-ancillary-schedule",
      facility,
      selectedDate,
      viewAsTeamMemberId,
    ],
    // Facility filter is the primary scope so ancillary appointments written
    // to global_schedule_events by remote schedulers still surface for that
    // facility, regardless of assigned user.
    queryFn: () =>
      fetchWorkspaceAncillarySchedule({
        facilityId: facility || null,
        startDate: workspaceDayStartIso,
        endDate: workspaceDayEndIso,
        limit: 100,
        viewAsTeamMemberId,
      }),
    enabled: !!facility,
  });

  // Profile-driven Ancillary Schedule filtering. When the team member's
  // profile lists allowedServiceTypes, only those rows render. Empty list
  // means "no restriction" — show everything. Matching is case-insensitive
  // and substring-based so a profile entry like "BrainWave" still matches
  // canonical service types like "brainwave - 95957".
  const filteredAncillarySchedule = useMemo(() => {
    if (allowedServiceTypes.length === 0) return workspaceAncillarySchedule;
    const lowered = allowedServiceTypes.map((s) => s.toLowerCase());
    return workspaceAncillarySchedule.filter((row) => {
      const st = (row.serviceType ?? "").toLowerCase();
      if (!st) return false;
      return lowered.some((needle) => st.includes(needle));
    });
  }, [workspaceAncillarySchedule, allowedServiceTypes]);

  // Phase 1 — same-patient visit-block grouping (UI ONLY; the underlying
  // canonical service instances / executionCaseIds are preserved intact on
  // `group.events`). Rule (approved): group rows that share the SAME patient
  // AND the SAME operational date AND whose start times fall within a
  // 90-minute visit block; services more than 90 minutes apart render as
  // SEPARATE chronological entries. Rows are ordered chronologically by
  // startsAt; a group's time is its earliest start. Patients with a single
  // service just render as a one-service group.
  const ANCILLARY_VISIT_BLOCK_MS = 90 * 60 * 1000;
  const groupedAncillarySchedule = useMemo<AncillaryVisitGroup[]>(() => {
    type Row = (typeof filteredAncillarySchedule)[number];
    const ms = (iso: string | null | undefined): number | null => {
      if (!iso) return null;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : null;
    };
    const localDay = (iso: string | null | undefined): string => {
      if (!iso) return "no-date";
      const d = new Date(iso);
      return Number.isFinite(d.getTime())
        ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
        : "no-date";
    };
    // Chronological order first (nulls last), stable by row id.
    const sorted = [...filteredAncillarySchedule].sort((a, b) => {
      const ta = ms(a.startsAt);
      const tb = ms(b.startsAt);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
    const groups: AncillaryVisitGroup[] = [];
    // Track the open group per (patient + local day) so an interleaved
    // schedule still blocks correctly, and close it when the 90-min window
    // from the block's anchor is exceeded.
    const openByKey = new Map<string, AncillaryVisitGroup>();
    for (const row of sorted) {
      const patientKey = ancillaryPatientKey(row);
      const day = localDay(row.startsAt);
      const key = `${patientKey}|${day}`;
      const startMs = ms(row.startsAt);
      const open = openByKey.get(key);
      const withinBlock =
        open != null &&
        (open.anchorMs == null || startMs == null
          ? open.anchorMs == null && startMs == null // both undated → same block
          : startMs - open.anchorMs <= ANCILLARY_VISIT_BLOCK_MS);
      if (open && withinBlock) {
        open.events.push(row as Row);
      } else {
        const g: AncillaryVisitGroup = {
          key: `${key}|${row.id ?? groups.length}`,
          patientName: row.patientName ?? "Unnamed patient",
          anchorMs: startMs,
          events: [row as Row],
        };
        groups.push(g);
        openByKey.set(key, g);
      }
    }
    return groups;
  }, [filteredAncillarySchedule]);

  // Key a patient's ancillary rows so the doc workflows can offer a compact
  // "which ancillary" selector when a patient has more than one active test.
  const ancillaryPatientKey = (row: {
    patientScreeningId?: number | null;
    patientName?: string | null;
    facilityId?: string | null;
  }): string =>
    row.patientScreeningId != null
      ? `p:${row.patientScreeningId}`
      : `n:${(row.patientName ?? "").toLowerCase().trim()}|${row.facilityId ?? ""}`;

  const ancillariesByPatient = useMemo(() => {
    const map = new Map<string, AncillaryServiceContext[]>();
    for (const row of filteredAncillarySchedule) {
      const key = ancillaryPatientKey(row);
      const svc: AncillaryServiceContext = {
        // Each scheduled ancillary is its own instance (the schedule row id),
        // so repeat/return visits of the same test stay distinct and route
        // docs to the correct execution case.
        instanceId: String(row.id),
        serviceType: row.serviceType ?? "Ancillary",
        executionCaseId: row.executionCaseId ?? null,
        patientScreeningId: row.patientScreeningId ?? null,
        readiness: row.readiness ?? null,
        startsAt: row.startsAt ?? null,
        status: row.status ?? null,
      };
      const list = map.get(key);
      if (list) {
        // Dedupe by instance id only (never by service type) so identical rows
        // don't stack while distinct same-type appointments are preserved.
        if (!list.some((s) => s.instanceId === svc.instanceId)) list.push(svc);
      } else {
        map.set(key, [svc]);
      }
    }
    return map;
  }, [filteredAncillarySchedule]);

  // Cells for the canonical team-portal calendar drawer. We bucket the
  // workspace's clinic + ancillary events by local date so the month
  // view shows accurate per-day counts without a new backend route.
  // Plexus IQ's drawer uses the same `CanonicalMonthCellSummary` shape.
  const teamPortalCalendarCells = useMemo<Record<string, CanonicalMonthCellSummary>>(() => {
    const counts = new Map<string, number>();
    const addDay = (iso: string | null | undefined) => {
      if (!iso) return;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (const row of workspaceClinicSchedule) addDay(row.startsAt ?? null);
    for (const row of filteredAncillarySchedule) addDay(row.startsAt ?? null);
    const out: Record<string, CanonicalMonthCellSummary> = {};
    for (const [key, count] of counts) {
      out[key] = { count, dots: [] };
    }
    return out;
  }, [workspaceClinicSchedule, filteredAncillarySchedule]);

  // Profile id for the canonical team-portal drawer.
  //   ACS → ancillaryCareSpecialist (procedure-side + outreach filters)
  //   PCS + legacy roles → patientCareSpecialist
  const teamPortalCalendarProfileId: "ancillaryCareSpecialist" | "patientCareSpecialist" =
    workspaceIsAncillaryCareSpecialist ? "ancillaryCareSpecialist" : "patientCareSpecialist";

  const { data: scheduleData } = useQuery<{ patients: TodayPatient[] }>({
    queryKey: ["/api/portal/today-schedule", facility, selectedDate, viewAsTeamMemberId],
    queryFn: async () => {
      const u = new URL("/api/portal/today-schedule", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("date", selectedDate);
      if (viewAsTeamMemberId) u.searchParams.set("viewAsTeamMemberId", viewAsTeamMemberId);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  // Once we have today's schedule for the chosen clinic, fire-and-forget a
  // POST to ensure tech_assignment Plexus tasks exist for each consent gap.
  // Read endpoints stay side-effect free; this side-effect lives explicitly
  // on the client so failures degrade gracefully (toast/log only).
  useEffect(() => {
    if (!facility || selectedDate !== todayIso() || !scheduleData?.patients) return;
    const hasGaps = scheduleData.patients.some((p) => p.consentByTest.some((c) => !c.signed));
    if (!hasGaps) return;
    apiRequest("POST", "/api/portal/ensure-tech-tasks", { facility, date: selectedDate })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/portal/my-tasks"] }))
      .catch(() => { /* best effort */ });
  }, [facility, selectedDate, scheduleData?.patients?.length]);

  const { data: tasksData } = useQuery<{ urgent: PortalTask[]; open: PortalTask[] }>({
    queryKey: ["/api/portal/my-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/portal/my-tasks", { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  // Shell-level DM roster poll (Task #656). Feeds the unread badge on the
  // Direct dock tile + tray tab so operators notice new messages without
  // opening the tray. Shares the query cache with DirectMessagesTab (same
  // key), so opening the tray reuses this data and the mark-read there
  // invalidates this too.
  const { data: dmRosterData } = useQuery<{ roster: { id: string; username: string; role: string | null; unread: number }[] }>({
    queryKey: ["/api/messaging/roster"],
    queryFn: async () => {
      const res = await fetch("/api/messaging/roster", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load teammates");
      return res.json();
    },
    refetchInterval: POLL_MS,
  });
  const directUnread = (dmRosterData?.roster ?? []).reduce((sum, r) => sum + (r.unread ?? 0), 0);

  // Patient SMS is intentionally not part of the live portal — no
  // /api/portal/patient-messages/* fetch is issued.

  const { data: outreachData } = useQuery<{ patients: OutreachItem[]; heavyDay?: boolean; cap?: number; totalPool?: number }>({
    queryKey: ["/api/portal/outreach-call-list", facility],
    queryFn: async () => {
      const u = new URL("/api/portal/outreach-call-list", window.location.origin);
      u.searchParams.set("facility", facility);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  const livePatients = scheduleData?.patients ?? [];
  // Phase 1 Slice 1.1: render only real-feed patients. The legacy
  // demo-patient prepend was removed to expose the actual canonical
  // /api/portal/today + workspace feeds.
  const allClinicPatients = livePatients;

  // Phase 2 — facility clinician directory for the Clinic Schedule selector.
  // Canonical source: /api/org/clinicians-by-facility-name (facility_clinicians).
  const { data: clinicClinicianData } = useQuery<{
    facilityId: number | null;
    clinicians: Array<{ id: number; displayName: string; credentials: string | null }>;
  }>({
    queryKey: ["/api/org/clinicians-by-facility-name", facility],
    queryFn: async () => {
      const res = await fetch(
        `/api/org/clinicians-by-facility-name?name=${encodeURIComponent(facility)}`,
        { credentials: "include" },
      );
      if (!res.ok) return { facilityId: null, clinicians: [] };
      return res.json();
    },
    enabled: !!facility,
    staleTime: 60_000,
  });
  const facilityClinicians = useMemo(
    () => clinicClinicianData?.clinicians ?? [],
    [clinicClinicianData],
  );

  // Reset the clinician filter when the facility changes (its clinician list
  // changes) so a stale selection from another facility can't hide everyone.
  useEffect(() => {
    setClinicClinicianFilter(null);
  }, [facility]);

  // Clinic patients filtered by the selected clinician (client-side match on
  // the per-patient clinicianName the schedule feed returns). "All" shows
  // everyone. Patients with no recorded clinician are kept only under "All".
  const patients = useMemo(() => {
    if (!clinicClinicianFilter) return allClinicPatients;
    const target = clinicClinicianFilter.toLowerCase();
    return allClinicPatients.filter(
      (p) => (p.clinicianName ?? "").toLowerCase() === target,
    );
  }, [allClinicPatients, clinicClinicianFilter]);

  const selected = useMemo(() => patients.find((p) => p.patientScreeningId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  const traySelectedPatient = useMemo(
    () =>
      selected && typeof selected.patientScreeningId === "number"
        ? {
            patientScreeningId: selected.patientScreeningId,
            name: selected.name ?? "",
            email: (selected as { email?: string | null }).email ?? null,
          }
        : null,
    [selected],
  );

  const trayTeamTasks = useMemo(
    () =>
      [...(tasksData?.urgent ?? []), ...(tasksData?.open ?? [])].map((t) => ({
        id: t.id,
        title: t.title,
      })),
    [tasksData],
  );

  useEffect(() => {
    if (!selectedPatientId && patients.length > 0 && patients[0].patientScreeningId != null) {
      setSelectedPatientId(patients[0].patientScreeningId);
    }
  }, [patients, selectedPatientId]);

  const RoleIcon = role === "technician" ? Stethoscope : HeartHandshake;
  // Visible header title — prefer the workspace-level label (PCS / ACS)
  // when provided; otherwise fall back to the legacy role label so existing
  // direct mounts continue to look the same.
  const title =
    workspaceLabel ??
    (role === "technician" ? "Technician Portal" : "Liaison Technician Portal");
  const subtitle = role === "technician"
    ? "Run today's tests · sign consents · upload chart docs"
    : "";

  function openCenterMode(mode: CenterMode, url: string | null, label: string) {
    if (!url) return;
    setCenterMode(mode);
    setCenterSrc(url);
    setCenterTitle(label);
  }

  function openPatientChart(p: TodayPatient) {
    if (p.patientScreeningId == null) return;
    openCenterMode("patientChart", `/patient-database#patient-${p.patientScreeningId}`, `Chart — ${p.name}`);
  }

  function openConsentPane(p: TodayPatient) {
    if (p.patientScreeningId != null) {
      setSelectedPatientId(p.patientScreeningId);
    }
    setCenterMode("consent");
  }

  function togglePatientInPlayground(p: TodayPatient) {
    // Open/focus patient EHR via Playground workspace engine.
    if (p.patientScreeningId != null) {
      dispatchOpenWorkspace({
        type: "patient_ehr",
        title: p.name,
        patientScreeningId: p.patientScreeningId,
        facilityId: p.facility,
      });
    }
  }

  function openScheduleDialog(p: TodayPatient) {
    if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
    setScheduleDialogPatient(p);
  }

  function openSchedulePatientDialog(
    input: SchedulePatientDialogPatient,
    opts?: { date?: string | null; time?: string | null },
  ) {
    if (input.patientScreeningId != null) setSelectedPatientId(input.patientScreeningId);
    setSchedulePatientDialogDefaultDate(opts?.date ?? null);
    setSchedulePatientDialogDefaultTime(opts?.time ?? null);
    setSchedulePatientDialog(input);
    // Persist the patient as the active scheduling context so the
    // left-rail PatientMiniCalendar switches its header to
    // "Scheduling: <name>" and the date picker is patient-scoped.
    setSelectedPatientForScheduling(input);
  }

  function openSchedulePatientPlayground(payload: {
    patient: SchedulePatientDialogPatient;
    selectedDate: string;
    ancillaries?: AncillaryServiceContext[];
  }) {
    if (payload.patient.patientScreeningId != null) {
      setSelectedPatientId(payload.patient.patientScreeningId);
    }
    setSchedulePatientPlaygroundContext(payload);
    setSchedulePatientDialog(null);
    setCenterMode("playground");
    setDockActiveApp(null);
  }

  // --- Right-panel call-list tile actions ------------------------------
  // Map a call-list row into the shared SchedulePatientDialogPatient shape
  // so the calendar/schedule + playground flows can reuse it.
  function callRowToDialogPatient(
    row: TeamWorkspaceCallListItem,
  ): SchedulePatientDialogPatient {
    return {
      patientName: row.patientName ?? null,
      patientDob: row.patientDob ?? null,
      facilityId: row.facilityId ?? facility ?? null,
      patientScreeningId: row.patientScreeningId ?? null,
      executionCaseId:
        row.executionCaseId ??
        (typeof row.id === "number" ? row.id : null),
      serviceType: row.selectedServices?.[0] ?? null,
      callReason: deriveCallReason(row),
      nextActionAt: row.nextActionAt ?? null,
    };
  }

  // Patient name click → pull the patient into the center Playground
  // (Patient Command Canvas) instead of navigating away. When the row has
  // no real screening id we fall back to the scheduling playground so the
  // case still opens in-place.
  function openCallRowPatient(row: TeamWorkspaceCallListItem) {
    if (typeof row.patientScreeningId === "number" && row.patientScreeningId > 0) {
      // Open (or focus) patient EHR via the Playground workspace engine and
      // request one-shot service focus on the Ancillary Journey section. When
      // the tab already exists, the provider bumps its focusToken so the chart
      // re-scrolls/highlights without duplicating the workspace.
      dispatchOpenWorkspace({
        type: "patient_ehr",
        title: row.patientName ?? "Patient",
        patientScreeningId: row.patientScreeningId,
        executionCaseId: row.executionCaseId ?? null,
        ancillaryCaseId: row.ancillaryCaseId ?? null,
        serviceKey: row.selectedServices?.[0] ?? null,
        facilityId: row.facilityId ?? facility ?? null,
        focusSection: "ancillary-journey",
      });
      return;
    }
    pushCallRowToPlayground(row);
  }

  // Push a call-list case into the detailed Playground workspace, preserving
  // patient/case identity + scheduling context.
  function pushCallRowToPlayground(row: TeamWorkspaceCallListItem) {
    openSchedulePatientPlayground({
      patient: callRowToDialogPatient(row),
      selectedDate,
    });
  }

  // Open (or focus) the ACS ancillary WORKFLOW workspace for a scheduled
  // ancillary row — the consent/screening/report surface centered on this
  // service. Deduped per execution case + service by the Playground registry.
  // Preserves canonical IDs; falls back to the scheduling playground only when
  // there is no patient identity to open a workflow against.
  function openAncillaryWorkflow(row: TeamWorkspaceAncillaryAppointment) {
    if (row.patientScreeningId != null || row.executionCaseId != null) {
      dispatchOpenWorkspace({
        type: "ancillary_workflow",
        title: row.patientName ?? "Ancillary",
        patientScreeningId: row.patientScreeningId ?? null,
        executionCaseId: row.executionCaseId ?? null,
        serviceKey: row.serviceType ?? null,
        facilityId: row.facilityId ?? facility ?? null,
      });
      return;
    }
    // Walk-in / unlinked row — no canonical patient to open a workflow on.
    openSchedulePatientPlayground({
      patient: {
        patientName: row.patientName ?? null,
        patientDob: row.patientDob ?? null,
        facilityId: row.facilityId ?? null,
        patientScreeningId: row.patientScreeningId ?? null,
        executionCaseId: row.executionCaseId ?? null,
        serviceType: row.serviceType ?? null,
      },
      selectedDate,
      ancillaries: ancillariesByPatient.get(ancillaryPatientKey(row)),
    });
  }

  // Map a call-list row into the shared CallCaseContext consumed by the
  // Call / Schedule / Case Overview Playground tabs.
  function callRowToCaseContext(row: TeamWorkspaceCallListItem): CallCaseContext {
    return {
      patientScreeningId: row.patientScreeningId ?? null,
      executionCaseId:
        row.executionCaseId ?? (typeof row.id === "number" ? row.id : null),
      patientName: row.patientName ?? "Patient",
      patientDob: row.patientDob ?? null,
      facilityId: row.facilityId ?? facility ?? null,
      callReason: deriveCallReason(row),
      targetServices: (row.selectedServices ?? []).filter(Boolean),
      // Phase 2E-B3 — EXACT ancillary-case identity only when the row carries
      // it unambiguously (one case = one service). A multi-service execution
      // case has no single ancillaryCaseId here, so it stays null and the
      // canonical document summary renders nothing (no screening-wide fallback,
      // no first/newest guessing).
      ancillaryCaseId: row.ancillaryCaseId ?? null,
      serviceType: (row.selectedServices ?? []).filter(Boolean)[0] ?? null,
      sourcePortal: (workspaceCallListContext ?? "acs").toUpperCase(),
      engagementStatus: row.engagementStatus ?? null,
      lifecycleStatus: row.lifecycleStatus ?? null,
    };
  }

  // Open (or focus) a call-list Playground workflow tab. Each kind keeps a
  // stable id per patient/case so re-clicking the same action focuses the
  // existing tab instead of duplicating it. Multiple kinds for the same
  // patient stay open side-by-side ("John Smith - Call" / "- Schedule").
  function openCaseTab(
    kind: "call" | "caseSchedule" | "caseOverview",
    ctx: CallCaseContext,
  ) {
    const identity =
      ctx.patientScreeningId != null
        ? `p${ctx.patientScreeningId}`
        : ctx.executionCaseId != null
          ? `c${ctx.executionCaseId}`
          : ctx.patientName;
    const id = `${kind}:${identity}`;
    const suffix =
      kind === "call" ? "Call" : kind === "caseSchedule" ? "Schedule" : "Case";
    const label = `${ctx.patientName} - ${suffix}`;

    const existing = portalTabs.find((t) => t.id === id);
    if (existing) {
      focusPortalTab(existing);
      return;
    }

    const tab: PortalTab = {
      id,
      kind,
      patientId: ctx.patientScreeningId ?? null,
      patientName: ctx.patientName,
      label,
      caseContext: ctx,
    };
    setPortalTabs((prev) => [...prev, tab]);
    focusPortalTab(tab);
  }

  function expandScheduleToPlayground(p: TodayPatient) {
    if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
    setCenterMode("scheduleDay");
    setCenterSrc(p.scheduleUrl || "about:blank");
    setCenterTitle(`Schedule — ${p.name}`);
    setScheduleDialogPatient(null);
    markDockOpen("schedule");
  }

  function focusPortalTab(tab: PortalTab | null) {
    if (!tab) {
      setActivePortalTabId(null);
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      setDockActiveApp(null);
      return;
    }

    setActivePortalTabId(tab.id);

    // The schedulePatientPlaygroundContext branch renders BEFORE the
    // tab switch in the center JSX, so it must be cleared whenever we
    // focus a tab or the tab content would be hidden behind it.
    setSchedulePatientPlaygroundContext(null);

    if (tab.patientId != null) {
      setSelectedPatientId(tab.patientId);
    }

    // Call-list Playground workflow tabs (Call / Schedule / Case) all
    // route through the playground surface; the center JSX branches on
    // tab.kind + tab.caseContext.
    if (
      tab.kind === "call" ||
      tab.kind === "caseSchedule" ||
      tab.kind === "caseOverview"
    ) {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle(tab.label);
      setDockActiveApp(null);
      if (tab.caseContext?.patientScreeningId != null) {
        setSelectedPatientId(tab.caseContext.patientScreeningId);
      }
      return;
    }

    if (tab.kind === "patient") {
      setCenterMode("patient");
      setCenterSrc("");
      setCenterTitle("");
      markDockOpen("chart");
      return;
    }

    if (tab.kind === "schedule") {
      const patient = patients.find((x) => x.patientScreeningId === tab.patientId) ?? null;
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle(`Schedule — ${patient?.name ?? "Patient"}`);
      if (patient?.patientScreeningId != null) {
        setSelectedPatientId(patient.patientScreeningId);
      }
      markDockOpen("schedule");
      return;
    }

    if (tab.kind === "tasks") {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("Tasks");
      markDockOpen("tasks");
      return;
    }

    if (tab.kind === "documents") {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("Documents");
      markDockOpen("documents");
      return;
    }

    // New command-center tab kinds. The center routes them all through
    // the playground/canvas surface; rendering branches on tab.kind in
    // the playground-home JSX below.
    if (
      tab.kind === "myPatients" ||
      tab.kind === "patientSearch" ||
      tab.kind === "plexusTasks" ||
      tab.kind === "marketing"
    ) {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle(tab.label);
      setDockActiveApp(null);
    }
  }

  /**
   * @deprecated LEGACY center-tab launcher. DO NOT USE FOR NEW WORKSPACE
   * NAVIGATION. Zero callers remain; new navigation goes through
   * dispatchOpenWorkspace() into the Playground engine. Retained only until
   * the legacy helper chain is deleted.
   */
  function openPortalTab(kind: PortalTabKind, patient?: TodayPatient | null) {
    const id =
      kind === "patient" || kind === "schedule"
        ? `${kind}:${patient?.patientScreeningId ?? patient?.name ?? "unknown"}`
        : kind;

    const label =
      kind === "patient"
        ? `${patient?.name ?? "Patient"} - Patient`
        : kind === "schedule"
          ? `Schedule · ${patient?.name ?? "Patient"}`
          : kind === "tasks"
            ? "Tasks"
            : kind === "myPatients"
              ? "My Patients"
              : kind === "patientSearch"
                ? "Patient Search"
                : kind === "plexusTasks"
                  ? "Plexus Tasks"
                  : kind === "marketing"
                    ? "Marketing"
                    : kind === "calls"
                      ? "Calls"
                      : kind === "invoiceDesk"
                        ? "Invoice Desk"
                        : "Documents";

    const existing = portalTabs.find((t) => t.id === id);
    if (existing) {
      if (activePortalTabId === existing.id) {
        closePortalTab(existing.id);
      } else {
        focusPortalTab(existing);
      }
      return;
    }

    const tab: PortalTab = {
      id,
      kind,
      patientId: patient?.patientScreeningId ?? null,
      patientName: patient?.name,
      label,
    };

    setPortalTabs((prev) => [...prev, tab]);
    focusPortalTab(tab);
  }

  // Open / focus a Patient Command Canvas tab keyed by patientScreeningId.
  // Used by Patient Search + My Patients click handlers so we never
  // duplicate the same patient tab.
  function openPatientTabById(input: {
    patientScreeningId: number;
    name: string;
    facility?: string | null;
  }) {
    // Route through the Playground workspace engine.
    dispatchOpenWorkspace({
      type: "patient_ehr",
      title: input.name,
      patientScreeningId: input.patientScreeningId,
      facilityId: input.facility ?? null,
    });
  }

  function closePortalTab(id: string) {
    setPortalTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      const closingActive = activePortalTabId === id;

      if (!closingActive) {
        return next;
      }

      const fallback = next[next.length - 1] ?? null;

      if (!fallback) {
        setActivePortalTabId(null);
        setCenterMode("playground");
        setCenterSrc("");
        setCenterTitle("");
        setDockActiveApp(null);
        return next;
      }

      setTimeout(() => focusPortalTab(fallback), 0);
      return next;
    });
  }

  function openCalendarInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("schedule") ? prev : [...prev, "schedule"]));
    setDockActiveApp("schedule");
    setCenterSrc("");
    setCenterTitle(`Calendar — ${facility ? `${facility} · ${selectedDate}` : selectedDate}`);
  }

  function openTasksInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("tasks") ? prev : [...prev, "tasks"]));
    setDockActiveApp("tasks");
    setCenterSrc("");
    setCenterTitle("Tasks");
  }

  function openDocumentsInPlayground() {
    setCenterMode("playground");
    setDockOpenApps((prev) => (prev.includes("documents") ? prev : [...prev, "documents"]));
    setDockActiveApp("documents");
    setCenterSrc("");
    setCenterTitle("Documents");
  }

  // ── Task #643 — Tools workspace helpers ──────────────────────────
  // Current patient context carried onto new widgets / the tray, derived
  // from the selected patient. Never fabricated.
  function currentWidgetContext(): WidgetPatientContext {
    if (!selected) return null;
    return {
      patientScreeningId: selected.patientScreeningId ?? null,
      name: selected.name ?? null,
    };
  }

  // Calendar tool action honours the Settings preference. Default (task
  // #698) is the Quick Schedule pop-up; "playground" is the opt-out that
  // opens the full calendar view instead.
  function handleCalendarTool() {
    if (workspacePrefs.calendarBehavior === "playground") {
      // Opt-out: open the calendar in the Playground, preserving the active
      // patient/case context (we never clear selectedPatientId here).
      setCenterMode("calendar");
      setCenterTitle(`Calendar — ${globalCalendarDate}`);
      return;
    }
    setCalendarQuickScheduleDate(globalCalendarDate);
  }

  // Task #698 — clicking a day on any portal calendar opens the Quick
  // Schedule pop-up pre-filled with that date, in addition to updating the
  // selected date for the work queue / day views.
  function openQuickScheduleForDate(date: string) {
    setGlobalCalendarDate(date);
    setCalendarQuickScheduleDate(date);
  }

  // Drop a fresh sticky note at the top of the Playground.
  function addStickyNote() {
    if (!workspacePrefs.stickyNotesVisible) {
      updateWorkspacePref("stickyNotesVisible", true);
    }
    addPlaygroundWidget({ type: "sticky", patientContext: currentWidgetContext() });
  }

  // Drag-and-drop: a tool tile dropped on the Playground surface spawns a
  // widget of that type at the drop point, preserving patient context +
  // logged-in user.
  function handlePlaygroundDrop(e: React.DragEvent<HTMLDivElement>) {
    const type = e.dataTransfer.getData(WIDGET_DND_MIME) as PlaygroundWidgetType | "";
    if (!type) return;
    e.preventDefault();
    if (!workspacePrefs.stickyNotesVisible) {
      updateWorkspacePref("stickyNotesVisible", true);
    }
    const rect = playgroundSurfaceRef.current?.getBoundingClientRect();
    const x = rect ? Math.max(0, e.clientX - rect.left - 40) : 24;
    const y = rect ? Math.max(0, e.clientY - rect.top - 16) : 16;
    addPlaygroundWidget({ type, x, y, patientContext: currentWidgetContext() });
  }

  function handlePlaygroundDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes(WIDGET_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function markDockOpen(app: "tasks" | "schedule" | "consent" | "chart" | "documents") {
    setDockOpenApps((prev) => (prev.includes(app) ? prev : [...prev, app]));
    setDockActiveApp(app);
  }

  function toggleDockApp(app: "tasks" | "schedule" | "consent" | "chart" | "documents") {
    if (dockActiveApp === app) {
      setDockOpenApps((prev) => prev.filter((x) => x !== app));
      setDockActiveApp(null);
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    setDockOpenApps((prev) => (prev.includes(app) ? prev : [...prev, app]));
    setDockActiveApp(app);

    if (app === "tasks" || app === "documents") {
      setCenterMode("playground");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    if (!selected) {
      setCenterMode("playground");
      return;
    }

    if (app === "chart") {
      setCenterMode("patient");
      setCenterSrc("");
      setCenterTitle("");
      return;
    }

    if (app === "consent") {
      setCenterMode("consent");
      return;
    }

    if (app === "schedule") {
      expandScheduleToPlayground(selected);
    }
  }

  return (
    <DockOwnershipProvider>
    <PlaygroundWorkspaceProvider>
    <PlaygroundEventListener />
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-white" data-testid={`portal-${role}`} data-team-portal-shell="true">
      {/* Slim light top strip (task #628). Replaces the heavy dark banner so the
          reclaimed space reads as usable canvas. Left: "The Playground" wordmark
          in a cursive script font, blue. Right: the existing Clinic selector,
          Calendar button, and (admins only) the "Viewing as" selector — all
          unchanged in behavior + test ids. */}
      <header className="relative z-20 flex items-center justify-between gap-4 flex-wrap px-6 py-2" style={{ backgroundColor: "#FAFBF8" }}>
        <div className="flex items-center gap-3">
          <span
            className="text-[30px] font-semibold leading-none text-[#2563EB]"
            style={{ fontFamily: '"Dancing Script", cursive' }}
            data-testid="text-portal-title"
          >
            The Playground
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* ADMIN VIEW-AS selector — only rendered for admins. The
               list contains active users with the workspace role
               (PCS→liaison, ACS→technician). Selecting a team
               member narrows feeds + facility allow-list; admin
               identity is preserved for audit/writes. */}
          {isAdmin && (
            <div
              className="flex items-center gap-2"
              data-testid="admin-viewas-selector-wrap"
            >
              <Label
                htmlFor="admin-viewas-team-member-select"
                className="text-xs text-slate-600"
                data-testid="admin-viewas-label"
              >
                Viewing as
              </Label>
              <SketchSelect
                id="admin-viewas-team-member-select"
                seedId="admin-viewas"
                value={viewAsTeamMemberId ?? "__self__"}
                onChange={(e) =>
                  setViewAsTeamMemberId(e.target.value === "__self__" ? null : e.target.value)
                }
                data-testid="admin-viewas-team-member-select"
              >
                <option value="__self__" data-testid="admin-viewas-option-self">
                  Admin (self)
                </option>
                {viewAsCandidates.map((u) => (
                  <option
                    key={u.id}
                    value={u.id}
                    data-testid={`admin-viewas-option-${u.id}`}
                  >
                    {u.username}{u.facility ? ` · ${u.facility}` : ""}{typeof u.dailyTarget === "number" ? ` · target ${u.dailyTarget}` : ""}
                  </option>
                ))}
              </SketchSelect>
            </div>
          )}
          <Label htmlFor="facility-select" className="text-xs text-slate-600">Clinic</Label>
          <SketchSelect
            id="facility-select"
            seedId="facility"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            data-testid="select-facility"
          >
            {facility === "" && (
              <option value="" disabled>
                {facilities.length === 0 ? "No clinic assignments" : "Choose clinic"}
              </option>
            )}
            {facilities.map((f) => <option key={f} value={f}>{f}</option>)}
          </SketchSelect>
          <SketchButton
            variant="icon"
            size="sm"
            seedId="team-portal-calendar"
            onClick={() => setTeamPortalCalendarOpen(true)}
            aria-label="Open team portal calendar"
            title="Open team portal calendar"
            data-testid="button-team-portal-main-calendar"
          >
            <CalendarIcon className="h-4 w-4" />
          </SketchButton>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0">
          {/* One continuous paper background — no alternating white/tan bands. */}
          <div className="absolute inset-0" style={{ backgroundColor: "#FAFBF8" }} />
        </div>

        <div className="absolute inset-0 z-[1] overflow-auto px-6 py-5">
          <div
            ref={playgroundSurfaceRef}
            className="relative mx-auto flex h-full min-h-full w-full flex-col bg-transparent px-6 pt-2 pb-6"
            data-testid="playground-canvas-surface"
            onDragOver={handlePlaygroundDragOver}
            onDrop={handlePlaygroundDrop}
          >
            {workspacePrefs.stickyNotesVisible && (
              <PlaygroundWidgetLayer
                widgets={playgroundWidgets}
                onMove={(id, x, y) => updatePlaygroundWidget(id, { x, y })}
                onUpdate={updatePlaygroundWidget}
                onRemove={removePlaygroundWidget}
                onOpenEmail={(ctx) => {
                  if (ctx?.patientScreeningId) {
                    setSelectedPatientId(ctx.patientScreeningId);
                  }
                  dispatchOpenWorkspace({ type: "email", title: "Email" });
                }}
              />
            )}
            {/* Playground workspace engine — takes over center when workspaces are open */}
            <PlaygroundBridge />
            {portalTabs.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1" data-testid="portal-playfield-tabs">
                {portalTabs.map((tab) => {
                  const isActive = tab.id === activePortalTabId;
                  return (
                    <div
                      key={tab.id}
                      className={`group inline-flex items-center gap-1 rounded-t-xl border px-3 py-1.5 text-xs transition ${
                        isActive
                          ? "border-indigo-300 bg-white text-indigo-700 shadow-sm"
                          : "border-slate-200 bg-white/60 text-slate-600 hover:bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => focusPortalTab(tab)}
                        className="font-medium truncate max-w-[180px]"
                        data-testid={`portal-tab-${tab.id}`}
                      >
                        {tab.label}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); closePortalTab(tab.id); }}
                        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        data-testid={`portal-tab-close-${tab.id}`}
                        title="Close tab"
                      >
                        <Minimize2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* @deprecated LEGACY CENTER RENDERER — DEAD CODE behind PlaygroundBridge.
                Hidden via `hidden` so it never displays (the Playground engine
                above is the sole center) while remaining type-identical. Retained
                temporarily; delete with the rest of the legacy center state. */}
            <div className="hidden min-h-0 flex-1 gap-4 overflow-hidden" aria-hidden="true">
              <div className={workspacePrefs.playgroundLayout === "split" ? "min-w-0 basis-1/2 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto"}>
              {centerMode === "calendar" ? (
                <div
                  className="h-full rounded-[28px] bg-white p-4 shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-y-auto"
                  data-testid="playground-calendar"
                >
                  <CanonicalCommandCalendar
                    mode="inline"
                    profileId={teamPortalCalendarProfileId}
                    title="Calendar"
                    cells={teamPortalCalendarCells}
                    onSelectDate={(d) => setSelectedDate(d)}
                  />
                </div>
              ) : centerMode === "chat" ? (
                <div
                  className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.12)]"
                  data-testid="playground-chat"
                >
                  <CommunicationTray
                    activeTab={trayTab}
                    onTabChange={setTrayTab}
                    currentUserId={currentUser?.id ?? null}
                    teamTasks={trayTeamTasks}
                    directUnread={directUnread}
                    expanded
                    focusNonce={chatFocusNonce}
                    onCollapse={() => setCenterMode("playground")}
                    directActiveUserId={chatDirectActiveUserId}
                    onDirectActiveUserIdChange={setChatDirectActiveUserId}
                    teamActiveTaskId={chatTeamActiveTaskId}
                    onTeamActiveTaskIdChange={setChatTeamActiveTaskId}
                  />
                </div>
              ) : centerMode === "consent" && selected ? (
                <div className="h-full rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.12)] overflow-y-auto" data-testid="expanded-consent">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-semibold">Consent — {selected.name}</div>
                      <div className="text-sm text-slate-500">{selected.facility} · {formatTime(selected.time)}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setCenterMode("patient")} data-testid="consent-close">
                      <Minimize2 className="h-3.5 w-3.5 mr-1" /> Back to chart
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selected.consentByTest.map((c) => (
                      <Card key={c.testType} className="p-3 flex items-center justify-between bg-white/90" data-testid={`consent-pane-row-${c.testType}`}>
                        <div className="font-medium">{c.testType}</div>
                        {c.signed ? (
                          <Badge className="bg-emerald-100 text-emerald-700">
                            <Check className="h-3 w-3 mr-1" /> Consent ✓
                          </Badge>
                        ) : (
                          <Button size="sm" onClick={() => setConsentDialog({ patient: selected, testType: c.testType })} data-testid={`consent-pane-sign-${c.testType}`}>
                            <FileSignature className="h-3.5 w-3.5 mr-1" /> Sign now
                          </Button>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              ) : centerMode !== "patient" && centerMode !== "playground" && centerSrc ? (
                <div className="h-full min-h-[70vh]">
                  <ExpandedSectionView mode={centerMode} src={centerSrc} title={centerTitle} onClose={() => setCenterMode("playground")} />
                </div>
              ) : centerMode === "patient" && selected ? (
                <div className="h-full rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-y-auto">
                  <PatientDetail
                    patient={selected}
                    role={role}
                    onConsent={(testType) => setConsentDialog({ patient: selected, testType })}
                  />
                </div>
              ) : schedulePatientPlaygroundContext ? (
                <div className="h-full" data-testid="playground-schedule-patient">
                  <SchedulePatientPlayground
                    key={`sp-pg-${
                      schedulePatientPlaygroundContext.patient.patientScreeningId ??
                      schedulePatientPlaygroundContext.patient.executionCaseId ??
                      schedulePatientPlaygroundContext.patient.patientName ??
                      "patient"
                    }-${schedulePatientPlaygroundContext.selectedDate}`}
                    patient={schedulePatientPlaygroundContext.patient}
                    selectedDate={schedulePatientPlaygroundContext.selectedDate}
                    ancillaries={schedulePatientPlaygroundContext.ancillaries}
                    onClose={() => setSchedulePatientPlaygroundContext(null)}
                  />
                </div>
              ) : (() => {
                // Command-center tab kinds render their own component
                // inside the playground area. Patient tabs route to the
                // canonical PatientCommandCanvas when the active patient
                // has a real patientScreeningId; legacy demo/Today
                // patient flow continues below.
                const activeTab = portalTabs.find((t) => t.id === activePortalTabId);
                if (activeTab?.kind === "myPatients") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-my-patients">
                      <PortalMyPatientsTab
                        onSelectPatient={(row) =>
                          openPatientTabById({
                            patientScreeningId: row.patientScreeningId,
                            name: row.name,
                            facility: row.facility,
                          })
                        }
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "patientSearch") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-patient-search">
                      <PortalPatientSearchTab
                        onSelectPatient={(row) =>
                          openPatientTabById({
                            patientScreeningId: row.patientScreeningId,
                            name: row.name,
                            facility: row.facility,
                          })
                        }
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "marketing") {
                  const sel = selected
                    ? {
                        patientScreeningId: selected.patientScreeningId ?? 0,
                        name: selected.name,
                        email: null as string | null,
                      }
                    : null;
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-marketing">
                      <PortalMarketingTab
                        selectedPatient={
                          sel && sel.patientScreeningId > 0 ? sel : null
                        }
                        onComposeEmailWithMaterials={(ids) => {
                          // Marketing → Email handoff: stage the picked
                          // material ids and switch the active tab to
                          // the Email Composer. The composer adopts the
                          // attachments via the prop bridge.
                          setPendingEmailTemplate(null);
                          setPendingEmailAttachments(ids);
                          dispatchOpenWorkspace({ type: "email", title: "Email" });
                        }}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "plexusTasks") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-plexus-tasks">
                      <PortalPlexusTasksTab
                        patientScreeningId={selected?.patientScreeningId ?? null}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "email") {
                  const sel = selected
                    ? {
                        patientScreeningId: selected.patientScreeningId ?? 0,
                        name: selected.name,
                        email: null as string | null,
                      }
                    : null;
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-email-composer">
                      <PortalEmailComposerTab
                        selectedPatient={
                          sel && sel.patientScreeningId > 0 ? sel : null
                        }
                        preAttachedMaterialIds={pendingEmailAttachments}
                        onClearPreAttached={() => setPendingEmailAttachments(null)}
                        prefilledTemplate={pendingEmailTemplate}
                        onClearPrefilledTemplate={() => setPendingEmailTemplate(null)}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "resources") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-templates-resources">
                      <PortalTemplatesResourcesTab
                        onInsertIntoComposer={(tpl) => {
                          // Hand off to the Email Composer with the
                          // template's subject/body. The composer
                          // resets attachments because templates and
                          // marketing brochures are mutually exclusive
                          // send paths.
                          setPendingEmailAttachments([]);
                          setPendingEmailTemplate(tpl);
                          dispatchOpenWorkspace({ type: "email", title: "Email" });
                        }}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "documentLibrary") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-document-library">
                      <PortalDocumentLibraryTab />
                    </div>
                  );
                }
                if (activeTab?.kind === "quickNote") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-quick-note">
                      <QuickNoteTool />
                    </div>
                  );
                }
                if (activeTab?.kind === "internalContacts") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-internal-contacts">
                      <InternalContactsTool />
                    </div>
                  );
                }
                if (activeTab?.kind === "calls") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-calls-repository">
                      <CallsRepositoryPanel facility={facility} />
                    </div>
                  );
                }
                if (activeTab?.kind === "invoiceDesk") {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-invoice-desk">
                      <InvoiceDeskPanel />
                    </div>
                  );
                }
                // Call-list Playground workflow tabs.
                if (activeTab?.kind === "call" && activeTab.caseContext) {
                  const ctx = activeTab.caseContext;
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-call-workspace">
                      <CallWorkspace
                        ctx={ctx}
                        onScheduleCase={() => openCaseTab("caseSchedule", ctx)}
                        onOpenCase={() => openCaseTab("caseOverview", ctx)}
                        onClose={() => activePortalTabId && closePortalTab(activePortalTabId)}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "caseSchedule" && activeTab.caseContext) {
                  const ctx = activeTab.caseContext;
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-scheduling-workspace">
                      <SchedulingWorkspace
                        ctx={ctx}
                        facility={ctx.facilityId ?? facility}
                        selectedDate={selectedDate}
                        onClose={() => activePortalTabId && closePortalTab(activePortalTabId)}
                      />
                    </div>
                  );
                }
                if (activeTab?.kind === "caseOverview" && activeTab.caseContext) {
                  const ctx = activeTab.caseContext;
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-case-overview">
                      <SelectedCaseOverview
                        ctx={ctx}
                        onCall={() => openCaseTab("call", ctx)}
                        onSchedule={() => openCaseTab("caseSchedule", ctx)}
                        onOpenPatient={() => {
                          if (ctx.patientScreeningId != null && ctx.patientScreeningId > 0) {
                            openPatientTabById({
                              patientScreeningId: ctx.patientScreeningId,
                              name: ctx.patientName,
                              facility: ctx.facilityId,
                            });
                          }
                        }}
                        onClose={() => activePortalTabId && closePortalTab(activePortalTabId)}
                      />
                    </div>
                  );
                }
                // Canonical command canvas for any patient tab whose
                // patient id maps to a real patientScreeningId.
                if (
                  activeTab?.kind === "patient" &&
                  typeof activeTab.patientId === "number" &&
                  activeTab.patientId > 0
                ) {
                  return (
                    <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-hidden" data-testid="playground-patient-directory">
                      <PortalPatientDirectory
                        patientScreeningId={activeTab.patientId}
                        seedName={activeTab.patientName ?? activeTab.label}
                        onBack={() => activePortalTabId && closePortalTab(activePortalTabId)}
                        onSchedule={() =>
                          openSchedulePatientDialog({
                            patientName: activeTab.patientName ?? activeTab.label ?? null,
                            patientDob: null,
                            facilityId: facility ?? null,
                            patientScreeningId:
                              typeof activeTab.patientId === "number" ? activeTab.patientId : null,
                            executionCaseId: null,
                            serviceType: null,
                          })
                        }
                      />
                    </div>
                  );
                }
                return null;
              })() || (
                <div className="h-full rounded-[28px] bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] overflow-y-auto" data-testid="playground-home">
                  {dockActiveApp === "schedule" ? (
                    <div className="p-6">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xl font-semibold text-slate-900">Calendar</div>
                          <div className="text-sm text-slate-500">Expanded clinic calendar workspace for {facility ? `${facility}` : "this clinic"}.</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-4 py-3 text-right">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Selected Date</div>
                          <div className="text-sm font-semibold text-slate-900">{selectedDate}</div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                        <Card className="p-4 bg-white">
                          <div className="mb-3 text-sm font-semibold text-slate-900">Monthly Calendar</div>
                          <MonthlyMiniCalendar
                            facility={facility}
                            selectedDate={selectedDate}
                            onSelect={(d) => {
                              setSelectedDate(d);
                              setCenterMode("playground");
                              setDockOpenApps((prev) => (prev.includes("schedule") ? prev : [...prev, "schedule"]));
                              setDockActiveApp("schedule");
                              // Task #698 — day click also opens the Quick
                              // Schedule pop-up pre-filled with that date.
                              openQuickScheduleForDate(d);
                            }}
                          />
                        </Card>

                        <div className="space-y-4">
                          <Card className="p-4 bg-white">
                            <div className="text-sm font-semibold text-slate-900 mb-2">Clinic Day Summary</div>
                            <div className="space-y-2 text-sm text-slate-600">
                              <div><span className="font-medium text-slate-900">Clinic:</span> {facility ? facility : "—"}</div>
                              <div><span className="font-medium text-slate-900">Date:</span> {selectedDate}</div>
                              <div><span className="font-medium text-slate-900">Scheduled Patients:</span> {patients.length}</div>
                              <div><span className="font-medium text-slate-900">Selected Patient:</span> {selected ? selected.name : "None"}</div>
                            </div>
                          </Card>

                          <Card className="p-4 bg-white">
                            <div className="text-sm font-semibold text-slate-900 mb-2">Ancillary Schedule Context</div>
                            <div className="space-y-2">
                              {patients.length === 0 ? (
                                <div className="text-sm text-slate-500">No patients scheduled for this day.</div>
                              ) : (
                                patients.slice(0, 6).map((patient) => (
                                  <div key={(patient.patientScreeningId ?? patient.name) + "-calendar-summary"} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="text-sm font-medium text-slate-900">{patient.name}</div>
                                    <div className="text-xs text-slate-500">
                                      {formatTime(patient.time)} · {patient.appointments.length} test{patient.appointments.length === 1 ? "" : "s"}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </Card>

                          <Card className="p-4 bg-white">
                            <div className="text-sm font-semibold text-slate-900 mb-2">Calendar Actions</div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCenterMode("playground")}
                              >
                                Stay in Playground
                              </Button>
                              {selected ? (
                                <Button
                                  size="sm"
                                  onClick={() => expandScheduleToPlayground(selected)}
                                >
                                  Open Selected Patient Schedule
                                </Button>
                              ) : null}
                            </div>
                          </Card>
                        </div>
                      </div>
                    </div>
                  ) : dockActiveApp === "tasks" ? (
                    <div className="p-6">
                      <div className="mb-4 text-xl font-semibold text-slate-900">Tasks</div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Urgent Tasks</div>
                          {(tasksData?.urgent ?? []).length === 0 ? (
                            <div className="text-sm text-slate-500">No urgent tasks.</div>
                          ) : (
                            <div className="space-y-2">
                              {(tasksData?.urgent ?? []).map((t) => (
                                <div key={t.id} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                                  <div className="text-sm font-medium text-slate-900">{t.title}</div>
                                  <div className="text-xs text-rose-700">{t.taskType} · {t.urgency}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Open Tasks</div>
                          {(tasksData?.open ?? []).length === 0 ? (
                            <div className="text-sm text-slate-500">No open tasks.</div>
                          ) : (
                            <div className="space-y-2">
                              {(tasksData?.open ?? []).map((t) => (
                                <div key={t.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                  <div className="text-sm font-medium text-slate-900">{t.title}</div>
                                  <div className="text-xs text-slate-500">{t.taskType}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </Card>
                      </div>
                    </div>
                  ) : dockActiveApp === "documents" ? (
                    <div className="p-6">
                      <div className="mb-4 text-xl font-semibold text-slate-900">Documents</div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Selected Patient Documents</div>
                          {selected ? (
                            <div className="text-sm text-slate-600">Use Plexus Atlas, Clinician Atlas, screening, and consent actions from the right rail or patient profile.</div>
                          ) : (
                            <div className="text-sm text-slate-500">Select a patient to work with documents.</div>
                          )}
                        </Card>
                        <Card className="p-4 bg-white">
                          <div className="text-sm font-semibold text-slate-900 mb-2">Clinic Day Context</div>
                          <div className="text-sm text-slate-600">{facility ? `${facility} · ${selectedDate}` : "Choose your clinic to get started."}</div>
                        </Card>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              </div>
              {workspacePrefs.playgroundLayout === "split" && (
                <div
                  className="hidden min-h-0 basis-1/2 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)] lg:flex"
                  data-testid="playground-split-panel"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <div className="text-xs font-semibold text-slate-700">Split panel · Communication</div>
                    <span className="text-[10px] text-slate-400">Split view</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <CommunicationTray
                      activeTab={trayTab}
                      onTabChange={setTrayTab}
                      currentUserId={currentUser?.id ?? null}
                      teamTasks={trayTeamTasks}
                      directUnread={directUnread}
                      focusNonce={chatFocusNonce}
                      onExpand={() => {
                        setCenterMode("chat");
                        setChatFocusNonce((n) => n + 1);
                      }}
                      directActiveUserId={chatDirectActiveUserId}
                      onDirectActiveUserIdChange={setChatDirectActiveUserId}
                      teamActiveTaskId={chatTeamActiveTaskId}
                      onTeamActiveTaskIdChange={setChatTeamActiveTaskId}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LEFT RAIL — conventional frosted-glass side panel, attached flush to
            the left edge, running full height between header and viewport. The
            wrapper is a fixed-width overlay; only the body's transform animates.
            Open = leftRailPinned || leftRailPeek. */}
        <div
          ref={leftRailRef}
          className={`pointer-events-none absolute left-0 top-0 bottom-0 z-30 flex flex-col ${LEFT_RAIL_WIDTH[leftRailSize]}`}
          data-testid="portal-left-rail"
        >
          {/* Stationary edge hotspot — the open trigger. Never moves, so the
              sliding body can't sweep past the cursor and quiver. Present only
              on hover-capable devices and only while the rail is closed. */}
          {!isTouchDevice && !leftRailOpen ? (
            <div
              className="pointer-events-auto absolute left-0 top-0 bottom-0 z-10 w-[10px]"
              onMouseEnter={makeRailHoverOpen(leftRailPeekTimer, setLeftRailPeek)}
              data-testid="portal-left-rail-hotspot"
              aria-hidden="true"
            />
          ) : null}
          {/* Body — frosted glass. Slides in/out via transform only (no scale,
              no opacity fade, no spring). Never unmounts, so filters / scroll /
              selected patient / tool state are preserved. */}
          <div
            onMouseEnter={
              isTouchDevice
                ? undefined
                : makeRailHoverOpen(leftRailPeekTimer, setLeftRailPeek)
            }
            onMouseLeave={
              isTouchDevice
                ? undefined
                : makeRailHoverClose(leftRailPeekTimer, setLeftRailPeek)
            }
            onClick={
              isTouchDevice
                ? () => {
                    // Tap the resting edge to reveal. When already revealed,
                    // taps inside fall through to content; dismissal is handled
                    // by the click-away listener so inner controls still work.
                    if (!leftRailPeek) setLeftRailPeek(true);
                  }
                : undefined
            }
            className={`portal-rail-glass min-h-0 flex-1 overflow-hidden text-slate-900 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              leftRailOpen
                ? "translate-x-0 pointer-events-auto"
                : "-translate-x-full pointer-events-none"
            }`}
            style={{ borderRadius: "0 14px 14px 0" }}
            aria-hidden={leftRailOpen ? undefined : true}
            {...(!leftRailOpen ? { inert: "" as unknown as boolean } : {})}
          >
            <div className="relative flex h-full flex-col">
            {/* Blue header band (step 1) — top-level tab switcher (Task #740).
                Messaging shows the iMessage-style inbox; Tools shows the
                existing dock + calendar + communication tray. */}
            <div
              className="flex items-center justify-between gap-1.5 border-b px-2 py-1.5"
              style={{ borderColor: "rgba(148,163,184,0.4)", backgroundColor: "#FAFBF8" }}
            >
              <div className="flex items-center gap-1" data-testid="left-panel-tabs">
                <button
                  type="button"
                  onClick={() => setLeftPanelTab("messaging")}
                  className={`relative inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                    leftPanelTab === "messaging"
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                  style={leftPanelTab === "messaging" ? { boxShadow: "inset 0 -2px 0 var(--sketch-blue)" } : undefined}
                  data-testid="left-panel-tab-messaging"
                >
                  <MessageCircle className="h-3 w-3" />
                  Messaging
                  {messagingUnread > 0 ? (
                    <span data-testid="left-panel-tab-messaging-badge">
                      <SketchBadge tone="violet">{messagingUnread}</SketchBadge>
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setLeftPanelTab("tools")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                    leftPanelTab === "tools"
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                  style={leftPanelTab === "tools" ? { boxShadow: "inset 0 -2px 0 var(--sketch-blue)" } : undefined}
                  data-testid="left-panel-tab-tools"
                >
                  <Wrench className="h-3 w-3" />
                  Tools
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLeftRailPinned((v) => !v)}
                aria-label={leftRailPinned ? "Unpin panel" : "Pin panel"}
                title={leftRailPinned ? "Unpin panel" : "Pin panel"}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${leftRailPinned ? "text-[color:var(--sketch-blue)]" : "text-slate-400 hover:text-slate-600"}`}
                data-testid="button-pin-left-rail"
              >
                {leftRailPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
              </button>
            </div>
            {leftPanelTab === "messaging" ? (
              <div className="flex min-h-0 flex-1 flex-col p-3" data-testid="left-rail-messaging">
                <PortalMessagesPanel
                  conversations={messagingConversations}
                  activeConversationId={messagesWindowOpen ? activeConversationId : null}
                  onOpenConversation={openMessagesConversation}
                />
              </div>
            ) : (
            (() => {
              // Active center-canvas tab kind so we can highlight the
              // matching left-rail tool. Single source of truth.
              const activeKind = portalTabs.find((t) => t.id === activePortalTabId)?.kind ?? null;
              const taskCount =
                (tasksData?.urgent?.length ?? 0) + (tasksData?.open?.length ?? 0);
              const leftNarrow = leftRailSize === "small";
              return (
              <div
                className={`flex min-h-0 flex-1 flex-col ${leftNarrow ? "p-2" : "p-3"}`}
                data-testid="left-rail-tools-rail"
              >
                {/*
                  Layout contract:
                  This container is `flex min-h-0 flex-1 flex-col`. It
                  hosts TWO children: the dock/calendar block (this div)
                  and the communication tray (below). Without an
                  explicit flex share on THIS child, its natural
                  content height would consume the entire rail and the
                  tray below (which has `flex-1 min-h-0`) would collapse
                  to zero px — the tray was mounted but hidden.
                  Setting `min-h-0 flex-1` here makes both children
                  share the vertical space (~50/50); `overflow-y-auto`
                  ensures the dock scrolls internally when its content
                  is taller than its share. The tray therefore always
                  has a real visible flex area.
                */}
                <div className={`min-h-0 flex-1 overflow-y-auto ${leftNarrow ? "space-y-2" : "space-y-3"}`}>
                {/* TEAM PORTAL LEFT TOOLS RAIL (Phase 1.6)
                    Shared general tools rail for PCS and ACS. The rail
                    is identical in both portals; only the work-context
                    feed (right rail + center canvas) varies. No
                    patient timeline, no patient profile, no Patient
                    Directory details, no DNC/cooldown detail, no
                    metrics dashboards, no outreach call-list queue
                    (that belongs to the right rail). */}
                {(() => {
                  // Premium launcher dock (Task #655). Tools are organized
                  // into labeled, color-tinted frosted-glass GROUPS:
                  //   - Messaging: Direct + Team drive the tray tabs below;
                  //     Email opens the real composer in the Playground and
                  //     is draggable to spawn a floating widget.
                  //   - Notes & Docs: Sticky Notes (persisted, draggable),
                  //     Quick Note, Documents, Scripts, Proof/PDFs.
                  //   - Work: Calendar (honours Settings pref), Tasks,
                  //     Calls, Contacts, Patient Search.
                  //   - System: Settings.
                  const dockGroups: DockGroup[] = [
                    {
                      id: "messaging",
                      label: "Messaging",
                      tint: "sky",
                      tools: [
                        {
                          id: "messages",
                          label: "Messages",
                          icon: MessageCircle,
                          onClick: () => {
                            setMessagesWindowOpen(true);
                            if (activeConversationId) markMessagingRead(activeConversationId);
                          },
                          active: messagesWindowOpen,
                          badge: messagingUnread > 0 ? messagingUnread : undefined,
                          testId: "left-rail-tool-messages",
                        },
                        // Patients dock tool removed — no live patient-SMS
                        // path on this platform.
                        {
                          id: "direct",
                          label: "Direct",
                          icon: MessageSquare,
                          onClick: () => {
                            setTrayTab("direct");
                            if (leftNarrow) setCenterMode("chat");
                            else setLeftRailPeek(true);
                            setChatFocusNonce((n) => n + 1);
                          },
                          active: trayTab === "direct",
                          badge: directUnread > 0 ? directUnread : undefined,
                          testId: "left-rail-tool-direct",
                        },
                        {
                          id: "teamChat",
                          label: "Team Chat",
                          icon: Users,
                          onClick: () => {
                            setTrayTab("team");
                            if (leftNarrow) setCenterMode("chat");
                            else setLeftRailPeek(true);
                            setChatFocusNonce((n) => n + 1);
                          },
                          active: trayTab === "team",
                          testId: "left-rail-tool-team-chat",
                        },
                        {
                          id: "email",
                          label: "Email",
                          icon: Mail,
                          onClick: () => dispatchOpenWorkspace({ type: "email", title: "Email" }),
                          active: activeKind === "email",
                          draggableWidget: "email",
                          testId: "left-rail-tool-email",
                        },
                      ],
                    },
                    {
                      id: "notesDocs",
                      label: "Notes & Docs",
                      tint: "amber",
                      tools: [
                        {
                          id: "sticky",
                          label: "Sticky Notes",
                          icon: StickyNote,
                          onClick: addStickyNote,
                          draggableWidget: "sticky",
                          testId: "left-rail-tool-sticky-notes",
                        },
                        {
                          id: "quickNote",
                          label: "Quick Note",
                          icon: NotebookPen,
                          onClick: () => dispatchOpenWorkspace({ type: "quick_note", title: "Quick Note" }),
                          active: activeKind === "quickNote",
                          testId: "left-rail-tool-quick-note",
                        },
                        {
                          id: "documents",
                          label: "Documents",
                          icon: FileText,
                          onClick: () => dispatchOpenWorkspace({ type: "documents", title: "Documents" }),
                          active: activeKind === "documentLibrary",
                          testId: "left-rail-tool-document-library",
                        },
                        {
                          id: "resources",
                          label: "Scripts",
                          icon: BookOpen,
                          onClick: () => dispatchOpenWorkspace({ type: "scripts", title: "Scripts" }),
                          active: activeKind === "resources",
                          // Phase 0.5 — honest signal: Scripts is a static
                          // resources preview (no backend yet), not a live
                          // managed template library.
                          badge: <SketchBadge tone="graphite">preview</SketchBadge>,
                          testId: "left-rail-tool-resources",
                        },
                        {
                          // K/Phase 0.5 — honest rename. This tool is the
                          // marketing-materials sender (/api/outreach/materials),
                          // NOT a "proof PDFs" store. Labeled for what it is.
                          id: "marketing",
                          label: "Marketing",
                          icon: Megaphone,
                          onClick: () => dispatchOpenWorkspace({ type: "proof_pdfs", title: "Marketing Materials" }),
                          active: activeKind === "marketing",
                          testId: "left-rail-tool-marketing",
                        },
                      ],
                    },
                    {
                      id: "work",
                      label: "Work",
                      tint: "emerald",
                      tools: [
                        {
                          id: "calendar",
                          label: "Calendar",
                          icon: CalendarDays,
                          onClick: handleCalendarTool,
                          // Active when the calendar view is open in the
                          // Playground OR the quick-schedule pop-up it
                          // launches is showing, so the tool reads as
                          // engaged either way.
                          active:
                            centerMode === "calendar" || !!calendarQuickScheduleDate,
                          testId: "left-rail-tool-calendar",
                        },
                        {
                          id: "tasks",
                          label: "Tasks",
                          icon: ClipboardList,
                          onClick: () => dispatchOpenWorkspace({ type: "tasks", title: "Tasks" }),
                          active: activeKind === "plexusTasks",
                          badge: taskCount > 0 ? taskCount : undefined,
                          testId: "left-rail-tool-tasks",
                        },
                        {
                          id: "calls",
                          label: "Calls",
                          icon: PhoneCall,
                          onClick: () => dispatchOpenWorkspace({ type: "call", title: "Calls" }),
                          active: activeKind === "calls",
                          testId: "left-rail-tool-calls",
                        },
                        {
                          id: "contacts",
                          label: "Contacts",
                          icon: Phone,
                          onClick: () => dispatchOpenWorkspace({ type: "contacts", title: "Contacts" }),
                          active: activeKind === "internalContacts",
                          testId: "left-rail-tool-internal-contacts",
                        },
                        {
                          id: "patientSearch",
                          label: "Patient Search",
                          icon: Search,
                          onClick: () => dispatchOpenWorkspace({ type: "patient_search", title: "Patient Search" }),
                          active: activeKind === "patientSearch",
                          testId: "left-rail-tool-patient-search",
                        },
                        {
                          id: "invoiceDesk",
                          label: "Invoice Desk",
                          icon: Landmark,
                          onClick: () => dispatchOpenWorkspace({ type: "invoice_desk", title: "Invoice Desk" }),
                          active: activeKind === "invoiceDesk",
                          // Phase 0.5 — honest signal: Invoice Desk runs on a
                          // demo store, not the canonical billing module yet.
                          badge: <SketchBadge tone="gold">demo</SketchBadge>,
                          testId: "left-rail-tool-invoice-desk",
                        },
                      ],
                    },
                    {
                      id: "system",
                      label: "System",
                      tint: "slate",
                      tools: [
                        {
                          id: "settings",
                          label: "Settings",
                          icon: SettingsIcon,
                          onClick: () => setWorkspaceSettingsOpen(true),
                          active: workspaceSettingsOpen,
                          testId: "left-rail-tool-settings",
                        },
                      ],
                    },
                  ];
                  return <ToolDock groups={dockGroups} compact={leftNarrow} />;
                })()}

                {/* Compact Global Calendar (task #698) — clicking a day
                    updates the selected date AND opens the Quick Schedule
                    pop-up pre-filled with that date. Hidden in the narrow
                    icon rail (too small). */}
                {!leftNarrow && (
                  <LeftRailCompactCalendar
                    selectedDate={selectedDate}
                    onSelectDate={(iso) => {
                      setSelectedDate(iso);
                      openQuickScheduleForDate(iso);
                    }}
                    onExpandToCanvas={() => {
                      setCenterMode("calendar");
                      setCenterTitle(`Calendar — ${globalCalendarDate}`);
                    }}
                  />
                )}
                </div>

                {/* Communication tray (Task #643) — bottom half of the
                    Tools panel. Hidden in the narrow icon rail (too small).
                    Honest boundaries: no fabricated messages/sends. */}
                {!leftNarrow && (
                  <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "rgba(148,163,184,0.4)", backgroundColor: SKETCH_COLORS.paper }}>
                    <CommunicationTray
                      activeTab={trayTab}
                      onTabChange={setTrayTab}
                      currentUserId={currentUser?.id ?? null}
                      teamTasks={trayTeamTasks}
                      directUnread={directUnread}
                      focusNonce={chatFocusNonce}
                      onExpand={() => {
                        setCenterMode("chat");
                        setChatFocusNonce((n) => n + 1);
                      }}
                      directActiveUserId={chatDirectActiveUserId}
                      onDirectActiveUserIdChange={setChatDirectActiveUserId}
                      teamActiveTaskId={chatTeamActiveTaskId}
                      onTeamActiveTaskIdChange={setChatTeamActiveTaskId}
                    />
                  </div>
                )}
              </div>
              );
            })()
            )}
            </div>
          </div>
        </div>

        {/* RIGHT RAIL — mirror of the left: frosted-glass panel attached flush
            to the right edge, transform-only slide from the right. Open =
            rightRailPinned || rightRailPeek. */}
        <div
          ref={rightRailRef}
          className={`pointer-events-none absolute right-0 top-0 bottom-0 z-30 flex flex-col ${RIGHT_RAIL_WIDTH[rightRailSize]}`}
          data-testid="portal-right-rail"
        >
          {/* Stationary right-edge hotspot — the open trigger. */}
          {!isTouchDevice && !rightRailOpen ? (
            <div
              className="pointer-events-auto absolute right-0 top-0 bottom-0 z-10 w-[10px]"
              onMouseEnter={makeRailHoverOpen(rightRailPeekTimer, setRightRailPeek)}
              data-testid="portal-right-rail-hotspot"
              aria-hidden="true"
            />
          ) : null}
          {/* Body — frosted glass, transform-only slide from the right edge. */}
          <div
            onMouseEnter={
              isTouchDevice
                ? undefined
                : makeRailHoverOpen(rightRailPeekTimer, setRightRailPeek)
            }
            onMouseLeave={
              isTouchDevice
                ? undefined
                : makeRailHoverClose(rightRailPeekTimer, setRightRailPeek)
            }
            onClick={
              isTouchDevice
                ? () => {
                    // Tap the resting edge to reveal. When already revealed,
                    // taps inside fall through to content; dismissal is handled
                    // by the click-away listener so inner controls still work.
                    if (!rightRailPeek) setRightRailPeek(true);
                  }
                : undefined
            }
            className={`portal-rail-glass min-h-0 flex-1 overflow-hidden text-slate-900 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              rightRailOpen
                ? "translate-x-0 pointer-events-auto"
                : "translate-x-full pointer-events-none"
            }`}
            style={{ borderRadius: "14px 0 0 14px" }}
            aria-hidden={rightRailOpen ? undefined : true}
            {...(!rightRailOpen ? { inert: "" as unknown as boolean } : {})}
          >
            <div className="relative flex h-full flex-col">
              <div className="flex-1 overflow-y-auto">
                {/* Phase 2I — the work-queue is composed by the real production
                    WorkspaceWorkQueueComposition: the sticky mode-switcher header
                    stays sticky; the flag-gated canonical lifecycle section renders
                    in the scrollable body ABOVE the existing mode body (never in the
                    sticky header, so it cannot obscure the queue). */}
                <WorkspaceWorkQueueComposition
                  canonicalSection={<CanonicalLifecycleSection workspaceRole={workspaceRole} />}
                  header={
                <div className="sticky top-0 z-10 border-b px-3 pb-1.5 pt-1.5" style={{ borderColor: "rgba(148,163,184,0.4)", backgroundColor: "#FAFBF8" }}>
                  <div className="mb-1.5 flex items-center justify-between px-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Work Queue</span>
                    <div className="flex items-center gap-1">
                      {/* Compact operational date navigator (Phase 0A). Drives
                          all three right-rail feeds via `selectedDate`. Local
                          calendar math (shiftIsoDate) keeps yesterday/tomorrow
                          on the intended facility-local day. A "Today" shortcut
                          appears only when off today. Not a full calendar. */}
                      <div className="flex items-center gap-0.5" data-testid="right-rail-date-nav">
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => shiftIsoDate(d, -1))}
                          aria-label="Previous day"
                          title="Previous day"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
                          data-testid="button-right-rail-prev-day"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className="min-w-[62px] text-center text-[10px] font-medium text-slate-600 tabular-nums"
                          title={selectedDate}
                          data-testid="text-right-rail-selected-date"
                        >
                          {relativeDateLabel(selectedDate)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => shiftIsoDate(d, 1))}
                          aria-label="Next day"
                          title="Next day"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
                          data-testid="button-right-rail-next-day"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        {selectedDate !== todayIso() && (
                          <button
                            type="button"
                            onClick={() => setSelectedDate(todayIso())}
                            className="ml-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--sketch-blue)] hover:bg-slate-200/60"
                            data-testid="button-right-rail-today"
                          >
                            Today
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRightRailPinned((v) => !v)}
                        aria-label={rightRailPinned ? "Unpin Work Queue panel" : "Pin Work Queue panel"}
                        title={rightRailPinned ? "Unpin Work Queue panel" : "Pin Work Queue panel"}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${rightRailPinned ? "text-[color:var(--sketch-blue)]" : "text-slate-400 hover:text-slate-600"}`}
                        data-testid="button-pin-right-rail"
                      >
                        {rightRailPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {/* Sticky mode strip (unchanged, still sticky). The canonical
                      lifecycle section is rendered by the composition in the
                      scrollable body below, not here. */}
                  <WorkspaceModeSwitcher
                    activeMode={activeWorkspaceMode}
                    onModeChange={setActiveWorkspaceMode}
                    compact={rightRailSize === "small"}
                    counts={{
                      callList: workspaceCallList.length,
                      // Count MUST match the rows the clinicSchedule body
                      // actually renders. The body iterates `patients` (from
                      // /api/portal/today-schedule), not `workspaceClinicSchedule`
                      // (/api/technician-liaison/clinic-visits), so counting the
                      // latter could diverge from the visible rows + the in-body
                      // badge (which also uses patients.length).
                      clinicSchedule: patients.length,
                      ancillarySchedule: filteredAncillarySchedule.length,
                    }}
                  />
                </div>
                  }
                >
                {activeWorkspaceMode === "clinicSchedule" && (
                <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span data-testid="badge-patient-count">
                    <SketchBadge tone="graphite">{patients.length}</SketchBadge>
                  </span>
                  {/* Phase 2 — facility-scoped clinician filter. Options come
                      from the canonical facility_clinicians directory; "All"
                      clears the filter. Selection persists across date changes
                      within the same facility (reset on facility change). */}
                  {facilityClinicians.length > 0 && (
                    <select
                      value={clinicClinicianFilter ?? "__all__"}
                      onChange={(e) =>
                        setClinicClinicianFilter(
                          e.target.value === "__all__" ? null : e.target.value,
                        )
                      }
                      className="h-7 max-w-[60%] rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700"
                      data-testid="select-clinic-clinician-filter"
                      title="Filter by clinician"
                    >
                      <option value="__all__">All clinicians</option>
                      {facilityClinicians.map((c) => (
                        <option key={c.id} value={c.displayName}>
                          {c.displayName}
                          {c.credentials ? `, ${c.credentials}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {patients.length === 0 ? (
                  <div className="text-xs text-slate-600 py-4 text-center">
                    {clinicClinicianFilter
                      ? `No patients for ${clinicClinicianFilter} on this day.`
                      : "No patients scheduled."}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {patients.map((p) => {
                      const isSelected = p.patientScreeningId === selectedPatientId;
                      // Phase 1 Slice 1.1: consent / screening flags come
                      // from the real-feed patient row. The legacy
                      // isAli branch was removed with the demo patient.
                      const consentDone = !!p.consentSigned;
                      const screeningDone = false;

                      if (rightRailSize === "small") {
                        return (
                          <CompactClinicRow
                            key={(p.patientScreeningId ?? p.name) + ""}
                            name={p.name}
                            time={formatTime(p.time)}
                            consentDone={consentDone}
                            testIdKey={p.patientScreeningId ?? p.name}
                            onClick={() => togglePatientInPlayground(p)}
                          />
                        );
                      }

                      return (
                        <div
                          key={(p.patientScreeningId ?? p.name) + ""}
                          className={`relative rounded-lg border border-l-4 px-2 py-1.5 text-slate-900 transition-colors ${
                            isSelected && centerMode === "patient" ? "bg-slate-900/[0.04]" : "hover:bg-slate-900/[0.03]"
                          }`}
                          style={{
                            backgroundColor: isSelected && centerMode === "patient" ? undefined : SKETCH_COLORS.paper,
                            borderColor: "rgba(148,163,184,0.35)",
                            borderLeftColor: consentDone ? "var(--sketch-green)" : "var(--sketch-gold)",
                          }}
                          data-testid={`patient-row-${p.patientScreeningId ?? p.name}`}
                        >
                          <button
                            onClick={() => {
                              togglePatientInPlayground(p);
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{p.name}</div>
                                <div className="text-[10px] text-slate-500">
                                  {formatTime(p.time)} · {p.appointments.length} test{p.appointments.length === 1 ? "" : "s"}
                                  {p.clinicianName ? ` · ${p.clinicianName}` : ""}
                                </div>
                              </div>
                              {consentDone ? (
                                <SketchBadge tone="green">
                                  <Check className="h-2.5 w-2.5 mr-0.5" /> Consent ✓
                                </SketchBadge>
                              ) : (
                                <SketchBadge tone="gold">
                                  <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Needed
                                </SketchBadge>
                              )}
                            </div>
                          </button>

                          {/* Plexus IQ qualification dots (category color) +
                              Atlas quick access. Outside the name button so
                              their clicks don't toggle the row selection. */}
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <ClinicQualificationDots
                              patientScreeningId={p.patientScreeningId}
                              qualifyingTests={p.qualifyingTests}
                            />
                            {p.patientScreeningId != null && (
                              <PatientPdfActions
                                patient={{
                                  id: p.patientScreeningId,
                                  name: p.name,
                                  dob: p.dob,
                                  qualifyingTests: p.qualifyingTests,
                                } as never}
                                facility={p.facility}
                                scheduleDate={selectedDate}
                                iconOnly
                              />
                            )}
                          </div>

                          <div className="mt-2 flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (p.patientScreeningId != null) {
                                  dispatchOpenWorkspace({
                                    type: "patient_ehr",
                                    title: p.name,
                                    patientScreeningId: p.patientScreeningId,
                                    facilityId: p.facility,
                                  });
                                }
                              }}
                              className="absolute -right-3 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                              data-testid={`button-patient-profile-expand-${p.patientScreeningId ?? p.name}`}
                              title="Open patient profile in Playground"
                            >
                              <Maximize2 className="h-4 w-4 text-[#4863A0]" />
                            </button>

                            {workspaceCanCallAndSchedule && (
                              <div className="inline-flex rounded-full border border-slate-200 bg-white overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openSchedulePatientDialog({
                                      patientName: p.name,
                                      patientDob: p.dob,
                                      facilityId: p.facility,
                                      patientScreeningId: p.patientScreeningId,
                                      executionCaseId: null,
                                      serviceType: p.qualifyingTests[0] ?? null,
                                    })
                                  }
                                  className="inline-flex h-8 w-8 items-center justify-center hover:bg-slate-50"
                                  data-testid={`button-patient-calendar-${p.patientScreeningId ?? p.name}`}
                                  title="Schedule patient"
                                >
                                  <CalendarPlus className="h-4 w-4 text-[#4863A0]" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openSchedulePatientPlayground({
                                      patient: {
                                        patientName: p.name,
                                        patientDob: p.dob,
                                        facilityId: p.facility,
                                        patientScreeningId: p.patientScreeningId,
                                        executionCaseId: null,
                                        serviceType: p.qualifyingTests[0] ?? null,
                                      },
                                      selectedDate,
                                    })
                                  }
                                  className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 hover:bg-slate-50"
                                  data-testid={`button-patient-calendar-expand-${p.patientScreeningId ?? p.name}`}
                                  title="Open schedule in Playground"
                                >
                                  <Maximize2 className="h-4 w-4 text-[#4863A0]" />
                                </button>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
                                setCenterMode("consent");
                                markDockOpen("consent");
                              }}
                              className={`inline-flex h-8 items-center justify-center rounded-full border px-2 ${
                                consentDone
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`button-patient-consent-${p.patientScreeningId ?? p.name}`}
                              title="Informed Consent"
                            >
                              <FileSignature className="h-4 w-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (p.patientScreeningId != null) setSelectedPatientId(p.patientScreeningId);
                                setCenterMode("patient");
                                markDockOpen("chart");
                              }}
                              className={`inline-flex h-8 items-center justify-center rounded-full border px-2 ${
                                screeningDone
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              data-testid={`button-patient-screening-${p.patientScreeningId ?? p.name}`}
                              title="Screening Form"
                            >
                              <ClipboardPen className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
                )}

                {activeWorkspaceMode === "callList" && (
                  <div className="space-y-1" data-testid="workspace-mode-body-callList">
                    {workspaceCallListLoading ? (
                      <div className="text-xs text-slate-600 py-4 text-center">Loading call list…</div>
                    ) : workspaceCallList.length === 0 ? (
                      <div className="text-xs text-slate-600 py-4 text-center">
                        No calls for this facility/date.
                      </div>
                    ) : (
                      workspaceCallList.map((row, idx) => {
                        const callReason = deriveCallReason(row);
                        const canCall = row.patientScreeningId != null;
                        if (rightRailSize === "small") {
                          return (
                            <CompactCallRow
                              key={`${row.id ?? idx}`}
                              name={row.patientName ?? "Unnamed patient"}
                              callReason={callReason}
                              canCall={canCall}
                              testIdKey={row.id ?? idx}
                              onOpenPatient={() => openCallRowPatient(row)}
                              onOpenCall={() => setCallWorkspaceCtx(callRowToCaseContext(row))}
                              onOpenSchedule={() => openSchedulePatientDialog(callRowToDialogPatient(row))}
                              onOpenCase={() => openCaseTab("caseOverview", callRowToCaseContext(row))}
                            />
                          );
                        }
                        return (
                        <div
                          key={`${row.id ?? idx}`}
                          className="rounded-lg border border-l-2 px-2 py-1.5 text-slate-900 transition-colors hover:bg-slate-900/[0.03]"
                          style={{ backgroundColor: SKETCH_COLORS.paper, borderColor: "rgba(148,163,184,0.35)", borderLeftColor: "var(--sketch-blue)" }}
                          data-testid={`workspace-call-${row.id ?? idx}`}
                        >
                          {/* Minimal card: just the patient name + a circular
                              phone button (call) and a circular calendar button
                              (opens the quick schedule popup). Historical rows
                              (past dates) show the recorded outcome instead of
                              live quick-actions — the day is read-only. */}
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => openCallRowPatient(row)}
                              className="block min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-900"
                              title={`Open ${row.patientName ?? "patient"} in Playground`}
                              data-testid={`button-call-patient-${row.id ?? idx}`}
                            >
                              {row.patientName ?? "Unnamed patient"}
                            </button>
                            {row.historical ? (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                                  row.completed
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                                data-testid={`call-historical-status-${row.id ?? idx}`}
                              >
                                {row.completed ? "Called" : "No call"}
                              </span>
                            ) : (
                              <CallRowQuickActions
                                row={row}
                                idx={row.id ?? idx}
                                canCall={canCall}
                                onOpenCall={() => setCallWorkspaceCtx(callRowToCaseContext(row))}
                                onOpenSchedule={() => openSchedulePatientDialog(callRowToDialogPatient(row))}
                              />
                            )}
                          </div>
                          {row.historical && (row.lastCallOutcome || (row.historicalCallCount ?? 0) > 0 || row.historicalCallbackAt) && (
                            <div className="mt-1 text-[10px] text-slate-500" data-testid={`call-historical-detail-${row.id ?? idx}`}>
                              {row.lastCallOutcome ? `Outcome: ${row.lastCallOutcome}` : "No outcome logged"}
                              {(row.historicalCallCount ?? 0) > 0 ? ` · ${row.historicalCallCount} attempt${row.historicalCallCount === 1 ? "" : "s"}` : ""}
                              {row.historicalCallbackAt ? ` · callback ${new Date(row.historicalCallbackAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                            </div>
                          )}
                        </div>
                        );
                      })
                    )}
                  </div>
                )}

                {activeWorkspaceMode === "ancillarySchedule" && (
                  <div className="space-y-1" data-testid="workspace-mode-body-ancillarySchedule">
                    {workspaceAncillaryLoading ? (
                      <div className="text-xs text-slate-600 py-4 text-center">Loading ancillary schedule…</div>
                    ) : filteredAncillarySchedule.length === 0 ? (
                      <div className="text-xs text-slate-600 py-4 text-center">
                        {allowedServiceTypes.length > 0 && workspaceAncillarySchedule.length > 0
                          ? "No ancillary tests in your allowed service types for this facility/date."
                          : "No ancillary tests scheduled for this facility/date."}
                      </div>
                    ) : (
                      groupedAncillarySchedule.map((group) => {
                        // Multi-service visit block: render the patient name +
                        // block time-range ONCE as a header, then the per-service
                        // rows below it (each still carries its own service/time/
                        // readiness/executionCaseId). Single-service groups skip
                        // the header and render just the one row as before.
                        const isBlock = group.events.length > 1;
                        const blockTimes = group.events
                          .map((e) =>
                            e.startsAt
                              ? new Date(e.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                              : null,
                          )
                          .filter(Boolean);
                        const blockRange =
                          blockTimes.length > 0
                            ? blockTimes.length > 1
                              ? `${blockTimes[0]}–${blockTimes[blockTimes.length - 1]}`
                              : blockTimes[0]
                            : "—";
                        return (
                          <div
                            key={group.key}
                            className={isBlock ? "rounded-xl border border-violet-200/70 bg-violet-50/30 p-1" : ""}
                            data-testid={isBlock ? `ancillary-visit-block-${group.key}` : undefined}
                          >
                            {isBlock && (
                              <div
                                className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-0.5"
                                data-testid={`ancillary-visit-block-header-${group.key}`}
                              >
                                <span className="truncate text-sm font-semibold text-slate-800">
                                  {group.patientName}
                                </span>
                                <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
                                  {blockRange} · {group.events.length} tests
                                </span>
                              </div>
                            )}
                            {group.events.map((row, idx) => {
                        const rowKey = `ancillary:${row.id ?? idx}`;
                        const removing = removingRowKeys.has(rowKey);
                        if (rightRailSize === "small" && !removing) {
                          return (
                            <CompactAncillaryRow
                              key={`${row.id ?? idx}`}
                              name={row.patientName ?? "Unnamed patient"}
                              time={
                                row.startsAt
                                  ? new Date(row.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                                  : "—"
                              }
                              serviceType={row.serviceType ?? "Ancillary"}
                              testIdKey={row.id ?? idx}
                              onClick={() => openAncillaryWorkflow(row)}
                            />
                          );
                        }
                        return (
                        <div
                          key={`${row.id ?? idx}`}
                          role="button"
                          tabIndex={0}
                          title="Open ancillary workflow"
                          onClick={() => openAncillaryWorkflow(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openAncillaryWorkflow(row);
                            }
                          }}
                          className={`cursor-pointer overflow-hidden rounded-xl border border-white/40 border-l-4 border-l-violet-400/80 bg-white/80 px-2 text-slate-900 shadow-[0_4px_18px_rgba(15,23,42,0.12)] backdrop-blur-md transition-all duration-300 ${
                            removing
                              ? "max-h-0 -translate-y-2 border-transparent py-0 opacity-0"
                              : "max-h-[400px] py-1.5 opacity-100 hover:bg-white/90"
                          }`}
                          data-testid={`workspace-ancillary-${row.id ?? idx}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div
                                className="max-w-full truncate text-left text-sm font-medium"
                                data-testid={`button-ancillary-open-playground-${row.id ?? idx}`}
                              >
                                {row.patientName ?? "Unnamed patient"}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">
                                {row.serviceType ?? "Ancillary"}
                                {row.startsAt
                                  ? ` · ${new Date(row.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                                  : ""}
                                {row.facilityId ? ` · ${row.facilityId}` : ""}
                              </div>
                            </div>
                            {row.status && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {row.status}
                              </Badge>
                            )}
                          </div>
                          {/* Document readiness (consent / screening / brainwave)
                              rendered inline on the row from the already-fetched
                              row.readiness the server enriches each ancillary
                              appointment with. ACS-only; the mark/upload actions
                              hit existing canonical /api/portal/case-readiness
                              routes keyed on the row's executionCaseId, and a
                              change refetches the ancillary feed. Clicks inside
                              this control must not bubble to the row's open-in-
                              Playground handler. */}
                          {workspaceCanCompleteProcedure &&
                            row.readiness && (
                              <div onClick={(e) => e.stopPropagation()}>
                                <AncillaryReadinessRow
                                  executionCaseId={row.executionCaseId ?? null}
                                  serviceType={row.serviceType ?? null}
                                  patientName={row.patientName ?? null}
                                  readiness={row.readiness}
                                  rowId={String(row.id ?? idx)}
                                  onChanged={() =>
                                    queryClient.invalidateQueries({
                                      queryKey: ["team-workspace-ancillary-schedule"],
                                    })
                                  }
                                />
                              </div>
                            )}
                          {/* Document workflows live inside the patient's
                              Playground (opened by clicking anywhere on this row),
                              keeping the schedule row clean and uncluttered. */}
                          {workspaceCanCompleteProcedure &&
                            row.patientScreeningId != null &&
                            row.serviceType && (
                              <div
                                className="mt-2 flex justify-end"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ProcedureCompleteButton
                                  patientScreeningId={row.patientScreeningId}
                                  patientName={row.patientName ?? null}
                                  patientDob={row.patientDob ?? null}
                                  facilityId={row.facilityId ?? null}
                                  serviceType={row.serviceType}
                                  onCompleted={() => {
                                    // Slide the completed row up, then drop the
                                    // animation key once the ancillary feed
                                    // refetch has removed the underlying row.
                                    setRemovingRowKeys((prev) => {
                                      const next = new Set(prev);
                                      next.add(rowKey);
                                      return next;
                                    });
                                    window.setTimeout(() => {
                                      setRemovingRowKeys((prev) => {
                                        const next = new Set(prev);
                                        next.delete(rowKey);
                                        return next;
                                      });
                                    }, 350);
                                  }}
                                />
                              </div>
                            )}
                        </div>
                        );
                            })}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
                {/* clinicSchedule loading hint surfaced if today-schedule
                    + technician-liaison/clinic-visits still hydrating. */}
                {activeWorkspaceMode === "clinicSchedule" &&
                  workspaceClinicLoading &&
                  workspaceClinicSchedule.length === 0 &&
                  patients.length === 0 && (
                    <div className="text-xs text-slate-600 py-2 text-center">
                      Loading clinic schedule…
                    </div>
                  )}
                </WorkspaceWorkQueueComposition>
              </div>
            </div>
          </div>
        </div>
        {/* Metrics floating popup — toggled from dock */}
        {metricsPopupOpen && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40" data-testid="metrics-popup-anchor">
            <MetricsPopup
              open={metricsPopupOpen}
              onClose={() => setMetricsPopupOpen(false)}
              metrics={{
                queueCount: workspaceCallList?.length ?? 0,
                tasksDue: (tasksData?.urgent?.length ?? 0) + (tasksData?.open?.length ?? 0),
              }}
            />
          </div>
        )}
        {/* Nova quick panel — toggled from dock */}
        {novaQuickPanelOpen && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40" data-testid="nova-panel-anchor">
            <NovaQuickPanel
              open={novaQuickPanelOpen}
              onClose={() => setNovaQuickPanelOpen(false)}
              onOpenInPlayground={() => {
                setNovaQuickPanelOpen(false);
                dispatchOpenWorkspace({ type: "nova", title: "Nova" });
              }}
              contextLabel={
                selected
                  ? `${selected.name}${selected.qualifyingTests?.[0] ? ` · ${selected.qualifyingTests[0]}` : ""}`
                  : null
              }
            />
          </div>
        )}
        <div className="absolute bottom-5 left-1/2 z-50 -translate-x-1/2 w-full max-w-[95vw] overflow-x-auto">
          <GlobalDock
            role={workspaceRole ?? role}
            isAdmin={isAdmin}
            position="absolute"
            className="!bottom-0 !left-1/2 !-translate-x-1/2 !z-auto relative"
            activeState={{
              activeAppId: dockActiveApp ?? (novaQuickPanelOpen ? "nova" : null),
              openAppIds: [
                ...dockOpenApps,
                ...(novaQuickPanelOpen ? ["nova"] : []),
              ],
            }}
            onActivate={(app: DockAppDefinition) => {
              // Map unified dock app activations to existing TeamPortalShell behavior.
              if (app.id === "home") {
                // Team roles: activate Playground Home workspace.
                dispatchOpenWorkspace({ type: "playground_home", title: "Home" });
                return;
              }
              if (app.id === "nova") { setNovaQuickPanelOpen((v) => !v); return; }
              // Metrics → toggle floating MetricsPopup (not a navigation).
              if (app.id === "metrics") { setMetricsPopupOpen((v) => !v); return; }
              // Map dock apps to real Playground workspaces.
              const workspaceMap: Record<string, { type: string; title: string }> = {
                "plexus-tasks": { type: "tasks", title: "Tasks" },
                "schedule": { type: "schedule", title: "Schedule" },
                "documents": { type: "documents", title: "Documents" },
              };
              const wsMapping = workspaceMap[app.id];
              if (wsMapping) {
                dispatchOpenWorkspace({ type: wsMapping.type as any, title: wsMapping.title });
                return;
              }
              // Team Ops → existing Engagement Center (team operations surface)
              if (app.id === "team-ops") { setLocation("/engagement-center"); return; }
              // Plexus Nucleus → honest unavailable (no runtime destination yet)
              if (app.id === "plexus-nucleus") {
                toast({ title: "Plexus Nucleus", description: "Nucleus workspace is not yet available." });
                return;
              }
              // Phone → open call workspace for selected patient if available
              if (app.id === "phone") {
                if (selected?.patientScreeningId != null) {
                  setCallWorkspaceCtx({
                    patientScreeningId: selected.patientScreeningId,
                    executionCaseId: null,
                    patientName: selected.name ?? "Patient",
                    patientDob: selected.dob ?? null,
                    facilityId: facility ?? null,
                    callReason: "Dock quick call",
                    targetServices: selected.qualifyingTests ?? [],
                    ancillaryCaseId: null,
                    serviceType: selected.qualifyingTests?.[0] ?? null,
                    sourcePortal: "PCS",
                    engagementStatus: null,
                    lifecycleStatus: null,
                  });
                }
                return;
              }
              // Route-type apps: navigate.
              if (app.destinationType === "route" && app.route) { setLocation(app.route); return; }
              // Popup/workspace apps: open real Playground workspace.
              if (app.destinationType === "workspace" || app.destinationType === "popup") {
                dispatchOpenWorkspace({ type: (app.workspaceType ?? app.id) as any, title: app.label });
              }
            }}
          />
        </div>

        {aiOpen ? (
          <div className="absolute bottom-20 right-5 z-30 w-[340px] rounded-[24px] border border-white/60 bg-white/70 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl" data-testid="floating-ai-panel">
            <div className="flex items-center gap-2 border-b border-white/50 px-4 py-3">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <div className="text-sm font-semibold text-slate-900">AI Assistant</div>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/70 hover:bg-white"
                data-testid="button-ai-minimize"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="text-xs text-slate-500">
                Ask about {facility ? `${facility} · ${selectedDate}` : "today's clinic"}.
              </div>
              <Input
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                placeholder="Ask about this clinic day…"
                className="w-full bg-white/90"
                data-testid="input-ai-question"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!aiDraft.trim()}
                  onClick={() => {
                    toast({ title: "Coming soon", description: "AI assistant will answer questions about this clinic day." });
                    setAiDraft("");
                  }}
                  data-testid="button-ai-send"
                >
                  <Send className="h-3.5 w-3.5 mr-1" /> Ask
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {scheduleDialogPatient && (
        <Dialog open={!!scheduleDialogPatient} onOpenChange={(o) => !o && setScheduleDialogPatient(null)}>
          <DialogContent className="max-w-md" data-testid="dialog-schedule-peek">
            <DialogHeader>
              <DialogTitle>{scheduleDialogPatient.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm text-slate-700">
              <div><span className="font-medium">DOB:</span> {scheduleDialogPatient.dob ?? "—"}</div>
              <div><span className="font-medium">Facility:</span> {scheduleDialogPatient.facility}</div>
              <div><span className="font-medium">Time:</span> {formatTime(scheduleDialogPatient.time)}</div>
              <div><span className="font-medium">Clinician:</span> {scheduleDialogPatient.clinicianName ?? "—"}</div>
              <div><span className="font-medium">Qualifying Tests:</span> {scheduleDialogPatient.qualifyingTests.length ? scheduleDialogPatient.qualifyingTests.join(", ") : "None"}</div>
              <div><span className="font-medium">Appointment Status:</span> {scheduleDialogPatient.appointmentStatus || "pending"}</div>
              {/* Phase 1 Slice 1.1: the legacy hardcoded demo-patient
                  insurance / prior-ancillary / cooldown block was
                  removed. Real-feed Insurance / Cooldown / Prior
                  Ancillary visibility lives in the Patient EHR
                  warning facts surfaces. */}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScheduleDialogPatient(null)}>
                Close
              </Button>
              <Button onClick={() => expandScheduleToPlayground(scheduleDialogPatient)}>
                Expand to Playground
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {consentDialog && (
        <ConsentDialog
          patient={consentDialog.patient}
          testType={consentDialog.testType}
          open={!!consentDialog}
          onOpenChange={(o) => !o && setConsentDialog(null)}
          role={role}
        />
      )}

      <SchedulePatientDialog
        open={!!schedulePatientDialog}
        onOpenChange={(o) => {
          if (!o) setSchedulePatientDialog(null);
        }}
        patient={schedulePatientDialog}
        defaultDate={schedulePatientDialogDefaultDate ?? selectedDate}
        defaultTime={schedulePatientDialogDefaultTime}
        facilityOptions={facilities}
        onOpenInPlayground={(payload) => openSchedulePatientPlayground(payload)}
      />

      {/* Left-rail Calendar quick-schedule pop-up (task #635/#636). Opened from
          the Calendar tool button and from clicking a date in the mini-calendar.
          Collects date + time + service + an optional patient (typeahead against
          real records). With a resolved patient + full selection the dialog books
          the appointment directly; otherwise it hands off to the full
          SchedulePatientDialog (Schedule) or the Playground (Open in Playground)
          with the selection — and any resolved patient identity — pre-filled. */}
      <CalendarQuickScheduleDialog
        open={!!calendarQuickScheduleDate}
        date={calendarQuickScheduleDate}
        facility={facility || null}
        onOpenChange={(o) => {
          if (!o) setCalendarQuickScheduleDate(null);
        }}
        onSchedule={({ date, time, service, patientName, resolvedPatient }) => {
          setCalendarQuickScheduleDate(null);
          openSchedulePatientDialog(
            {
              patientName: resolvedPatient?.name ?? (patientName || null),
              patientDob: resolvedPatient?.dob ?? null,
              patientScreeningId: resolvedPatient?.patientScreeningId ?? null,
              facilityId: facility ?? null,
              serviceType: service || null,
              insurance: resolvedPatient?.insurance ?? null,
            },
            { date, time },
          );
        }}
        onOpenInPlayground={({ date, service, patientName, resolvedPatient }) => {
          setCalendarQuickScheduleDate(null);
          openSchedulePatientPlayground({
            patient: {
              patientName: resolvedPatient?.name ?? (patientName || null),
              patientDob: resolvedPatient?.dob ?? null,
              patientScreeningId: resolvedPatient?.patientScreeningId ?? null,
              facilityId: facility ?? null,
              serviceType: service || null,
              insurance: resolvedPatient?.insurance ?? null,
            },
            selectedDate: date,
          });
        }}
      />

      {/* Quick-call popup for the right-panel call list. Posts the canonical
          call result (/api/engagement-center/call-result) via DispositionSheet.
          When admin is viewing as a team member, the case stays assigned to
          that member (assignedUserId) while the server records the admin as the
          acting user. Includes a Push-to-Playground shortcut. */}
      <DispositionSheet
        open={!!callDialogRow}
        onOpenChange={(o) => {
          if (!o) setCallDialogRow(null);
        }}
        patientId={callDialogRow?.patientScreeningId ?? null}
        patientName={callDialogRow?.patientName ?? ""}
        schedulerUserId={viewAsTeamMemberId ?? currentUserId}
        onPushToPlayground={
          callDialogRow
            ? () => pushCallRowToPlayground(callDialogRow)
            : undefined
        }
      />

      {/* Step 3 — pop-up dialer. CallWorkspace fetches the patient phone and
          starts a call through the existing RingCentral provider; when the
          provider is unwired it degrades to a manual-dial card (honest
          boundary, never a fake live call). z-[95] keeps it above the z-[80]
          portal overlay. */}
      <Dialog
        open={!!callWorkspaceCtx}
        onOpenChange={(o) => {
          if (!o) setCallWorkspaceCtx(null);
        }}
      >
        <DialogContent
          className="z-[95] max-w-2xl gap-0 overflow-hidden p-0"
          data-testid="dialog-quick-call"
        >
          {callWorkspaceCtx && (
            <CallWorkspace
              ctx={callWorkspaceCtx}
              onScheduleCase={() => {
                const ctx = callWorkspaceCtx;
                setCallWorkspaceCtx(null);
                openSchedulePatientDialog({
                  patientName: ctx.patientName ?? null,
                  patientDob: ctx.patientDob ?? null,
                  facilityId: ctx.facilityId ?? null,
                  patientScreeningId: ctx.patientScreeningId ?? null,
                  executionCaseId: ctx.executionCaseId ?? null,
                  serviceType: ctx.targetServices?.[0] ?? null,
                });
              }}
              onOpenCase={() => {
                const ctx = callWorkspaceCtx;
                setCallWorkspaceCtx(null);
                openCaseTab("caseOverview", ctx);
              }}
              onClose={() => setCallWorkspaceCtx(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Canonical calendar shared by PCS, ACS, Plexus IQ, and Dashboard. */}
      <CanonicalCommandCalendar
        mode="drawer"
        profileId={teamPortalCalendarProfileId}
        open={teamPortalCalendarOpen}
        onOpenChange={setTeamPortalCalendarOpen}
        title="Team Portal Calendar"
        cells={teamPortalCalendarCells}
        onSelectDate={(d) => {
          setSelectedDate(d);
          setTeamPortalCalendarOpen(false);
        }}
      />

      {/* Floating iMessage-style Messages window (Task #740, mock data). */}
      <PortalMessagesWindow
        open={messagesWindowOpen}
        conversations={messagingConversations}
        activeConversationId={activeConversationId}
        onSelectConversation={openMessagesConversation}
        onSend={sendMessagingMessage}
        onClose={() => setMessagesWindowOpen(false)}
      />

      {/* Persisted per-user workspace settings (Task #643). Closing
          the dialog awaits `flushPersist` so any pending debounced
          write commits BEFORE the dialog unmounts, guaranteeing a
          user who edits + closes + reloads sees the new value. */}
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
        prefs={workspacePrefs}
        updatePref={updateWorkspacePref}
        resetPrefs={resetWorkspacePrefs}
        flushPersist={flushWorkspacePrefs}
      />
    </div>
    </PlaygroundWorkspaceProvider>
    </DockOwnershipProvider>
  );
}
