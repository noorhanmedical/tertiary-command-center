import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  PAGE_MAX_WIDTH,
  PAGE_PADDING_X,
  PAGE_PADDING_Y,
  PAGE_SECTION_GAP,
  type PageWidth,
} from "./layoutTokens";

export interface PageShellProps {
  children: ReactNode;
  /**
   * Content max-width. `default` (1400) for standard operational pages,
   * `wide` (1600) for dense tables/dashboards, `narrow` (1024) for
   * focused/settings pages. `full` opts out of centering for full-bleed
   * master-detail surfaces (which should generally NOT use PageShell).
   */
  width?: PageWidth;
  /**
   * Vertical gap between direct children (major sections). Defaults to the
   * canonical 24px rhythm; pass a Tailwind gap-* class to override.
   */
  sectionGap?: string;
  /** Extra classes on the centered content column. */
  className?: string;
  /** Extra classes on the outer scroll canvas. */
  outerClassName?: string;
  /**
   * When false, renders only the centered column (no `.finance-page` scroll
   * canvas). Use when the page already provides its own scroll container.
   */
  withCanvas?: boolean;
}

/**
 * PageShell — the canonical wrapper for standard scroll pages.
 *
 * Replaces the copy-pasted `div.finance-page > div.mx-auto flex w-full
 * max-w-[…] flex-col gap-6 px-6 py-6` template that pages hand-rolled with
 * divergent max-widths (1280/1400/1520) and paddings. Every adopting page now
 * shares one content width, one responsive gutter, one top/bottom rhythm, and
 * one section gap.
 *
 * NOTE: intended for standard top-to-bottom scroll pages. Full-height
 * master-detail surfaces (Plexus EHR directory, Plexus IQ, Plexus Bank) manage
 * their own split layout and should not be forced into a centered column.
 */
export function PageShell({
  children,
  width = "default",
  sectionGap = PAGE_SECTION_GAP,
  className,
  outerClassName,
  withCanvas = true,
}: PageShellProps) {
  const column = (
    <div
      className={cn(
        "relative z-[1] mx-auto flex w-full flex-col",
        PAGE_MAX_WIDTH[width],
        PAGE_PADDING_X,
        PAGE_PADDING_Y,
        sectionGap,
        className,
      )}
      data-testid="page-shell"
    >
      {children}
    </div>
  );

  if (!withCanvas) return column;

  return <div className={cn("finance-page", outerClassName)}>{column}</div>;
}
