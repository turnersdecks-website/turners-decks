import { useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"

// Port of the kit's confirm-dialog (radix alert-dialog): Delete Lead, cancel postcard, replay Submission.
// Controlled (`open` + `onOpenChange`) or uncontrolled with a `trigger`, which stays in the server-rendered HTML.
// Uncontrolled dialogs close by themselves once `onConfirm` settles; controlled callers close them.
export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  disabled = false,
  onConfirm,
  children,
  className,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  title: ReactNode
  description: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  destructive?: boolean
  pending?: boolean
  disabled?: boolean
  onConfirm: () => void | Promise<unknown>
  children?: ReactNode
  className?: string
}) {
  const [openState, setOpenState] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenState(next)
    onOpenChange?.(next)
  }

  async function confirm() {
    await onConfirm()
    if (!controlled) setOpenState(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent className={cn(className)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={disabled || pending}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
