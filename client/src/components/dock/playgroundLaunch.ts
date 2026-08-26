// Playground launch contract — a consistent interface for any component
// to request "Open this in Playground" without knowing the tab system internals.
//
// Phase 4 will build the full workspace tab engine. This contract allows
// dock apps, Nova, and other surfaces to emit a launch request NOW that
// the engine can consume later.

export type PlaygroundLaunchRequest = {
  /** Workspace type key (e.g. "nova", "call", "tasks", "calendar", "patient_ehr"). */
  workspaceType: string;
  /** Tab title. */
  title: string;
  /** Optional patient context. */
  patientId?: number | null;
  patientScreeningId?: number | null;
  /** Optional case/service context. */
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceKey?: string | null;
  /** Optional focus target within the workspace. */
  focusSection?: string | null;
  focusObjectId?: number | string | null;
  /** Optional document/appointment/task context. */
  documentId?: number | null;
  appointmentId?: number | null;
  taskId?: number | null;
  conversationId?: string | null;
  /** Arbitrary metadata for the workspace. */
  metadata?: Record<string, unknown>;
};

/** Callback type for launching a workspace in Playground. */
export type OpenInPlaygroundFn = (request: PlaygroundLaunchRequest) => void;

/** No-op placeholder until Phase 4 workspace engine is built. Logs the
 *  request to console so developers can verify the contract fires. */
export const openInPlaygroundStub: OpenInPlaygroundFn = (request) => {
  // eslint-disable-next-line no-console
  console.log("[openInPlayground] launch request (Phase 4 will handle):", request);
};
