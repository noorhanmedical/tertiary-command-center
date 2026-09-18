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

/* ══════════════════════════════════════════════════════════════════════
   DESIGN-SYSTEM PILOT — authoritative shared tokens (§ 3-page pilot).
   Consumed identically by Plexus EHR, Plexus IQ, and Plexus Bank so the
   three workflow families read as one product. Additive: these name the
   values the pilots standardize on; they do not change the palette (which
   stays in index.css) or any existing consumer.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Typography scale (Tailwind classes). The page title is delegated to
 * InteriorPageTitle; the rest are the in-body text roles.
 */
export const TYPOGRAPHY = {
  /** In-body section heading (delegated to SectionHeader). */
  sectionTitle: "text-[18px] font-semibold leading-6 tracking-[-0.01em]",
  /** Card / panel heading. */
  cardTitle: "text-[15px] font-semibold leading-5",
  /** Default body text. */
  body: "text-sm leading-5",
  /** Secondary / supporting text. */
  secondary: "text-sm text-finance-text-secondary",
  /** Caption / metadata / eyebrow. */
  caption: "text-xs text-finance-text-muted",
} as const;

/**
 * The canonical interior page-header band (the row that hosts
 * InteriorPageTitle + page-level actions). One padding value for all three
 * pilots so header height is identical: 24px top, 16px bottom, page gutter
 * left/right, hairline underneath.
 */
export const PAGE_HEADER_BAND =
  "shrink-0 px-6 pt-6 pb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/50" as const;

/** In-body / master-detail spacing (px values expressed as Tailwind). */
export const SPACING = {
  /** Master-detail right-pane / content padding. */
  panePadding: "p-6",
  /** Card internal padding (matches PlexusCard `md`/`lg`). */
  cardPadding: "p-5",
  /** Gap between cards / metric tiles. */
  cardGap: "gap-4",
  /** Gap between form fields. */
  formGap: "gap-4",
  /** Table cell padding (x/y). */
  tableCell: "px-4 py-2.5",
} as const;

/** Control + surface geometry (radii + fixed sizes). */
export const GEOMETRY = {
  /** Card / panel radius. */
  cardRadius: "rounded-2xl",
  /** Control radius (buttons / inputs / selects). */
  controlRadius: "rounded-lg",
  /** Modal / drawer radius. */
  modalRadius: "rounded-2xl",
  /** Module sidebar (secondary in-page rail, e.g. Plexus Bank) width. */
  moduleSidebarWidth: "w-[248px]",
  /** Master-detail left (directory) pane width. */
  directoryPaneWidth: "w-[320px]",
  /** Module-sidebar row height. */
  sidebarRowHeight: "h-9",
} as const;

/** Global navigation chrome sizing (mirrors the shell). */
export const NAV = {
  /** Left global rail width (shell SIDEBAR_STYLE --sidebar-width = 18rem). */
  railWidth: "w-72",
  /** Workspace-tab strip height. */
  workspaceTabHeight: "h-10",
  /** In-page tab height. */
  tabHeight: "h-9",
} as const;

/** Canonical icon sizes (Tailwind h/w). */
export const ICON_SIZE = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;
