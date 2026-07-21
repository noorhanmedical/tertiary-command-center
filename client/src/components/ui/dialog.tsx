"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * When set, dialogs rendered beneath this provider portal INTO the given
 * element (instead of document.body) and become non-modal, so they only
 * cover/lock their host container. Used by the winter-home desktop to keep
 * app modals (e.g. Admin Review) inside their floating window. The host
 * element must create a CSS containing block (e.g. `transform`) so the
 * dialog's `fixed` positioning resolves against it.
 */
const DialogPortalContainerContext = React.createContext<HTMLElement | null>(null)

const Dialog = ({ modal, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) => {
  const container = React.useContext(DialogPortalContainerContext)
  return <DialogPrimitive.Root {...props} modal={container ? false : modal} />
}

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayClassName?: string
    hideClose?: boolean
  }
>(({ className, children, overlayClassName, hideClose, ...props }, ref) => {
  const container = React.useContext(DialogPortalContainerContext)
  // Inside a portal container the dialog is non-modal; keep it from
  // dismissing when the user interacts with the desktop outside its window.
  const containedProps = container
    ? {
        onInteractOutside: (e: Parameters<NonNullable<typeof props.onInteractOutside>>[0]) => {
          props.onInteractOutside?.(e)
          e.preventDefault()
        },
        onPointerDownOutside: (e: Parameters<NonNullable<typeof props.onPointerDownOutside>>[0]) => {
          props.onPointerDownOutside?.(e)
          e.preventDefault()
        },
        onFocusOutside: (e: Parameters<NonNullable<typeof props.onFocusOutside>>[0]) => {
          props.onFocusOutside?.(e)
          e.preventDefault()
        },
      }
    : undefined
  return (
  <DialogPortal container={container ?? undefined}>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
        // Inside a portal container (winter-home window), vw/vh-based sizes
        // from callers can exceed the host window. Cap the dialog to the
        // container so it never spills past the window bounds.
        container && "!max-w-[calc(100%-1rem)] !max-h-[calc(100%-1rem)]"
      )}
      {...props}
      {...containedProps}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortalContainerContext,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
