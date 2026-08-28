// Playground Workspace Engine — canonical types.
//
// One universal model for every workspace tab in the Playground.
// Extensible via PlaygroundWorkspaceDefinition registry.

import type { ComponentType, ReactNode } from "react";

// ─── Workspace Types ──────────────────────────────────────────────────────

export type PlaygroundWorkspaceType =
  | "playground_home"
  | "patient_ehr"
  | "ancillary_workflow"
  | "call"
  | "tasks"
  | "task"
  | "schedule"
  | "calendar"
  | "message_thread"
  | "team_chat"
  | "email"
  | "documents"
  | "document"
  | "report"
  | "quick_note"
  | "sticky_notes"
  | "contacts"
  | "nova"
  | "team_ops"
  | "invoice_desk"
  | "patient_search"
  | "scripts"
  | "proof_pdfs"
  | "custom_tool"
  // Future:
  | "whiteboard"
  | "game"
  | "analytics"
  | "plexus_iq"
  | "engagement"
  | "nucleus";

// ─── Workspace Instance ───────────────────────────────────────────────────

export type PlaygroundWorkspace = {
  /** Unique ID for this workspace instance. */
  id: string;
  /** Workspace type (determines renderer + behavior). */
  type: PlaygroundWorkspaceType;
  /** Tab display title (concise). */
  title: string;
  /** Optional subtitle / secondary context. */
  subtitle?: string;
  /** Optional icon override (falls back to type default). */
  icon?: ComponentType<{ className?: string }>;

  // ── Context (all optional) ──
  patientId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceEpisodeId?: number | string | null;
  serviceKey?: string | null;
  documentId?: number | string | null;
  appointmentId?: number | string | null;
  taskId?: number | string | null;
  conversationId?: number | string | null;
  focusSection?: string | null;
  focusObjectId?: number | string | null;
  /**
   * One-shot focus token. Bumped by the provider every time this workspace is
   * (re)opened with focus intent. Renderers consume it exactly once (scroll +
   * highlight + expand) by tracking the last value they acted on, so focus does
   * NOT retrigger on every React render.
   */
  focusToken?: number;
  facilityId?: number | string | null;

  /** Where this workspace was launched from. */
  source?: { kind: string; id?: string | number; label?: string };

  // ── State ──
  pinned: boolean;
  dirty: boolean;
  dirtyDescription?: string;
  createdAt: number; // Date.now()
  lastActivatedAt: number;
  /** Serializable workspace-specific state (scroll pos, filters, etc.). */
  workspaceState?: unknown;
};

// ─── Workspace Definition (registry entry) ────────────────────────────────

export type WorkspaceRenderProps = {
  workspace: PlaygroundWorkspace;
  isActive: boolean;
};

export type PlaygroundWorkspaceDefinition = {
  /** Matches PlaygroundWorkspaceType. */
  type: PlaygroundWorkspaceType;
  /** Default icon for tabs of this type. */
  icon: ComponentType<{ className?: string }>;
  /** Resolve the tab title from the workspace instance. */
  titleResolver?: (ws: PlaygroundWorkspace) => string;
  /** The React component that renders this workspace's content. */
  render: ComponentType<WorkspaceRenderProps>;
  /** Function to derive a deduplication key from a workspace.
   *  Workspaces with the same dedupeKey are considered the same tab. */
  dedupeKey: (ws: Partial<PlaygroundWorkspace>) => string;
  /** Whether this workspace type uses patient context. */
  supportsPatientContext: boolean;
  /** Whether this workspace can enter a dirty/unsaved state. */
  supportsDirtyState: boolean;
  /** Whether to keep the workspace mounted when inactive (expensive types should be false). */
  keepAlive: boolean;
};

// ─── Open Request (the universal launcher input) ──────────────────────────

export type OpenInPlaygroundRequest = {
  type: PlaygroundWorkspaceType;
  title?: string;
  subtitle?: string;
  patientId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceEpisodeId?: number | string | null;
  serviceKey?: string | null;
  documentId?: number | string | null;
  appointmentId?: number | string | null;
  taskId?: number | string | null;
  conversationId?: number | string | null;
  focusSection?: string | null;
  focusObjectId?: number | string | null;
  facilityId?: number | string | null;
  source?: { kind: string; id?: string | number; label?: string };
  /** If true, always create a new tab even if a matching one exists. */
  forceNew?: boolean;
};

// ─── Provider API ─────────────────────────────────────────────────────────

export type PlaygroundWorkspaceAPI = {
  workspaces: PlaygroundWorkspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: PlaygroundWorkspace | null;

  openWorkspace: (request: OpenInPlaygroundRequest) => string; // returns workspace id
  focusWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  closeOtherWorkspaces: (keepId: string) => void;
  closeAllWorkspaces: () => void;
  pinWorkspace: (id: string, pinned: boolean) => void;
  setDirty: (id: string, dirty: boolean, description?: string) => void;
  updateWorkspace: (id: string, patch: Partial<PlaygroundWorkspace>) => void;
  reorderWorkspace: (fromIndex: number, toIndex: number) => void;
  goHome: () => void;

  /**
   * Register a workspace-owned save handler. Returns an unregister fn (call it
   * on unmount). The handler runs when the user picks "Save & Close" on a dirty
   * workspace. Resolve `true` on a successful canonical save, `false`/throw to
   * keep the workspace open. Reusable by any dirty-capable workspace (Call,
   * Quick Note, Email, Tasks, ...).
   */
  registerSaveHandler: (id: string, handler: () => Promise<boolean>) => () => void;
  /** Invoke a workspace's registered save handler (if any). Returns success. */
  saveWorkspace: (id: string) => Promise<boolean>;

  /** The current foreground patient (derived from active workspace). */
  foregroundPatientId: number | null;
};
