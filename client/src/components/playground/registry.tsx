// Playground Workspace Registry — extensible module registration.
//
// Each workspace type registers a definition with its renderer,
// deduplication logic, and metadata. The Playground engine uses this
// to resolve how to create, render, and manage workspaces.

import {
  Home,
  User,
  Phone,
  CheckSquare,
  ClipboardList,
  CalendarDays,
  MessageSquare,
  Mail,
  FileText,
  FileBarChart,
  NotebookPen,
  StickyNote,
  Users as UsersIcon,
  Landmark,
  Wrench,
  PenTool,
  Gamepad2,
  BarChart3,
  Sparkles,
  TrendingUp,
  Atom,
  Search,
  BookOpen,
  Megaphone,
  Stethoscope,
} from "lucide-react";
import { NovaDockIcon } from "@/components/nova/NovaDockIcon";
import { CallWorkspaceTab } from "./workspaces/CallWorkspaceTab";
import { TasksWorkspaceTab } from "./workspaces/TasksWorkspaceTab";
import { ScheduleWorkspaceTab } from "./workspaces/ScheduleWorkspaceTab";
import { DocumentsWorkspaceTab } from "./workspaces/DocumentsWorkspaceTab";
import { NovaWorkspaceTab } from "./workspaces/NovaWorkspaceTab";
import { PlaygroundHomeArtwork } from "./workspaces/PlaygroundHomeArtwork";
import {
  EmailWorkspaceTab,
  QuickNoteWorkspaceTab,
  CallsRepositoryWorkspaceTab,
  PatientSearchWorkspaceTab,
  ContactsWorkspaceTab,
  InvoiceDeskWorkspaceTab,
  ScriptsWorkspaceTab,
  ProofPdfsWorkspaceTab,
} from "./workspaces/S6WorkspaceTabs";
import { SketchSurface } from "./sketch/SketchPrimitives";
import type { PlaygroundWorkspaceDefinition, PlaygroundWorkspace, PlaygroundWorkspaceType } from "./types";

// ─── Patient EHR workspace renderer ───────────────────────────────────────
// Uses the existing PortalPatientDirectory which wraps PatientProfileWorkspace → PatientChart.
import { PortalPatientDirectory } from "@/components/portal/PortalPatientDirectory";
import { AncillaryWorkflowWorkspace } from "@/components/portal/AncillaryWorkflowWorkspace";
import type { WorkspaceRenderProps } from "./types";

// ACS ancillary clinic-day workflow surface (consent / screening / report +
// why-qualified + Atlas + Open EHR). Deduped per execution case + service.
function AncillaryWorkflowWorkspaceTab({ workspace }: WorkspaceRenderProps) {
  return (
    <AncillaryWorkflowWorkspace
      patientScreeningId={workspace.patientScreeningId ?? null}
      executionCaseId={workspace.executionCaseId ?? null}
      serviceKey={workspace.serviceKey ?? null}
      facilityId={workspace.facilityId ?? null}
      patientName={workspace.title ?? null}
    />
  );
}

function PatientEhrWorkspace({ workspace, isActive }: WorkspaceRenderProps) {
  if (!workspace.patientScreeningId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p className="text-sm">No patient selected for this workspace.</p>
      </div>
    );
  }
  return (
    <PortalPatientDirectory
      patientScreeningId={workspace.patientScreeningId}
      seedName={workspace.title}
      onBack={undefined}
      onSchedule={undefined}
      focusSection={workspace.focusSection ?? undefined}
      focusToken={workspace.focusToken}
    />
  );
}

function PlaceholderWorkspace({ workspace }: { workspace: PlaygroundWorkspace; isActive: boolean }) {
  // Sketch empty-state for workspace types that have no real implementation
  // yet (scaffold). Honest copy — does not pretend the feature exists.
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-transparent p-6"
      data-testid={`workspace-placeholder-${workspace.type}`}
    >
      <SketchSurface seedId={`placeholder-${workspace.type}`} className="max-w-sm text-center">
        <div className="text-base font-semibold text-slate-800">{workspace.title}</div>
        <div className="mt-1 text-xs text-slate-500">
          This workspace is scaffolded — no functional implementation is wired yet.
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-400">
          {workspace.type}
        </div>
        {workspace.patientScreeningId ? (
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            Patient #{workspace.patientScreeningId}
          </div>
        ) : null}
      </SketchSurface>
    </div>
  );
}

function PlaygroundHomeWorkspace() {
  return <PlaygroundHomeArtwork />;
}

// ─── Dedupe key helpers ───────────────────────────────────────────────────

function patientDedupeKey(ws: Partial<PlaygroundWorkspace>): string {
  return `patient_ehr:${ws.patientScreeningId ?? ws.patientId ?? "unknown"}`;
}

function singletonDedupeKey(type: PlaygroundWorkspaceType): (ws: Partial<PlaygroundWorkspace>) => string {
  return () => type;
}

function patientWorkspaceDedupeKey(type: string): (ws: Partial<PlaygroundWorkspace>) => string {
  return (ws) => `${type}:${ws.patientScreeningId ?? ws.patientId ?? "unknown"}`;
}

// Ancillary workflow dedupes PER SERVICE INSTANCE: a patient can have multiple
// concurrent ancillary services (each its own execution case), so keying on
// executionCase + service keeps distinct services in distinct tabs while
// re-clicking the same service focuses the existing one.
function ancillaryWorkflowDedupeKey(ws: Partial<PlaygroundWorkspace>): string {
  const caseKey = ws.executionCaseId ?? ws.patientScreeningId ?? ws.patientId ?? "unknown";
  return `ancillary_workflow:${caseKey}:${ws.serviceKey ?? "?"}`;
}

