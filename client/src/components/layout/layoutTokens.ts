/**
 * Plexus OS — canonical layout tokens (single source of truth for page-level
 * structure). These consolidate the spacing / max-width / control-height
 * values that were previously scattered across pages (px-4/5/6, max-w-1280/
 * 1400/1520/5xl/6xl/7xl, gap-4/5/6, etc.) into one referenced scale.
 *
 * PURPOSE: standardization only. These mirror the dominant existing values
 * (the `.finance-page` template + `PlexusPageInner`) so adopting them is a
 * consolidation, not a redesign. Color/radius/shadow tokens continue to live
 * in client/src/index.css (--finance-*, --plexus-*) and tailwind.config.ts;
 * this module owns *structure* (rhythm + sizing), not palette.
 */

/**
 * Canonical page content max-widths. The centered content column caps at one
 * of these so no two standard pages disagree on gutter width.
 *   - narrow : focused reading / settings / forms
 *   - default: the standard operational page
 *   - wide   : dense tables / multi-column dashboards
 *   - full   : master-detail / full-bleed surfaces manage their own width
 */
export const PAGE_MAX_WIDTH = {
  narrow: "max-w-[1024px]",
  default: "max-w-[1400px]",
  wide: "max-w-[1600px]",
  full: "max-w-none",
} as const;
export type PageWidth = keyof typeof PAGE_MAX_WIDTH;

/**
 * Canonical page padding. Responsive by design (task: responsiveness) so
 * narrow browsers get a tighter gutter instead of a fixed px-6 everywhere.
 * Top spacing is a touch larger than sides; bottom leaves room above the fold.
 */
export const PAGE_PADDING_X = "px-4 sm:px-6 lg:px-8" as const;
export const PAGE_PADDING_Y = "pt-6 pb-16" as const;

/** Section-to-section vertical rhythm inside a page (24px). */
export const PAGE_SECTION_GAP = "gap-6" as const;

/** Canonical control heights (buttons / inputs / selects). */
export const CONTROL_HEIGHT = {
  sm: "h-8", // 32px — dense toolbars
  md: "h-9", // 36px — default
  lg: "h-10", // 40px — prominent primary actions
} as const;

/**
 * Canonical z-index layers. Kept in sync with the shell (TopBanner, dock,
 * workspace tabs) so overlays never fight the chrome.
 */
export const Z_INDEX = {
  base: 0,
  content: 1,
  sticky: 10,
  header: 20,
  dropdown: 30,
  overlay: 40,
  modal: 50,
  toast: 60,
} as const;

/**
 * Tailwind breakpoints (mirror of tailwind defaults) — referenced by
 * responsive logic so JS-side media checks match the CSS scale.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;
