"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  sheetHint = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Mobile drag handle above the sheet. Hide for fullscreen dialogs. */
  sheetHint?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background fixed z-50 flex w-full flex-col gap-0 border shadow-lg duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // Mobile: bottom sheet — hugs content, caps at 90dvh.
          "inset-x-0 bottom-0 top-auto left-0 max-h-[min(90dvh,calc(100dvh-env(safe-area-inset-top)))] translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0 p-0",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          "pb-[env(safe-area-inset-bottom)]",
          // Desktop: centered card
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:max-h-[min(85vh,720px)] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:p-0",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
          // Padding for loose children (legacy dialogs). Skip Header/Body/Footer.
          "[&>:not([data-slot=dialog-header]):not([data-slot=dialog-body]):not([data-slot=dialog-footer]):not(form)]:px-4",
          "sm:[&>:not([data-slot=dialog-header]):not([data-slot=dialog-body]):not([data-slot=dialog-footer]):not(form)]:px-6",
          "[&>:not([data-slot=dialog-header]):not([data-slot=dialog-body]):not([data-slot=dialog-footer]):not(form)]:pb-4",
          // Forms that wrap only fields (admin create user) — not the prompt form that owns Header/Body.
          "[&>form:not(:has([data-slot=dialog-header]))]:px-4 sm:[&>form:not(:has([data-slot=dialog-header]))]:px-6 [&>form:not(:has([data-slot=dialog-header]))]:pb-4",
          className
        )}
        {...props}
      >
        {sheetHint && (
          <div
            className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/25 sm:hidden"
            aria-hidden
          />
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-3 right-3 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/** Scrollable middle of a sheet/dialog. Put long content here; keep actions in DialogFooter. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6",
        className
      )}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-1.5 px-4 pt-1 pb-2 text-left sm:px-6 sm:pt-6 sm:text-left",
        "pr-12", // room for close button
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t border-border/60 bg-background px-4 py-3 sm:flex-row sm:justify-end sm:px-6 sm:py-4",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogBody,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
