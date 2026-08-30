// SketchSelect — CLEAN (SketchUI look removed).
//
// Previously a native <select> under a hand-drawn Rough.js canvas border. Now a
// plain, accessible native <select> with a clean bordered shell. Same exported
// API + props so all call sites keep working.

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SketchSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  seedId?: string;
  /** Optional wrapper class. */
  containerClassName?: string;
}

export const SketchSelect = forwardRef<HTMLSelectElement, SketchSelectProps>(
  ({ seedId: _seedId, className, containerClassName, children, ...rest }, ref) => {
    return (
      <div
        className={cn(
          "relative inline-flex items-center rounded-md border border-slate-300 bg-white",
          containerClassName,
        )}
      >
        <select
          ref={ref}
          className={cn(
            "relative z-10 appearance-none bg-transparent py-1.5 pl-3 pr-8 text-[13px] text-slate-800",
            "outline-none cursor-pointer rounded-md",
            "focus-visible:ring-2 focus-visible:ring-primary",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 z-10 h-3.5 w-3.5 text-slate-500" />
      </div>
    );
  },
);
SketchSelect.displayName = "SketchSelect";
