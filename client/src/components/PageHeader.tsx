import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { InteriorPageTitle } from "@/components/InteriorPageTitle";
import { BackButton } from "@/components/layout/BackButton";

export interface PageHeaderProps {
  /**
   * Kept for backwards compatibility. Eyebrows were removed from the interior
   * title system — this prop is accepted but never rendered.
   */
  eyebrow?: string;
  /** The page title. */
  title: string;
  /**
   * Optional major-context suffix (selected clinic/facility or major
   * subsection). Rendered as `— Context` by InteriorPageTitle. Drive this from
   * true navigation/context state only, never from filter state.
   */
  context?: string | null;
  /** One-line description. Rendered BELOW the hairline (never in the title). */
  subtitle?: string;
  /**
   * Kept for backwards compatibility. The standardized title shows only the
   * title, so the icon is no longer rendered.
   */
  icon?: LucideIcon;
  /** Kept for backwards compatibility; no longer used. */
  iconAccent?: string;
  /** Optional back link, renders an "← Back" button above the title block. */
  backHref?: string;
  backLabel?: string;
  /** Action area (buttons, badges, etc). Rendered BELOW the title + hairline. */
  actions?: ReactNode;
  /** Extra content rendered below the title (status pills, sub-nav, etc). */
  children?: ReactNode;
  /** Kept for backwards compatibility; the title treatment is now uniform. */
  variant?: "light" | "dark";
  /** Override the data-testid on the title. */
  titleTestId?: string;
  className?: string;
}

/**
 * Canonical page header used across interior pages.
 *
 * The title area is delegated to {@link InteriorPageTitle}: base title +
 * optional major-context suffix + navy gradient hairline, and nothing else.
 * Eyebrow, icon, subtitle, actions, and children are all rendered BELOW the
 * hairline so the title block stays clean on every page.
 */
export function PageHeader({
  title,
  context,
  subtitle,
  backHref,
  backLabel = "Back",
  actions,
  children,
  titleTestId = "text-page-header-title",
  className = "",
}: PageHeaderProps) {
  return (
    <div className={className} data-testid="page-header">
      {backHref && (
        <div className="mb-3">
          <BackButton fallbackHref={backHref} label={backLabel} />
        </div>
      )}

      {/* Title area: title + optional context + hairline only. */}
      <InteriorPageTitle title={title} context={context} titleTestId={titleTestId} />

      {/* Below the hairline: subtitle + actions. */}
      {(subtitle || actions) && (
        <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
          {subtitle ? (
            <p className="min-w-0 text-sm text-finance-text-secondary">{subtitle}</p>
          ) : (
            <span />
          )}
          {actions && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
          )}
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// ─── Dark-variant pill helpers (preserved from CalendarPageHeader) ──────────

interface HeaderPillProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  active?: boolean;
  testId?: string;
}

export function HeaderPill({ children, onClick, icon, active, testId }: HeaderPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
        active
          ? "bg-slate-900 border-slate-900 text-white"
          : "bg-white/80 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      {icon}
      <span className="tracking-wide uppercase">{children}</span>
    </button>
  );
}

export function HeaderStatusPill({ label = "SYSTEM ACTIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-slate-600 uppercase">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}
