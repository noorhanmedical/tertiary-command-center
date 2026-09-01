/**
 * Plexus Winter UI/UX — shared token constants (§3, §29, §60, §70).
 *
 * These mirror the CSS custom properties declared under the `.plexus-ui`
 * scope in client/src/index.css. They exist so TS/JS callers (status maps,
 * chart palettes) reference one source of truth instead of hardcoding hex.
 *
 * IMPORTANT: purely additive. No live theme token is referenced or changed.
 */

export const plexusColors = {
  // Shell
  shell: "#070A10",
  shell2: "#0B0F17",
  navyDeep: "#111A2E",
  navy: "#18243B",
  navyLight: "#25344F",
  // Typography
  text: "#182234",
  textSecondary: "#5F6F86",
  textMuted: "#7E8CA1",
  textDisabled: "#A7B2C1",
  white: "#FFFFFF",
  // Winter backgrounds
  winterBase: "#EDF5FC",
  winterLight: "#F4F8FC",
  winterHighlight: "#F8FBFE",
  icy: "#E4EFFA",
  cool: "#D8E8F7",
  // Accents
  blue: "#5F7EEA",
  blueHover: "#4E6ED9",
  blueSoft: "#E9EFFD",
  steel: "#6D8FBF",
  purple: "#7564D8",
  purpleSoft: "#EEEAFB",
  green: "#1FA870",
  greenSoft: "#EAF7F1",
  warning: "#C58A36",
  warningSoft: "#FFF5E7",
  error: "#D9545D",
  errorSoft: "#FBECEF",
  edge: "#E8EEF5",
  divider: "#E3EAF2",
} as const;

/** Restrained chart palette (§51). Semantic where possible. */
export const plexusChartPalette = [
  plexusColors.blue,
  plexusColors.green,
  plexusColors.purple,
  plexusColors.warning,
  plexusColors.error,
] as const;

/** Motion durations in ms (§70). */
export const plexusMotion = {
  fast: 140,
  normal: 200,
  slow: 280,
} as const;

/**
 * Semantic status tokens (§29). One canonical definition per state — exact
 * wording, foreground, soft background. Consumed by StatusBadge and rows so
 * the same state never renders with different wording/color across routes.
 */
export type PlexusStatusTone =
  | "ready"
  | "pending"
  | "review"
  | "scheduled"
  | "completed"
  | "blocked"
  | "error"
  | "needs-intake"
  | "neutral";

export interface PlexusStatusStyle {
  fg: string;
  bg: string;
  border: string;
}

export const plexusStatusStyles: Record<PlexusStatusTone, PlexusStatusStyle> = {
  ready: { fg: plexusColors.green, bg: plexusColors.greenSoft, border: "rgba(31,168,112,0.22)" },
  completed: { fg: plexusColors.green, bg: plexusColors.greenSoft, border: "rgba(31,168,112,0.22)" },
  pending: { fg: plexusColors.warning, bg: plexusColors.warningSoft, border: "rgba(197,138,54,0.24)" },
  "needs-intake": { fg: plexusColors.warning, bg: plexusColors.warningSoft, border: "rgba(197,138,54,0.24)" },
  review: { fg: plexusColors.purple, bg: plexusColors.purpleSoft, border: "rgba(117,100,216,0.22)" },
  scheduled: { fg: plexusColors.blue, bg: plexusColors.blueSoft, border: "rgba(95,126,234,0.24)" },
  blocked: { fg: plexusColors.error, bg: plexusColors.errorSoft, border: "rgba(217,84,93,0.24)" },
  error: { fg: plexusColors.error, bg: plexusColors.errorSoft, border: "rgba(217,84,93,0.24)" },
  neutral: { fg: plexusColors.textSecondary, bg: "rgba(126,140,161,0.10)", border: "rgba(126,140,161,0.22)" },
};

/** Canonical billing / claim states (§60). Exact wording + tone. */
export const plexusBillingStatus: Record<
  "submitted" | "pending" | "paid" | "denied" | "rejected" | "appealed",
  { label: string; tone: PlexusStatusTone }
> = {
  submitted: { label: "Submitted", tone: "scheduled" },
  pending: { label: "Pending", tone: "pending" },
  paid: { label: "Paid", tone: "completed" },
  denied: { label: "Denied", tone: "error" },
  rejected: { label: "Rejected", tone: "error" },
  appealed: { label: "Appealed", tone: "review" },
};
