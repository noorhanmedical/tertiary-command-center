// Playground session persistence — save/restore workspace tab descriptors.
//
// Persists: open workspace descriptors, active workspace ID, pinned state, order.
// Does NOT persist: unsaved draft content, sensitive clinical text, workspaceState.
// On reload: restores clean workspace tabs that can refetch their data.

import type { PlaygroundWorkspace, PlaygroundWorkspaceType } from "./types";

const STORAGE_KEY = "plexus_playground_session";

type PersistedWorkspace = {
  id: string;
  type: PlaygroundWorkspaceType;
  title: string;
  subtitle?: string;
  patientId?: number | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceKey?: string | null;
  facilityId?: number | string | null;
  pinned: boolean;
  createdAt: number;
};

type PersistedSession = {
  workspaces: PersistedWorkspace[];
  activeWorkspaceId: string | null;
  savedAt: number;
};

/** Save current workspace state to sessionStorage. */
export function saveSession(workspaces: PlaygroundWorkspace[], activeId: string | null): void {
  try {
    const session: PersistedSession = {
      workspaces: workspaces.map((ws) => ({
        id: ws.id,
        type: ws.type,
        title: ws.title,
        subtitle: ws.subtitle,
        patientId: ws.patientId,
        patientScreeningId: ws.patientScreeningId,
        executionCaseId: ws.executionCaseId,
        ancillaryCaseId: ws.ancillaryCaseId,
        serviceKey: ws.serviceKey,
        facilityId: ws.facilityId,
        pinned: ws.pinned,
        createdAt: ws.createdAt,
      })),
      activeWorkspaceId: activeId,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch { /* storage unavailable */ }
}

/** Restore workspace descriptors from sessionStorage. Returns null if none. */
export function restoreSession(): { workspaces: PlaygroundWorkspace[]; activeId: string | null } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session: PersistedSession = JSON.parse(raw);
    // Reject stale sessions (> 24 hours).
    if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) return null;
    if (!session.workspaces || session.workspaces.length === 0) return null;

    const workspaces: PlaygroundWorkspace[] = session.workspaces.map((pw) => ({
      id: pw.id,
      type: pw.type,
      title: pw.title,
      subtitle: pw.subtitle,
      patientId: pw.patientId ?? null,
      patientScreeningId: pw.patientScreeningId ?? null,
      executionCaseId: pw.executionCaseId ?? null,
      ancillaryCaseId: pw.ancillaryCaseId ?? null,
      serviceKey: pw.serviceKey ?? null,
      facilityId: pw.facilityId ?? null,
      pinned: pw.pinned,
      dirty: false,
      createdAt: pw.createdAt,
      lastActivatedAt: Date.now(),
    }));

    return { workspaces, activeId: session.activeWorkspaceId };
  } catch {
    return null;
  }
}

/** Clear persisted session. */
export function clearSession(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
