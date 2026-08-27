// Sketch overlay primitives — Popover, Dialog, DropdownMenu, Tooltip, and their
// portaled content, plus Checkbox / Radio. These wrap the Radix primitives so
// that PORTALED content (rendered to document.body, outside the React tree)
// still carries the SketchUI paper look. Floating surfaces use a CSS paper +
// graphite-border treatment (not per-open Rough.js) so menus/dialogs never
// jitter or recompute geometry as they open (§35, §40).
//
// Palette + radii are centralized here so every overlay reads as one system.

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SKETCH_COLORS } from "./sketchTokens";

// Shared paper-surface look for floating content. A slightly irregular corner
// radius + graphite border + soft (non-glossy) shadow reads as hand-cut paper.
const SKETCH_SURFACE_CLS =
  "border text-slate-800 shadow-[0_10px_30px_rgba(31,41,55,0.14)]";
const SKETCH_SURFACE_STYLE: React.CSSProperties = {
  backgroundColor: SKETCH_COLORS.paper,
  borderColor: "rgba(31,41,55,0.55)", // cool blue-graphite
  // Irregular radius corners → hand-drawn paper feel, stable across renders.
  borderRadius: "10px 12px 9px 11px",
};

const OVERLAY_ANIM =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

// ─── Popover ─────────────────────────────────────────────────────────────────

export const SketchPopover = PopoverPrimitive.Root;
export const SketchPopoverTrigger = PopoverPrimitive.Trigger;

export const SketchPopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn("z-50 w-72 p-4 outline-none", SKETCH_SURFACE_CLS, OVERLAY_ANIM, className)}
      style={{ ...SKETCH_SURFACE_STYLE, ...style }}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
SketchPopoverContent.displayName = "SketchPopoverContent";

// ─── Dialog ──────────────────────────────────────────────────────────────────

export const SketchDialog = DialogPrimitive.Root;
export const SketchDialogTrigger = DialogPrimitive.Trigger;
export const SketchDialogClose = DialogPrimitive.Close;

export const SketchDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, style, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color:rgba(31,41,55,0.40)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 p-6 duration-200",
        SKETCH_SURFACE_CLS,
        OVERLAY_ANIM,
        className,
      )}
      style={{ ...SKETCH_SURFACE_STYLE, borderRadius: "12px 14px 11px 13px", ...style }}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-sm text-slate-500 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SketchDialogContent.displayName = "SketchDialogContent";

export function SketchDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />;
}
export function SketchDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
export const SketchDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold leading-none tracking-tight text-slate-900", className)}
    {...props}
  />
));
SketchDialogTitle.displayName = "SketchDialogTitle";
export const SketchDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs text-slate-500", className)} {...props} />
));
SketchDialogDescription.displayName = "SketchDialogDescription";

// ─── Dropdown menu ─────────────────────────────────────────────────────────────

export const SketchDropdownMenu = DropdownMenuPrimitive.Root;
export const SketchDropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const SketchDropdownMenuGroup = DropdownMenuPrimitive.Group;

export const SketchDropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, style, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("z-50 min-w-[9rem] overflow-hidden p-1 outline-none", SKETCH_SURFACE_CLS, OVERLAY_ANIM, className)}
      style={{ ...SKETCH_SURFACE_STYLE, ...style }}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
SketchDropdownMenuContent.displayName = "SketchDropdownMenuContent";

type MenuItemVariant = "default" | "active" | "danger";

// Canonical sketch menu row. Used by dropdowns (and can back context menus).
export const SketchMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: MenuItemVariant;
    icon?: React.ReactNode;
  }
>(({ className, variant = "default", icon, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors",
      "focus:bg-slate-900/[0.06] data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
      variant === "danger" ? "text-[color:var(--sketch-red)]" : "text-slate-800",
      variant === "active" && "font-semibold",
      className,
    )}
    {...props}
  >
    {icon && <span className="text-slate-500">{icon}</span>}
    {children}
  </DropdownMenuPrimitive.Item>
));
SketchMenuItem.displayName = "SketchMenuItem";

export const SketchDropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px", className)}
    style={{ backgroundColor: "rgba(148,163,184,0.4)" }}
    {...props}
  />
));
SketchDropdownMenuSeparator.displayName = "SketchDropdownMenuSeparator";

export const SketchDropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500", className)}
    {...props}
  />
));
SketchDropdownMenuLabel.displayName = "SketchDropdownMenuLabel";

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export const SketchTooltipProvider = TooltipPrimitive.Provider;
export const SketchTooltip = TooltipPrimitive.Root;
export const SketchTooltipTrigger = TooltipPrimitive.Trigger;

export const SketchTooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 5, style, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden px-2.5 py-1 text-[11px] text-slate-800 shadow-[0_6px_18px_rgba(31,41,55,0.16)]",
      "animate-in fade-in-0 zoom-in-95",
      className,
    )}
    style={{
      backgroundColor: SKETCH_COLORS.paper,
      border: "1px solid rgba(31,41,55,0.55)",
      borderRadius: "7px 9px 6px 8px",
      ...style,
    }}
    {...props}
  />
));
SketchTooltipContent.displayName = "SketchTooltipContent";

// ─── Checkbox / Radio ──────────────────────────────────────────────────────────
// Lightweight paper controls (native inputs for a11y under the hood).

export const SketchCheckbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "h-4 w-4 cursor-pointer appearance-none rounded-[4px] border align-middle outline-none transition-colors",
      "checked:bg-[color:var(--sketch-blue)] checked:border-[color:var(--sketch-blue)]",
      "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)]",
      className,
    )}
    style={{ borderColor: "rgba(31,41,55,0.55)", backgroundColor: SKETCH_COLORS.paper }}
    {...props}
  />
));
SketchCheckbox.displayName = "SketchCheckbox";

export const SketchRadio = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="radio"
    className={cn(
      "h-4 w-4 cursor-pointer appearance-none rounded-full border align-middle outline-none transition-colors",
      "checked:bg-[color:var(--sketch-blue)] checked:border-[color:var(--sketch-blue)]",
      "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)]",
      className,
    )}
    style={{ borderColor: "rgba(31,41,55,0.55)", backgroundColor: SKETCH_COLORS.paper }}
    {...props}
  />
));
SketchRadio.displayName = "SketchRadio";

// re-export lucide marks that menu consumers commonly need
export { Check as SketchMenuCheck, Circle as SketchMenuDot };
