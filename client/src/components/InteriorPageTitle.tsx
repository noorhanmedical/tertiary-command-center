/**
 * InteriorPageTitle — the canonical first-level interior page title.
 *
 * Visual reference: the Global Schedule header. The title area contains ONLY
 * the base title, an optional secondary "major context" suffix, and the navy
 * gradient hairline. It owns typography, the dash, context color, the context
 * phase-in transition, the hairline, and spacing. It owns NO actions, icons,
 * buttons, filters, search, dropdowns, badges, or eyebrow text — those live
 * below the hairline in a toolbar/content area.
 *
 * Anatomy:
 *   BASE TITLE  [ — MAJOR CONTEXT ]
 *   ─────────────────────────────── (hairline)
 *
 * The context suffix is a single level only (BASE — CONTEXT). It should be
 * driven by true navigation/major-context state, never by filter state.
 */

// Interior titles standardize on the Avenir Next stack (set explicitly so the
// treatment holds regardless of the surrounding cascade / scoped surfaces).
const TITLE_FONT_FAMILY = '"Avenir Next", "Helvetica Neue", Arial, sans-serif';

export interface InteriorPageTitleProps {
  /** Base page title, e.g. "Plexus IQ". */
  title: string;
  /**
   * Optional major-context suffix, e.g. a selected clinic/facility or major
   * subsection. Rendered as `— Context` in a restrained lighter blue. Pass
   * null/undefined/empty to show the base title only (no dash, no placeholder).
   */
  context?: string | null;
  /** Override the data-testid on the title element. */
  titleTestId?: string;
  className?: string;
}

export function InteriorPageTitle({
  title,
  context,
  titleTestId = "text-page-title",
  className = "",
}: InteriorPageTitleProps) {
  const trimmedContext = typeof context === "string" ? context.trim() : "";
  const hasContext = trimmedContext.length > 0;

  return (
    <div className={className} data-testid="interior-page-title">
      <h1
        className="text-[32px] sm:text-[40px] lg:text-[44px] leading-[1.1] tracking-[-0.025em] text-[#1e2a5a]"
        // Weight ~450 gives more presence than 300 without reading as bold.
        // Browsers round to the nearest available Avenir Next weight.
        style={{ fontFamily: TITLE_FONT_FAMILY, fontWeight: 450 }}
        data-testid={titleTestId}
      >
        {title}
        {hasContext && (
          // key={context} remounts the span so the phase-in re-runs whenever
          // the major context changes (including none -> present).
          <span
            key={trimmedContext}
            className="interior-title-context"
            // Slightly lighter than the base title so it reads as secondary.
            style={{ fontWeight: 400 }}
            data-testid="text-page-title-context"
          >
            <span aria-hidden style={{ color: "#9AA8BD" }}>{" \u2014 "}</span>
            <span style={{ color: "#5675A6" }}>{trimmedContext}</span>
          </span>
        )}
      </h1>

      {/* Navy gradient hairline — the Global Schedule treatment, slightly
          more visible than before (0.78 / 0.30 / 0). */}
      <div
        className="mt-5 h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(30,42,90,0.78) 0%, rgba(30,42,90,0.30) 45%, rgba(30,42,90,0.00) 100%)",
        }}
      />
    </div>
  );
}
