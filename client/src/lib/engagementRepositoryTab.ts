/**
 * Phase 2C — Engagement Center default-tab resolver.
 *
 * Behavior contract:
 *
 *   FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY (client-side flag) = OFF:
 *     Default tab is "pool" (unchanged).
 *
 *   ON:
 *     Priority:
 *       1. Valid explicit URL tab (?tab=... where value is a recognized tab)
 *       2. Fallback → "repository"
 *     Invalid or missing → "repository"
 *
 * Recognized tab values (kept in lockstep with the engagement-center
 * component). "repository" is the new Phase 2C tab.
 */

export const ENGAGEMENT_TABS_LEGACY = [
  "pool",
  "callResults",
  "callSettings",
] as const;
export const ENGAGEMENT_TAB_REPOSITORY = "repository" as const;

export type EngagementTabLegacy = (typeof ENGAGEMENT_TABS_LEGACY)[number];
export type EngagementTab = EngagementTabLegacy | typeof ENGAGEMENT_TAB_REPOSITORY;

const ALL_TABS: readonly string[] = [
  ...ENGAGEMENT_TABS_LEGACY,
  ENGAGEMENT_TAB_REPOSITORY,
];

/**
 * Resolve the current tab from a URL search string + client-side
 * feature flag. Pure function — safe to test without a DOM.
 *
 * @param searchString `location.search` (e.g. "?tab=repository"). May be empty.
 * @param flagOn       Whether FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY is ON.
 * @param savedPreference Optional saved preference from user profile.
 *                        Only honored when the tab is currently valid.
 */
export function resolveEngagementTab(
  searchString: string,
  flagOn: boolean,
  savedPreference?: string | null,
): EngagementTab {
  // Parse explicit ?tab= param.
  let explicit: string | null = null;
  try {
    // Empty string is fine — URLSearchParams handles it.
    const params = new URLSearchParams(searchString || "");
    explicit = params.get("tab");
  } catch {
    explicit = null;
  }

  const isValid = (t: unknown): t is EngagementTab =>
    typeof t === "string" && ALL_TABS.includes(t);

  if (flagOn) {
    // 1) Valid explicit → win
    if (isValid(explicit)) return explicit;
    // 2) Saved preference — only when currently valid
    if (isValid(savedPreference)) return savedPreference;
    // 3) Repository fallback
    return ENGAGEMENT_TAB_REPOSITORY;
  }

  // Flag OFF: legacy behavior. Valid explicit legacy tab wins; else
  // fall back to "pool". Repository is NOT accessible while the flag
  // is OFF — treat it as invalid so stale localStorage or a bookmarked
  // repository URL doesn't accidentally activate the new UI.
  if (explicit && (ENGAGEMENT_TABS_LEGACY as readonly string[]).includes(explicit)) {
    return explicit as EngagementTabLegacy;
  }
  if (savedPreference && (ENGAGEMENT_TABS_LEGACY as readonly string[]).includes(savedPreference)) {
    return savedPreference as EngagementTabLegacy;
  }
  return "pool";
}

/**
 * Reverse — build a URL search string for a given tab. Preserves other
 * params from the input.
 */
export function buildEngagementTabSearchString(
  currentSearchString: string,
  tab: EngagementTab,
): string {
  const params = new URLSearchParams(currentSearchString || "");
  params.set("tab", tab);
  return `?${params.toString()}`;
}
