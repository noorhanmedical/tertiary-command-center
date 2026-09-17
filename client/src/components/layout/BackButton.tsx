import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BackButtonProps {
  /**
   * Parent route to fall back to when there is no in-app navigation history
   * to pop (e.g. the page was opened via a direct/deep link). Always provide
   * this so a deep-linked detail page still has a sensible "up" target.
   */
  fallbackHref: string;
  /** Visible label. Defaults to "Back". */
  label?: string;
  /**
   * Prefer real browser back when there is history to pop; otherwise navigate
   * to {@link fallbackHref}. Set false to always go to the parent route.
   */
  preferHistory?: boolean;
  className?: string;
  testId?: string;
}

/**
 * BackButton — the one canonical "up/back" affordance for detail and
 * drill-down pages. Consistent icon, hit target, spacing, and hover/focus.
 *
 * Behavior: when {@link preferHistory} is set (default) and the app has
 * navigation history to pop, it uses browser back so the user returns to the
 * exact list/scroll position they came from; otherwise it routes to
 * {@link fallbackHref} (safe for deep links / fresh loads).
 *
 * Placement rule (documented for callers): render at the top-left of a
 * PageHeader on detail / nested / drill-down pages only. Do NOT render on
 * top-level nav destinations, dashboards, or root sections.
 */
export function BackButton({
  fallbackHref,
  label = "Back",
  preferHistory = true,
  className,
  testId = "button-back",
}: BackButtonProps) {
  const [, navigate] = useLocation();

  function handleClick() {
    const canPop =
      preferHistory &&
      typeof window !== "undefined" &&
      window.history.length > 1;
    if (canPop) {
      window.history.back();
      return;
    }
    navigate(fallbackHref);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      data-testid={testId}
      className={cn(
        "-ml-2 h-8 gap-1.5 px-2 text-finance-text-secondary hover:text-finance-text",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Button>
  );
}
