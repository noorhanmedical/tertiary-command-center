// Phase 2I — PCS pagination state machine (pure + testable).
//
// The PCS canonical view has THREE independent continuation contracts, each with
// its own cursor: verified-patient pages (`cursor`), identity-unresolved pages
// (`unresolvedCursor`), and a single verified patient's episode continuation
// (`episodeMembershipId` + `episodeCursor`). This module turns explicit user
// actions into typed request params — every param flows into the React Query key,
// so distinct states = distinct requests (one request per action, never ambiguous
// cursor concatenation). A continuation request is produced ONLY by an action.

export type PcsPaginationState = {
  cursor: string | null;             // verified-patient page cursor
  unresolvedCursor: string | null;   // identity-unresolved page cursor
  // Active episode continuation for ONE exact membership, or null.
  episode: { membershipId: number; cursor: string | null } | null;
};

export type PcsPaginationAction =
  | { type: "verifiedFirst" }
  | { type: "verifiedNext"; cursor: string | null }
  | { type: "unresolvedFirst" }
  | { type: "unresolvedNext"; cursor: string | null }
  | { type: "episodeNext"; membershipId: number; cursor: string | null }
  | { type: "episodeBack" };

export const INITIAL_PCS_PAGINATION: PcsPaginationState = { cursor: null, unresolvedCursor: null, episode: null };

export function pcsPaginationReducer(state: PcsPaginationState, action: PcsPaginationAction): PcsPaginationState {
  switch (action.type) {
    case "verifiedFirst": return { ...state, cursor: null, episode: null };
    case "verifiedNext": return { ...state, cursor: action.cursor, episode: null };
    case "unresolvedFirst": return { ...state, unresolvedCursor: null, episode: null };
    case "unresolvedNext": return { ...state, unresolvedCursor: action.cursor, episode: null };
    // Episode continuation is a distinct mode: while active, only the episode
    // params are sent (the server returns just that patient's next episode page).
    case "episodeNext": return { ...state, episode: { membershipId: action.membershipId, cursor: action.cursor } };
    case "episodeBack": return { ...state, episode: null };
    default: return state;
  }
}

export type PcsRequestParams = {
  cursor: string | null;
  unresolvedCursor: string | null;
  episodeMembershipId: number | null;
  episodeCursor: string | null;
};

/** Typed request params for a pagination state. In episode-continuation mode ONLY
 *  the episode params are populated (matching the server's continuation mode). */
export function pcsRequestParams(state: PcsPaginationState): PcsRequestParams {
  if (state.episode) {
    return { cursor: null, unresolvedCursor: null, episodeMembershipId: state.episode.membershipId, episodeCursor: state.episode.cursor };
  }
  return { cursor: state.cursor, unresolvedCursor: state.unresolvedCursor, episodeMembershipId: null, episodeCursor: null };
}

/** Stable React Query key parts — every param included so distinct states fetch
 *  distinctly (never a concatenated ambiguous cursor). */
export function pcsQueryKey(p: PcsRequestParams): readonly [string, string, string, string, string] {
  return ["/api/pcs/canonical-view", p.cursor ?? "", p.unresolvedCursor ?? "", p.episodeMembershipId == null ? "" : String(p.episodeMembershipId), p.episodeCursor ?? ""] as const;
}

/** Query string for the request (only non-empty params are appended). */
export function pcsQueryString(p: PcsRequestParams): string {
  const q = new URLSearchParams();
  if (p.cursor) q.set("cursor", p.cursor);
  if (p.unresolvedCursor) q.set("unresolvedCursor", p.unresolvedCursor);
  if (p.episodeMembershipId != null) q.set("episodeMembershipId", String(p.episodeMembershipId));
  if (p.episodeCursor) q.set("episodeCursor", p.episodeCursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}
