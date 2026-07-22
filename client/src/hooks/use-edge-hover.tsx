import * as React from "react";

// Shared edge-hover mechanism (task #781). Thin invisible hover zones along
// the viewport edges open the page's side panel; a short leave-delay debounce
// (same 120ms pattern the Team Portal rails use) prevents flicker. Hover-only:
// on touch devices ("(hover: none)") the zones are skipped entirely so
// tap-to-open behavior keeps working unchanged.

export const EDGE_HOVER_LEAVE_DELAY_MS = 120;

/** True when the primary pointer supports hover (i.e. not a touch device). */
export function useHoverCapable() {
  const [hoverCapable, setHoverCapable] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover)");
    const update = () => setHoverCapable(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return hoverCapable;
}

/**
 * Invisible fixed strip along the left or right viewport edge. Renders
 * nothing on touch devices. `onEdgeHover` fires when the pointer reaches
 * the edge.
 */
export function EdgeHoverZone({
  side,
  onEdgeHover,
  widthPx = 8,
  zIndexClassName = "z-30",
  testId,
}: {
  side: "left" | "right";
  onEdgeHover: () => void;
  widthPx?: number;
  zIndexClassName?: string;
  testId?: string;
}) {
  const hoverCapable = useHoverCapable();
  if (!hoverCapable) return null;
  return (
    <div
      aria-hidden
      data-testid={testId}
      className={`fixed inset-y-0 ${side === "left" ? "left-0" : "right-0"} ${zIndexClassName}`}
      style={{ width: widthPx }}
      onMouseEnter={onEdgeHover}
    />
  );
}
