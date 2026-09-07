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
  /**
   * The user id that owned this workspace session. Restore is refused when the
   * current owner does not match — so a logout→login in the SAME browser tab
   * (sessionStorage survives an SPA logout) can never surface the previous
   * user's open patient tabs / PHI descriptors to the next user (Scenario G).
   */
  ownerUserId?: string | null;
};

/** Save current workspace state to sessionStorage, stamped with the owner. */
export function saveSession(
  workspaces: PlaygroundWorkspace[],
  activeId: string | null,
  ownerUserId?: string | null,
): void {
  try {
    const session: PersistedSession = {
      ownerUserId: ownerUserId ?? null,
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

/**
 * Restore workspace descriptors from sessionStorage.
 *
 * FAIL-CLOSED owner scoping (Scenario G): the persisted workspace descriptors
 * carry PHI (patient names, screening/execution-case ids, tab labels), so they
 * are restored ONLY when the session can be POSITIVELY attributed to the
 * current authenticated owner. It returns null — surfacing NO patient state —
 * in every unproven case:
 *   • current owner unknown (auth not yet resolved): the persisted session is
 *     LEFT INTACT so a later call with the resolved owner can still match;
 *   • persisted session has no owner (legacy / pre-owner-scoping): treated as
 *     unattributable PHI and CLEARED;
 *   • persisted owner differs from the current owner (foreign): CLEARED;
 *   • payload malformed, stale (>24h), or empty.
 * Only an exact owner match restores.
 */
export function restoreSession(
  ownerUserId?: string | null,
): { workspaces: PlaygroundWorkspace[]; activeId: string | null } | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable
  }
  if (!raw) return null;

  let session: PersistedSession;
  try {
    session = JSON.parse(raw) as PersistedSession;
  } catch {
    // Malformed junk — remove it and fail safe (never surface partial state).
    clearSession();
    return null;
  }

  // ── Fail-closed owner gate ────────────────────────────────────────────────
  const persistedOwner = session.ownerUserId ?? null;
  if (ownerUserId == null) {
    // Current owner unknown (auth still resolving). Never surface PHI, and do
    // NOT clear — the resolved owner may legitimately own this session.
    return null;
  }
  if (persistedOwner == null || persistedOwner !== ownerUserId) {
    // Legacy/unowned OR another user's session — never restore, and clear the
    // unattributable/foreign entry so it cannot linger or be re-read.
    clearSession();
    return null;
  }

  // Positive owner match beyond this point.
  try {
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
