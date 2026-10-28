import { CalendarClock, FileText, Mail, MapPin, MessageSquare, Phone, PhoneIncoming, PhoneOutgoing, StickyNote } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button, buttonVariants } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { formatDay, formatWhen, wallTimeToEpoch } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { setFollowUpDone } from '#/lib/followups.functions'
import { addLeadActivity } from '#/lib/leads.functions'
import type { PipelineStage } from '#/db/schema'
import { CALL_OUTCOMES, type CallDirection, DISPATCH_LABELS, type ManualActivityKind, STAGE_LABELS } from '#/lib/pipeline'

// Port of the Lovable LeadActivity: log a note / call / email / text with an optional Follow-up date, and list the
// Lead's activity (including texts and Form submissions written by the phone line and Intake). Styled after the Admin
// Kit issue-detail activity panel: header strip, stat tiles, a comment-box composer and a dotted timeline.

const KINDS: { id: ManualActivityKind; label: string; icon: typeof StickyNote }[] = [
  { id: 'note', label: 'Note', icon: StickyNote },
  { id: 'call', label: 'Call', icon: Phone },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'text', label: 'Text', icon: MessageSquare },
]
const KIND_LABEL: Record<string, string> = { note: 'Note', call: 'Call', email: 'Email', text: 'Text', form: 'Form submission', appointment: 'Appointment' }
const KIND_ICON: Record<string, typeof StickyNote> = { note: StickyNote, email: Mail, text: MessageSquare, form: FileText, appointment: MapPin }
/** Call outcomes that count as reaching the Homeowner (Lovable's "connected" count). */
const CONNECTED = ['Connected', 'Booked appointment']

export type ActivityItem = {
  id: string
  kind: string
  direction: string | null
  outcome: string | null
  durationMin: number | null
  body: string | null
  authorName: string | null
  followUpAt: Date | null
  followUpDoneAt: Date | null
  /** Emails the CRM sent (Estimate email): queued | accepted | failed | unknown; null for logged activity. */
  dispatchState?: 'queued' | 'accepted' | 'failed' | 'unknown' | null
  providerMessageId?: string | null
  createdAt: Date
}

export type StageChangeItem = { id: string; fromStage: PipelineStage | null; toStage: PipelineStage; changedAt: Date; changedByName: string | null }

/** "Moved to Contacted · Oct 20 by Pat" (no "by" when the move was automatic). */
export function stageChangeText(c: StageChangeItem, timeZone: string) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(c.changedAt)
  const what = c.fromStage === null ? `Started at ${STAGE_LABELS[c.toStage]}` : `Moved to ${STAGE_LABELS[c.toStage]}`
  return `${what} · ${day}${c.changedByName ? ` by ${c.changedByName}` : ''}`
}

