/**
 * Plexus EHR — authoritative visual token layer.
 *
 * One source of truth for the EHR chart's winter palette so components stop
 * hand-rolling divergent hex. These mirror the already-approved values used
 * across PatientChart / PatientChartSections; adopting them is a consolidation,
 * not a re-theme. Raw values are exposed for the few places that need inline
 * `style={{}}` (gradients, borders) and Tailwind class strings for the rest.
 */

/** Raw hex values (for inline styles: gradients, borderColor, etc.). */
export const EHR_HEX = {
  // ── Tonal elevation ladder ──────────────────────────────────────────────
  // Interactive chrome/controls (rails, toolbars, selected rows) sit in the
  // DARKER cool-winter hue; the workspace canvas is paler; content cards are
  // white. Reads: control (darkest) → canvas (pale) → surface (white).
  control: "#E4EAF3", // directory rail / chart-nav rail / control chrome (darkest)
  controlBorder: "#D3DCE8", // hairline on control surfaces
  canvas: "#F3F6FA", // app winter canvas behind the chart (paler than control)
  surface: "#FFFFFF", // elevated white clinical surface
  surfaceMuted: "#F7F9FC", // legacy secondary surface (superseded by `control`)
  selected: "#DCE6F5", // single icy-blue selected/active surface (rows + nav)
  documentSurround: "#eef4fb", // pale winter surround behind a document page
  // Text
  textPrimary: "#0F172A", // deep navy — headings
  textStrong: "#263B63", // navy — active nav label
  textSecondary: "#667085", // slate — secondary metadata
  textMuted: "#8592A6", // muted metadata
  textFaint: "#98A2B3", // group labels / faint captions
  // Accents / status
  accentBlue: "#3169E8", // informational / active blue
  primaryBlue: "#3169E8", // THE one primary blue (active/selected/links/accents)
  // Borders
  border: "#E2E8F0", // subtle cool-gray hairline
  borderSoft: "#EDF1F5",
} as const;

/** Tailwind class strings for common EHR surfaces/text/status. */
export const EHR_CLS = {
  cardBorder: "border-slate-200/80 dark:border-border/60",
  divider: "border-slate-100 dark:border-border/50",
  textPrimary: "text-slate-900 dark:text-slate-100",
  textSecondary: "text-slate-600 dark:text-slate-300",
  textMuted: "text-slate-500",
  groupLabel: "text-[11px] font-semibold uppercase tracking-wide text-slate-400",
  // Status tones (foreground / soft background) — restrained, semantic.
  success: "text-emerald-700",
  successChip: "bg-emerald-50 text-emerald-700",
  warning: "text-amber-600",
  warningChip: "bg-amber-50 text-amber-700",
  danger: "text-rose-700",
  dangerChip: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
  info: "text-[#3169E8]",
  infoChip: "bg-[#E8EEF8] text-[#263B63]",
  neutralChip: "bg-slate-100 text-slate-700 dark:bg-muted/40 dark:text-slate-200",
} as const;
