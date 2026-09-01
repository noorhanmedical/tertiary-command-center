import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — button system (§14, §31, §69)
   Winter-styled buttons. Radius 10px, height 40–44px, verb-first labels.
   These are self-contained (own cva) so their winter colors don't perturb
   the shared shadcn Button used by every live page. State coverage:
   default / hover / focus / active / disabled / loading (§69).
   ══════════════════════════════════════════════════════════════════════ */

const plexusButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] " +
    "text-[14px] font-semibold transition-colors select-none " +
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "text-white shadow-[0_6px_18px_rgba(24,34,52,0.10)] " +
          "bg-[var(--w-navy)] hover:bg-[var(--w-navy-deep)]",
        secondary:
          "bg-[#EEF4FA] text-[var(--w-text)] border border-[var(--w-edge)] hover:bg-[var(--w-cool)]",
        tertiary:
          "bg-transparent text-[var(--w-blue)] hover:bg-[var(--w-blue-soft)]",
        destructive:
          "text-white bg-[var(--w-error)] hover:brightness-95",
        "destructive-soft":
          "bg-[var(--w-error-soft)] text-[var(--w-error)] border border-[rgba(217,84,93,0.24)] hover:brightness-[0.98]",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface PlexusButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof plexusButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
}

export const PlexusButton = React.forwardRef<HTMLButtonElement, PlexusButtonProps>(
  ({ className, variant, size, asChild, loading, icon: Icon, children, disabled, ...props }, ref) => {
    const leading = loading ? (
      <Loader2 className="animate-spin" aria-hidden />
    ) : Icon ? (
      <Icon aria-hidden />
    ) : null;

    // With `asChild`, Radix Slot requires EXACTLY ONE child. Merge our leading
    // icon/spinner INSIDE the single child element instead of emitting a
    // sibling (which throws "React.Children.only"). Callers may also place the
    // icon in their own child; both are safe.
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ children?: React.ReactNode }>;
      return (
        <Slot
          ref={ref}
          className={cn(plexusButtonVariants({ variant, size, className }))}
          aria-busy={loading || undefined}
          {...props}
        >
          {React.cloneElement(
            child,
            undefined,
            <>
              {leading}
              {child.props.children}
            </>,
          )}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(plexusButtonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {leading}
        {children}
      </button>
    );
  },
);
PlexusButton.displayName = "PlexusButton";

/**
 * IconButton (§14, §26, §31, §76) — icon-only control. Enforces a 40px click
 * target and REQUIRES an accessible label, surfaced both as aria-label and a
 * tooltip.
 */
export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "muted";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, tone = "default", className, ...props }, ref) => {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors",
              "focus-visible:outline-none",
              tone === "muted"
                ? "text-[var(--w-text-muted)] hover:bg-[var(--w-blue-soft)] hover:text-[var(--w-text)]"
                : "text-[var(--w-text-2)] hover:bg-[var(--w-blue-soft)] hover:text-[var(--w-text)]",
              "disabled:pointer-events-none disabled:opacity-50",
              className,
            )}
            {...props}
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="rounded-[8px] border-0 bg-[#111A2E] px-2 py-1.5 text-[11.5px] font-medium leading-4 text-white shadow-[0_6px_18px_rgba(5,8,14,0.22)]">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  },
);
IconButton.displayName = "IconButton";

export { plexusButtonVariants };
