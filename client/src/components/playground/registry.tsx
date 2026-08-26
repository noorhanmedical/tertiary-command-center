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
} from "lucide-react";
import { NovaDockIcon } from "@/components/nova/NovaDockIcon";
import type { PlaygroundWorkspaceDefinition, PlaygroundWorkspace, PlaygroundWorkspaceType } from "./types";

// ─── Placeholder renderers (replaced by real components during wiring) ────

function PlaceholderWorkspace({ workspace }: { workspace: PlaygroundWorkspace; isActive: boolean }) {
  return (
    <div className="flex h-full items-center justify-center text-slate-400" data-testid={`workspace-placeholder-${workspace.type}`}>
      <div className="text-center space-y-2">
        <div className="text-lg font-medium text-slate-600">{workspace.title}</div>
        <div className="text-sm">Workspace: {workspace.type}</div>
        {workspace.patientScreeningId && <div className="text-xs">Patient #{workspace.patientScreeningId}</div>}
      </div>
    </div>
  );
}

function PlaygroundHomeWorkspace() {
  return (
    <div className="flex h-full items-center justify-center" data-testid="workspace-playground-home">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-2xl font-light text-slate-300 tracking-wide">Your Playground</div>
        <p className="text-sm text-slate-400">Select a patient or open a workspace from the dock, rails, or work queue.</p>
      </div>
    </div>
  );
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
    render: PlaceholderWorkspace, // Wired in task #6
    dedupeKey: patientDedupeKey,
    supportsPatientContext: true,
    supportsDirtyState: false,
    keepAlive: false, // Unmount inactive EHRs for performance
  },
  {
    type: "call",
    icon: Phone,
    titleResolver: (ws) => ws.title || "Call",
    render: PlaceholderWorkspace,
    dedupeKey: patientWorkspaceDedupeKey("call"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "tasks",
    icon: CheckSquare,
    render: PlaceholderWorkspace,
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
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("schedule"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "calendar",
    icon: CalendarDays,
    render: PlaceholderWorkspace,
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
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("email"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true,
  },
  {
    type: "documents",
    icon: FileText,
    render: PlaceholderWorkspace,
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
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("quick_note"),
    supportsPatientContext: true,
    supportsDirtyState: true,
    keepAlive: true,
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
    render: PlaceholderWorkspace,
    dedupeKey: singletonDedupeKey("contacts"),
    supportsPatientContext: false,
    supportsDirtyState: false,
    keepAlive: true,
  },
  {
    type: "nova",
    icon: NovaDockIcon,
    render: PlaceholderWorkspace,
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
    render: PlaceholderWorkspace,
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
