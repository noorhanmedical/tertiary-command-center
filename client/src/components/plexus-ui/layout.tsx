import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — layout & surface primitives
   Reusable structural pieces (§5, §6, §9, §10, §21, §63). All winter styling
   comes from the `.plexus-ui` scope in index.css — these components add no
   one-off colors.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * PlexusPage — the winter canvas wrapper (Level 1, §8/§10/§63). Establishes
 * the `.plexus-ui` token scope and the icy canvas. Interior pages omit snow.
 */
export function PlexusPage({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("plexus-ui plexus-canvas min-h-full", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * Production interior-page section rhythm (§11). Live pages composed in
 * Phase B should separate MAJOR sections by 24–32px — i.e. Tailwind
 * `gap-6` (24px) or `gap-8` (32px) on the page's flex/grid column — NOT the
 * `/ui-system-preview` gallery's looser `gap-10` (40px), which exists only to
 * give the demo breathing room. Reuse the existing spacing scale; no new token.
 */
export const PLEXUS_PAGE_SECTION_GAP = "gap-8" as const; // 32px; use "gap-6" (24px) for denser pages

/**
 * PlexusPageInner — content column that aligns page title, toolbar, and body
 * to one grid (§5, §11). Horizontal padding follows the spacing scale.
 *
 * NOTE: when composing live pages, apply {@link PLEXUS_PAGE_SECTION_GAP}
 * (gap-6 / gap-8) between major sections rather than copying the gallery gap.
 */
export function PlexusPageInner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative z-[1] mx-auto w-full max-w-[1600px]",
        "px-4 md:px-6 lg:px-8 pt-7 pb-16",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * InteriorPageTitle (§5) — the mandatory large, thin title that begins every
 * interior page. NO buttons/search/filters/actions allowed in this area by
 * design: the component intentionally exposes no `actions` prop.
 *
 * Anatomy: large simple title (weight 300) + optional subtitle/context.
 * Spacing: 28px top, 4px subtitle gap, 24px bottom before toolbar/content.
 */
export function InteriorPageTitle({
  title,
  subtitle,
  className,
  titleTestId = "plexus-page-title",
}: {
  title: string;
  subtitle?: string;
  className?: string;
  titleTestId?: string;
}) {
  return (
    <div className={cn("pt-0 pb-6", className)} data-testid="plexus-interior-page-title">
      <h1
        data-testid={titleTestId}
        className="text-[28px] md:text-[32px] lg:text-[36px] leading-[1.15] tracking-[-0.02em]"
        style={{ fontWeight: 300, color: "var(--w-text)" }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          className="mt-1 text-[13px] leading-5"
          style={{ color: "var(--w-text-muted)", fontWeight: 400 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * StructuralHeader (§6) — dark navy anchor band. Simple title only; no
 * toolbars/actions. Acts as a section anchor, never a control surface.
 */
export function StructuralHeader({
  title,
  subtitle,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("plexus-structural-header flex items-center gap-3 px-6 py-5", className)}
      data-testid="plexus-structural-header"
    >
      {icon && <span className="plexus-icon-frost h-10 w-10 text-white/90">{icon}</span>}
      <div className="min-w-0">
        <h2
          className="truncate text-[22px] md:text-[24px] leading-8 text-white"
          style={{ fontWeight: 400 }}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13px] leading-5 text-white/70" style={{ fontWeight: 400 }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * SectionTitle (§4) — 18px/500 section heading for use inside panels.
 */
export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn("text-[18px] leading-[26px]", className)}
      style={{ fontWeight: 500, color: "var(--w-text)" }}
    >
      {children}
    </h3>
  );
}

/**
 * PageToolbar (§21) — list-control band that sits BELOW the title and is
 * visually secondary to it. Search / filters / status on the left, a single
 * primary action on the right. Wraps responsively.
 */
export function PageToolbar({
  children,
  actions,
  className,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 md:gap-3",
        "justify-between",
        className,
      )}
      data-testid="plexus-page-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3 min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export type FrostVariant = "primary" | "secondary" | "strong";

/**
 * FrostedPanel (§9, §10) — Level-2 frosted surface. Use for important
 * surfaces only, not every small component.
 */
export function FrostedPanel({
  children,
  variant = "primary",
  className,
  ...props
}: {
  children: ReactNode;
  variant?: FrostVariant;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const cls =
    variant === "secondary"
      ? "plexus-frost-secondary"
      : variant === "strong"
        ? "plexus-frost-strong"
        : "plexus-frost";
  return (
    <div className={cn(cls, className)} data-testid="plexus-frosted-panel" {...props}>
      {children}
    </div>
  );
}

/**
 * FeaturePanel (§10, §28) — Level-4 dark navy feature surface, white text.
 */
export function FeaturePanel({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("plexus-feature p-6", className)} data-testid="plexus-feature-panel" {...props}>
      {children}
    </div>
  );
}

/**
 * PlexusCard (§28) — Level-3 white/light card. `tone="secondary"` uses the
 * soft blue surface.
 */
export function PlexusCard({
  children,
  tone = "primary",
  className,
  ...props
}: {
  children: ReactNode;
  tone?: "primary" | "secondary";
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(tone === "secondary" ? "plexus-card-secondary p-5" : "plexus-card p-6", className)}
      data-testid="plexus-card"
      {...props}
    >
      {children}
    </div>
  );
}
