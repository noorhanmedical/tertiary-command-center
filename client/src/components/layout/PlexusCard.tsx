import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./SectionHeader";

export type PlexusCardTone = "standard" | "soft" | "muted";
export type PlexusCardPadding = "none" | "sm" | "md" | "lg";

const TONE: Record<PlexusCardTone, string> = {
  standard: "bg-finance-card border-finance-border shadow-sm",
  soft: "bg-finance-card-soft border-finance-border",
  muted: "bg-finance-bg-soft border-finance-border",
};

const PADDING: Record<PlexusCardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export interface PlexusCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  children: ReactNode;
  tone?: PlexusCardTone;
  padding?: PlexusCardPadding;
  /** Optional header rendered via the canonical SectionHeader. */
  title?: ReactNode;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
}

/**
 * PlexusCard — the canonical content card for standard (non-`.plexus-ui`)
 * pages. Consolidates the many hand-rolled card styles (`rounded-2xl border
 * border-slate-200 shadow-sm`, inline-styled `rounded-[10px]`, custom
 * multi-layer shadows, etc.) into one radius / border / shadow / padding.
 *
 * Radius is a consistent 2xl (16px); border + surface come from the finance
 * tokens so it tracks the winter palette. Pass `title` to render a
 * SectionHeader inside the card, or compose freely via children.
 *
 * (Distinct from the `.plexus-ui` gallery `PlexusCard`, which is scoped to the
 * design-system preview surface.)
 */
export function PlexusCard({
  children,
  tone = "standard",
  padding = "lg",
  title,
  subtitle,
  headerAction,
  className,
  ...props
}: PlexusCardProps) {
  const hasHeader = title != null || subtitle != null || headerAction != null;
  return (
    <div
      className={cn("rounded-2xl border", TONE[tone], PADDING[padding], className)}
      data-testid="plexus-card"
      {...props}
    >
      {hasHeader && (
        <SectionHeader
          title={title}
          subtitle={subtitle}
          action={headerAction}
          className={cn(children != null && "mb-4")}
        />
      )}
      {children}
    </div>
  );
}
