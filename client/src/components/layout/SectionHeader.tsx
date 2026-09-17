import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  /** Section title (18px / 600). */
  title: ReactNode;
  /** Optional one-line description below the title. */
  subtitle?: ReactNode;
  /** Optional right-aligned action(s) (a button, link, or small control). */
  action?: ReactNode;
  className?: string;
  titleTestId?: string;
}

/**
 * SectionHeader — the canonical in-page section heading. Replaces ad-hoc bold
 * `<div>`/`<h3>` headings so every section title within a page shares the same
 * size, weight, spacing, and optional right-action alignment.
 *
 * Use for sections INSIDE a page (below the PageHeader). For the top-level
 * page title use PageHeader / InteriorPageTitle.
 */
export function SectionHeader({
  title,
  subtitle,
  action,
  className,
  titleTestId = "section-header-title",
}: SectionHeaderProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      data-testid="section-header"
    >
      <div className="min-w-0">
        <h2
          className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-finance-text"
          data-testid={titleTestId}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm text-finance-text-secondary">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
