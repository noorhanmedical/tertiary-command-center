import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PlexusButton } from "./buttons";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — overlays (§32–§34, §39, §40, §46, §61)
   Modal / Drawer / Popover wrap Radix (focus trap, Escape, outside-close,
   scroll lock preserved). Tooltip is re-exported from shadcn as-is.
   ══════════════════════════════════════════════════════════════════════ */

import {
  Tooltip,
  TooltipTrigger,
  TooltipProvider,
  TooltipContent as UITooltipContent,
} from "@/components/ui/tooltip";

export { Tooltip, TooltipTrigger, TooltipProvider };

/**
 * TooltipContent (§32) — Plexus winter tooltip. Composes the shadcn/Radix
 * TooltipContent (portal, keyboard/focus, delays, ARIA all preserved) and
 * overrides only presentation: dark navy #111A2E, white text, 11–12px,
 * radius 8, ~6×8 padding, subtle shadow. No shared components/ui edits.
 */
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof UITooltipContent>,
  React.ComponentPropsWithoutRef<typeof UITooltipContent>
>(({ className, ...props }, ref) => (
  <UITooltipContent
    ref={ref}
    className={cn(
      "rounded-[8px] border-0 bg-[#111A2E] px-2 py-1.5 text-[11.5px] font-medium leading-4 text-white shadow-[0_6px_18px_rgba(5,8,14,0.22)]",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = "PlexusTooltipContent";

/** Plexus overlay scrim (§39) — near-black rgba(7,10,16,0.45), replacing the
 *  shadcn default bg-black/80 without editing shared components/ui. */
const PLEXUS_OVERLAY = "bg-[rgba(7,10,16,0.45)]";

export type ModalSize = "sm" | "md" | "lg";

/** Modal (§39) — small/medium/large + confirmation footer slot. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: ModalSize;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={PLEXUS_OVERLAY}
        className={cn(
          "plexus-ui rounded-[18px] border-[var(--w-edge)] bg-white p-0 gap-0",
          width,
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-[20px]" style={{ fontWeight: 500, color: "var(--w-text)" }}>
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-[13px]" style={{ color: "var(--w-text-2)" }}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children && <div className="px-6 py-3 text-[14px]" style={{ color: "var(--w-text)" }}>{children}</div>}
        {footer && (
          <DialogFooter className="flex flex-row justify-end gap-2 px-6 pb-6 pt-3">{footer}</DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** ConfirmModal (§46) — destructive confirmation naming the object. */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={message}
      size="sm"
      footer={
        <>
          <PlexusButton variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </PlexusButton>
          <PlexusButton
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </PlexusButton>
        </>
      }
    />
  );
}

/** Drawer / side panel (§40, §61) — right-side context detail. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="plexus-ui flex w-full flex-col gap-0 border-l-[var(--w-edge)] bg-white p-0 sm:max-w-[480px]"
      >
        <div className="flex items-center justify-between border-b border-[var(--w-divider)] px-5 py-4">
          <h2 className="text-[18px]" style={{ fontWeight: 500, color: "var(--w-text)" }}>
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--w-text-2)] hover:bg-[var(--w-blue-soft)]"
          >
            <X className="size-[18px]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && (
          <div
            className="sticky bottom-0 bg-white px-5 py-3 shadow-[0_-8px_20px_rgba(24,34,52,0.06)]"
          >
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** PlexusPopover (§33) — strong-frost contextual detail. */
export function PlexusPopover({
  trigger,
  children,
  align = "center",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(
          "plexus-ui rounded-[14px] border-[var(--w-frost-border)] bg-[var(--w-frost-strong)] p-4 shadow-[0_12px_32px_rgba(24,34,52,0.12)] backdrop-blur-[18px]",
          className,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
