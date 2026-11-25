import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { errorMessage } from '#/lib/errors'
import { getLostPreview, markLeadLost } from '#/lib/lost.functions'

// The Lost window (src/lib/lost.server.ts): opens instead of moving straight to Lost, from the board and the Lead page.
// Shows the "Lost: thank-you" email as it would go out, and asks whether to send it and whether to mark the Lead
// Do not contact (on by default). Cancel leaves the Lead where it was.

type Preview = Awaited<ReturnType<typeof getLostPreview>>

export function LostDialog({ leadId, leadName, onClose, onDone }: { leadId: string | null; leadName: string; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sendEmail, setSendEmail] = useState(true)
  const [doNotContact, setDoNotContact] = useState(true)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!leadId) return
    let live = true
    setPreview(null)
    setReason('')
    setDoNotContact(true)
    getLostPreview({ data: { leadId } })
      .then((p) => {
        if (!live) return
        setPreview(p)
        setSendEmail(!p.cannotSend)
      })
      .catch(async (error) => {
        toast.error(await errorMessage(error))
        onClose()
      })
    return () => {
      live = false
    }
  }, [leadId])

  async function confirm() {
    if (!leadId) return
    setSaving(true)
    try {
      const res = await markLeadLost({ data: { leadId, sendEmail: sendEmail && !preview?.cannotSend, doNotContact, reason: reason.trim() || null } })
      toast.success(res.emailQueued ? 'Moved to Lost. Thank-you email sent.' : 'Moved to Lost.')
      await onDone()
      onClose()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={leadId !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {leadName} to Lost</DialogTitle>
          <DialogDescription>Choose what goes to the Homeowner and whether to keep marketing to them.</DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="Loading" />
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={sendEmail && !preview.cannotSend} disabled={Boolean(preview.cannotSend) || saving} onCheckedChange={(v) => setSendEmail(v === true)} />
              <span>
                <span className="font-medium">Send the thank-you email</span>
                <span className="block text-xs text-muted-foreground">
                  {preview.cannotSend ?? `To ${preview.to}. Best when they told us they went another way; skip it if they just stopped answering.`}
                </span>
              </span>
            </label>

            {sendEmail && !preview.cannotSend && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{preview.subject}</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">{preview.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">Edit the wording in Settings &gt; Automations &gt; Lost: thank-you.</p>
              </div>
            )}

            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={doNotContact} disabled={saving} onCheckedChange={(v) => setDoNotContact(v === true)} />
              <span>
                <span className="font-medium">Do not contact</span>
                <span className="block text-xs text-muted-foreground">Leave out of marketing and re-engaging cold Leads.</span>
              </span>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Reason (optional)</span>
              <Input value={reason} maxLength={200} disabled={saving} placeholder="e.g. Went with another company, price, timing" onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!preview || saving} onClick={() => void confirm()}>
            {saving ? 'Saving…' : sendEmail && preview && !preview.cannotSend ? 'Move to Lost and send' : 'Move to Lost'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