export function LeadActivity(props: {
  leadId: string
  phone: string | null
  activity: ActivityItem[]
  stageHistory?: StageChangeItem[]
  timeZone: string
  onChange: () => Promise<void>
}) {
  const { leadId, phone, activity, stageHistory = [], timeZone, onChange } = props
  const [kind, setKind] = useState<ManualActivityKind>('note')
  const [body, setBody] = useState('')
  const [direction, setDirection] = useState<CallDirection>('outbound')
  const [outcome, setOutcome] = useState('')
  const [duration, setDuration] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const isCall = kind === 'call'

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() && !(isCall && outcome)) return setMessage('Add some details first.')
    setBusy(true)
    setMessage(null)
    try {
      await addLeadActivity({
        data: {
          leadId,
          kind,
          body,
          ...(isCall ? { direction, outcome, durationMin: duration ? Number(duration) : null } : {}),
          // The picker's wall time is read in the company timezone, the same zone every date is shown in.
          followUpAt: followUp ? wallTimeToEpoch(followUp, timeZone) : null,
        },
      })
      setBody('')
      setOutcome('')
      setDuration('')
      setFollowUp('')
      await onChange()
    } catch (error) {
      setMessage(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone(n: ActivityItem) {
    try {
      await setFollowUpDone({ data: { activityId: n.id, done: !n.followUpDoneAt } })
      await onChange()
    } catch (error) {
      setMessage(await errorMessage(error))
    }
  }

  const calls = activity.filter((n) => n.kind === 'call')
  const nextFollowUp = activity
    .filter((n) => n.followUpAt && !n.followUpDoneAt)
    .sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime())[0]
  const shown = filter === 'all' ? activity : activity.filter((n) => n.kind === filter)

  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-xs" aria-label="Activity">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Activity</h2>
        {phone && (
          <a href={`tel:${phone}`} onClick={() => setKind('call')} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            <Phone /> Call
          </a>
        )}
      </div>
      <div className="space-y-5 p-4">
        {/* Kit stat tiles: bold value over a muted label. */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="rounded-lg border p-2.5">
            <p className="text-lg font-semibold text-foreground tabular-nums">{calls.length}</p>calls
          </div>
          <div className="rounded-lg border p-2.5">
            <p className="text-lg font-semibold text-foreground tabular-nums">{calls.filter((c) => c.outcome && CONNECTED.includes(c.outcome)).length}</p>connected
          </div>
          <div className="min-w-0 rounded-lg border p-2.5" title={nextFollowUp ? formatWhen(nextFollowUp.followUpAt!, timeZone) : undefined}>
            <p className="truncate text-sm font-semibold leading-7 text-foreground">{nextFollowUp ? formatDay(nextFollowUp.followUpAt!, timeZone) : '—'}</p>
            Follow-up
          </div>
        </div>

        {/* Composer styled as the kit comment box (issue-detail-2): one bordered surface, toolbar above, actions below. */}
        <form onSubmit={add} className="overflow-hidden rounded-lg border focus-within:ring-1 focus-within:ring-ring">
          <div className="border-b bg-muted/40 p-1.5">
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="What to log">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={kind === k.id}
                  onClick={() => setKind(k.id)}
                  className="flex h-8 items-center justify-center gap-1.5 rounded-[4px] border border-transparent px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-border aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                >
                  <k.icon className="size-3.5" />
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          {isCall && (
            <div className="grid grid-cols-2 gap-2 border-b p-3">
              <Select value={direction} onValueChange={(v) => setDirection(v as CallDirection)}>
                <SelectTrigger aria-label="Direction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">Outgoing</SelectItem>
                  <SelectItem value="inbound">Incoming</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" min={0} max={1440} placeholder="Minutes" aria-label="Minutes" value={duration} onChange={(e) => setDuration(e.target.value)} />
              <div className="col-span-2">
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger aria-label="Outcome" className="w-full">
                    <SelectValue placeholder="How did it go?" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <Textarea
            rows={3}
            aria-label="Details"
            placeholder={isCall ? 'What was said…' : `Details of this ${kind}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="resize-none rounded-none border-0 px-3 shadow-none focus-visible:ring-0"
          />
          <div className="space-y-2 border-t bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="followUpAt" className="text-xs text-muted-foreground">
                Follow up on (optional, {timeZone} time)
              </Label>
              <Input id="followUpAt" type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </div>
            {message && (
              <p role="status" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <Button size="sm" className="w-full" disabled={busy}>
              Log {KINDS.find((k) => k.id === kind)?.label.toLowerCase()}
            </Button>
          </div>
        </form>

        <div className="space-y-4">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger aria-label="Show" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              {Object.entries(KIND_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Kit activity timeline (issue-detail-2 ActivityPanel): icon dots on a vertical rule. */}
          <ul className="space-y-5">
            {shown.map((n, i) => {
              const Icon = n.kind === 'call' ? (n.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing) : (KIND_ICON[n.kind] ?? StickyNote)
              return (
                <li key={n.id} className="relative flex gap-x-3 text-sm">
                  <div aria-hidden className={`absolute top-0 left-0 flex w-7 justify-center ${i === shown.length - 1 ? 'h-7' : '-bottom-5'}`}>
                    <div className="w-px bg-border" />
                  </div>
                  <div className="relative flex size-7 flex-none items-center justify-center rounded-full border bg-background text-muted-foreground">
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-auto space-y-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {n.kind === 'call' ? `${n.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call` : (KIND_LABEL[n.kind] ?? n.kind)}
                      </span>
                      {n.outcome && (
                        <Badge variant={n.outcome === 'Booked appointment' ? 'success' : 'secondary'} className="h-5">
                          {n.outcome}
                        </Badge>
                      )}
                      {n.durationMin != null && <span className="text-xs text-muted-foreground">{n.durationMin} min</span>}
                      {n.dispatchState && (
                        <Badge
                          variant={n.dispatchState === 'accepted' ? 'success' : n.dispatchState === 'queued' ? 'outline' : 'destructive'}
                          className="h-auto min-h-5 whitespace-normal"
                          data-dispatch-state={n.dispatchState}
                          title={n.providerMessageId ? `Resend id ${n.providerMessageId}` : undefined}
                        >
                          {DISPATCH_LABELS[n.dispatchState]}
                        </Badge>
                      )}
                    </div>
                    {n.body && <p className="whitespace-pre-wrap break-words leading-6">{n.body}</p>}
                    {n.followUpAt && (
                      <button
                        type="button"
                        onClick={() => toggleDone(n)}
                        className={`flex items-center gap-1 text-left text-xs ${n.followUpDoneAt ? 'text-muted-foreground line-through' : 'font-medium text-primary hover:underline'}`}
                      >
                        <CalendarClock className="size-3" />
                        Follow up {formatWhen(n.followUpAt, timeZone)} {n.followUpDoneAt ? '· done' : '· mark done'}
                      </button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {[n.authorName, formatWhen(n.createdAt, timeZone)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              )
            })}
            {shown.length === 0 && <li className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing logged yet.</li>}
          </ul>
        </div>
        {stageHistory.length > 0 && (
          <div className="border-t pt-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stage history</h3>
            <ul className="space-y-2.5 text-xs text-muted-foreground" aria-label="Stage history">
              {stageHistory.map((c, i) => (
                <li key={c.id} title={formatWhen(c.changedAt, timeZone)} className="relative flex items-center gap-x-3">
                  <div aria-hidden className={`absolute top-0 left-0 flex w-4 justify-center ${i === stageHistory.length - 1 ? 'h-2' : '-bottom-2.5'}`}>
                    <div className="w-px bg-border" />
                  </div>
                  <span aria-hidden className="relative flex size-4 flex-none items-center justify-center bg-card">
                    <span className="size-1.5 rounded-full bg-background ring-1 ring-border" />
                  </span>
                  <span className="min-w-0">{stageChangeText(c, timeZone)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