function contextDedupeKey(type: string): (ws: Partial<PlaygroundWorkspace>) => string {
  return (ws) => `${type}:${ws.taskId ?? ws.documentId ?? ws.conversationId ?? ws.appointmentId ?? Math.random()}`;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const DEFINITIONS: PlaygroundWorkspaceDefinition[] = [
  {
    type: "playground_home",
    icon: Home,
    render: PlaygroundHomeWorkspace as any,
    dedupeKey: singletonDedupeKey("playground_home"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "patient_ehr",
    icon: User,
    titleResolver: (ws) => ws.title || "Patient",
    render: PatientEhrWorkspace,
    dedupeKey: patientDedupeKey,
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: false, // Unmount inactive EHRs for performance
  },
  {
    type: "ancillary_workflow",
    icon: Stethoscope,
    titleResolver: (ws) => ws.title || "Ancillary Workflow",
    render: AncillaryWorkflowWorkspaceTab,
    dedupeKey: ancillaryWorkflowDedupeKey,
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: false,
  },
  {
    type: "call",
    icon: Phone,
    titleResolver: (ws) => ws.title || "Call",
    render: CallWorkspaceTab,
    dedupeKey: patientWorkspaceDedupeKey("call"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    // Phase 5E — Calls repository / history (left-rail "Calls" tile). Real data
    // over closed/completed cases + recall; a singleton, not per-patient.
    type: "calls_repository",
    icon: Phone,
    titleResolver: (ws) => ws.title || "Calls",
    render: CallsRepositoryWorkspaceTab,
    dedupeKey: singletonDedupeKey("calls_repository"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "tasks",
    icon: CheckSquare,
    render: TasksWorkspaceTab,
    dedupeKey: singletonDedupeKey("tasks"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "task",
    icon: ClipboardList,
    render: PlaceholderWorkspace,
    dedupeKey: contextDedupeKey("task"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "schedule",
    icon: CalendarDays,
    render: ScheduleWorkspaceTab,
    dedupeKey: singletonDedupeKey("schedule"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "calendar",
    icon: CalendarDays,
    render: ScheduleWorkspaceTab,
    dedupeKey: singletonDedupeKey("calendar"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "message_thread",
    icon: MessageSquare,
    render: PlaceholderWorkspace,
    dedupeKey: contextDedupeKey("message_thread"),
    supportsPatientContext: false,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "team_chat",
    icon: MessageSquare,
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("team_chat"),
    supportsPatientContext: false,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "email",
    icon: Mail,
    render: EmailWorkspaceTab,
    dedupeKey: singletonDedupeKey("email"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true, // preserve email draft across tab switches
  },
  {
    type: "documents",
    icon: FileText,
    render: DocumentsWorkspaceTab,
    dedupeKey: singletonDedupeKey("documents"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "document",
    icon: FileBarChart,
    render: PlaceholderWorkspace,
    dedupeKey: contextDedupeKey("document"),
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "report",
    icon: FileBarChart,
    render: PlaceholderWorkspace,
    dedupeKey: contextDedupeKey("report"),
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "quick_note",
    icon: NotebookPen,
    render: QuickNoteWorkspaceTab,
    dedupeKey: singletonDedupeKey("quick_note"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true, // preserve note draft across tab switches
  },
  {
    type: "sticky_notes",
    icon: StickyNote,
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("sticky_notes"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "contacts",
    icon: Search,
    render: ContactsWorkspaceTab,
    dedupeKey: singletonDedupeKey("contacts"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "nova",
    icon: NovaDockIcon,
    render: NovaWorkspaceTab,
    dedupeKey: singletonDedupeKey("nova"),
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "team_ops",
    icon: UsersIcon,
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("team_ops"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "invoice_desk",
    icon: Landmark,
    render: InvoiceDeskWorkspaceTab,
    dedupeKey: singletonDedupeKey("invoice_desk"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "custom_tool",
    icon: Wrench,
    render: PlaceholderWorkspace,
    dedupeKey: contextDedupeKey("custom_tool"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "patient_search",
    icon: Search,
    render: PatientSearchWorkspaceTab,
    dedupeKey: singletonDedupeKey("patient_search"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "scripts",
    icon: BookOpen,
    render: ScriptsWorkspaceTab,
    dedupeKey: singletonDedupeKey("scripts"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "proof_pdfs",
    icon: Megaphone,
    render: ProofPdfsWorkspaceTab,
    dedupeKey: singletonDedupeKey("proof_pdfs"),
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "whiteboard",
    icon: PenTool,
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("whiteboard"),
    supportsPatientContext: false,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "game",
    icon: Gamepad2,
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("game"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
];

// ─── Registry map ─────────────────────────────────────────────────────────

const REGISTRY = new Map<string, PlaygroundWorkspaceDefinition>(
  DEFINITIONS.map((d) => [d.type, d]),
);

export function getWorkspaceDefinition(type: string): PlaygroundWorkspaceDefinition | undefined {
  return REGISTRY.get(type);
}

export function registerWorkspaceDefinition(def: PlaygroundWorkspaceDefinition): void {
  REGISTRY.set(def.type, def);
}

export function getAllWorkspaceDefinitions(): PlaygroundWorkspaceDefinition[] {
  return Array.from(REGISTRY.values());
}
