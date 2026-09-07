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

// ── Phase 5B: owner + execution-case scoped call-interaction drafts ──────────
// In-progress disposition input (outcome / notes / callback) persisted so it
// survives Phone↔Calendar switches, Atlas/history navigation, transient
// refetches, a booking conflict, and a hard refresh. Keyed by BOTH the
// authenticated owner AND the execution case: the owner is part of the key, so
// it is impossible for a different user to READ another user's draft, and
// drafts never bleed across patients. Client/session only — NEVER autosaved to
// the server (no approved server draft API). Reuses the same owner-scoping
// discipline as the workspace session above.

export type CallInteractionDraft = {
  outcome: string | null;
  notes: string;
  callbackAt: string | null;
  savedAt: number;
};

const DRAFT_PREFIX = "plexus_call_draft";

function draftKey(ownerUserId: string, executionCaseId: number): string {
  return `${DRAFT_PREFIX}:${ownerUserId}:${executionCaseId}`;
}

/** Save the in-progress draft for THIS owner + case. Fails closed (no-op) when
 *  the owner is unknown — PHI notes are never persisted without an owner. An
 *  empty draft clears the key instead of storing a blank. */
export function saveCallDraft(
  ownerUserId: string | null | undefined,
  executionCaseId: number | null | undefined,
  draft: Omit<CallInteractionDraft, "savedAt">,
): void {
  if (!ownerUserId || executionCaseId == null || executionCaseId <= 0) return;
  const meaningful = draft.outcome != null || draft.notes.trim().length > 0;
  try {
    const key = draftKey(ownerUserId, executionCaseId);
    if (!meaningful) {
      sessionStorage.removeItem(key);
      return;
    }
    const payload: CallInteractionDraft = { ...draft, savedAt: Date.now() };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage unavailable */
  }
}

/** Load the draft for THIS owner + case. Returns null when absent, malformed,
 *  stale (>24h), or when the owner is unknown (fail closed). */
export function loadCallDraft(
  ownerUserId: string | null | undefined,
  executionCaseId: number | null | undefined,
): CallInteractionDraft | null {
  if (!ownerUserId || executionCaseId == null || executionCaseId <= 0) return null;
  const key = draftKey(ownerUserId, executionCaseId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as CallInteractionDraft;
    if (typeof d.savedAt !== "number" || Date.now() - d.savedAt > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      outcome: d.outcome ?? null,
      notes: typeof d.notes === "string" ? d.notes : "",
      callbackAt: d.callbackAt ?? null,
      savedAt: d.savedAt,
    };
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* noop */ }
    return null;
  }
}

/** Clear one case's draft for this owner (on successful disposition / done). */
export function clearCallDraft(
  ownerUserId: string | null | undefined,
  executionCaseId: number | null | undefined,
): void {
  if (!ownerUserId || executionCaseId == null) return;
  try {
    sessionStorage.removeItem(draftKey(ownerUserId, executionCaseId));
  } catch {
    /* noop */
  }
}

/** Clear ALL call drafts (every owner) in this tab — called on logout so no
 *  prior user's PHI draft lingers. Owner-in-key already blocks a DIFFERENT user
 *  from reading them; this is defense-in-depth cleanup on owner change. */
export function clearAllCallDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`${DRAFT_PREFIX}:`)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* noop */
  }
}
