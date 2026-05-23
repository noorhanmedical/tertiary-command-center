import { Maximize2 } from "lucide-react";
import type { PanelPlaygroundContext } from "@/lib/playground/panelPlaygroundContext";

// Reusable expand-arrow control for the panel → popup → Playground
// pattern. Any panel popup that supports promotion mounts this
// button next to its dismiss affordance; clicks bubble the
// canonical PanelPlaygroundContext up to the centerMode owner
// (usually PortalShell), which then renders the matching
// Playground body.

export type PromoteToPlaygroundButtonProps = {
  context: PanelPlaygroundContext;
  onPromote: (context: PanelPlaygroundContext) => void;
  label?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
};

export function PromoteToPlaygroundButton({
  context,
  onPromote,
  label = "Expand in Playground",
  disabled = false,
  title,
  className = "",
}: PromoteToPlaygroundButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onPromote(context);
      }}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center h-6 w-6 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${className}`}
      data-testid={`promote-to-playground-${context.componentType}`}
    >
      <Maximize2 className="h-3 w-3" />
    </button>
  );
}
