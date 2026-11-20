import { CalendarCheck, CalendarClock, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { bookLeadAppointment, cancelLeadAppointment, listAppointmentMessages } from '#/lib/appointments.functions'
import { epochToWallTime, formatWhen, wallTimeToEpoch } from '#/lib/dates'
import { cn } from '#/lib/utils'
import { errorMessage } from '#/lib/errors'

// Lead page rail: the free consultation (src/lib/appointments.server.ts). Book or move it, choose email and/or text,
// and see what was sent and what is waiting (the reminder, 24 hours before).

type Msg = Awaited<ReturnType<typeof listAppointmentMessages>>[number]

/** Common visit times, one tap each; anything else goes in "Other time". */
const SLOTS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']
const slotLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
const dotOf = (m: Msg) => (m.state === 'sent' ? 'bg-success' : m.outcome === 'cancelled' ? 'bg-muted-foreground' : m.state === 'pending' || m.state === 'claimed' ? 'bg-warning' : 'bg-destructive')

const status = (m: Msg, timeZone: string) =>
  m.state === 'sent'
    ? `sent ${m.sentAt ? formatWhen(m.sentAt, timeZone) : ''}`
    : m.outcome === 'cancelled'
      ? 'cancelled'
      : m.state === 'pending' || m.state === 'claimed'
        ? `goes out ${m.nextAttemptAt ? formatWhen(m.nextAttemptAt, timeZone) : 'soon'}`
        : `not sent${m.lastError ? `: ${m.lastError}` : ''}`

export function AppointmentCard({
  lead,
  timeZone,
  busy,
  onChange,
}: {
  lead: { id: string; appointmentAt: Date | null; email: string | null; phoneE164: string | null; doNotContact: boolean }
  timeZone: string
  busy: boolean
  onChange: () => Promise<void>
}) {
  const initial = lead.appointmentAt ? epochToWallTime(new Date(lead.appointmentAt).getTime(), timeZone) : ''
  const [day, setDay] = useState(initial.slice(0, 10))
  const [time, setTime] = useState(initial.slice(11, 16))
  const [sendEmail, setSendEmail] = useState(Boolean(lead.email))
  const [sendText, setSendText] = useState(Boolean(lead.phoneE164))
  const [saving, setSaving] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const loadMessages = useCallback(() => listAppointmentMessages({ data: { leadId: lead.id } }).then(setMsgs, () => setMsgs([])), [lead.id])
  useEffect(() => void loadMessages(), [loadMessages])
  useEffect(() => {
    const w = lead.appointmentAt ? epochToWallTime(new Date(lead.appointmentAt).getTime(), timeZone) : ''
    setDay(w.slice(0, 10))
    setTime(w.slice(11, 16))
  }, [lead.appointmentAt, timeZone])

  async function act(fn: () => Promise<unknown>, done: string) {
    setSaving(true)
    try {
      await fn()
      toast.success(done)
      await Promise.all([onChange(), loadMessages()])
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const booked = Boolean(lead.appointmentAt)
  const disabled = busy || saving
  const visible = msgs.filter((m) => m.outcome !== 'cancelled').slice(0, 6)
  const ready = Boolean(day && time)
  const today = epochToWallTime(Date.now(), timeZone).slice(0, 10)
  const otherTime = time && !SLOTS.includes(time) ? time : ''

  return (
    <section aria-label="Appointment" className="space-y-4 border-b border-t-4 border-t-highlight px-4 py-4 sm:px-5" data-slot="appointment-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-7 items-center justify-center rounded-md bg-highlight/20 text-highlight-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        Appointment
      </h2>
      {booked && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
          <span className="block text-xs text-muted-foreground">Booked for</span>
          <span className="font-semibold">{formatWhen(lead.appointmentAt!, timeZone)}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`appt-day-${lead.id}`} className="text-xs font-medium text-muted-foreground">
          Day
        </label>
        <Input
          id={`appt-day-${lead.id}`}
          type="date"
          min={today}
          value={day}
          disabled={disabled}
          onChange={(e) => setDay(e.target.value)}
          // The whole box opens the calendar, not only the small icon.
          onClick={(e) => {
            try {
              e.currentTarget.showPicker()
            } catch {}
          }}
          className="h-11 cursor-pointer text-base"
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Time</span>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Appointment time">
          {SLOTS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={time === t}
              disabled={disabled}
              onClick={() => setTime(t)}
              className={cn(
                'h-9 rounded-md border text-sm transition-colors disabled:opacity-50',
                time === t ? 'border-highlight bg-highlight text-highlight-foreground font-semibold shadow-xs' : 'border-input bg-background hover:border-highlight hover:bg-highlight/15',
              )}
            >
              {slotLabel(t)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          Other time
          <Input type="time" step={900} value={otherTime} disabled={disabled} onChange={(e) => setTime(e.target.value)} className="h-9 w-32 text-sm" aria-label="Other appointment time" />
        </label>
      </div>

      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={sendEmail} disabled={disabled || !lead.email || lead.doNotContact} onCheckedChange={(v) => setSendEmail(v === true)} />
          Email confirmation and reminder{!lead.email && <span className="text-xs text-muted-foreground">(no email)</span>}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={sendText} disabled={disabled || !lead.phoneE164 || lead.doNotContact} onCheckedChange={(v) => setSendText(v === true)} />
          Text confirmation and reminder{!lead.phoneE164 && <span className="text-xs text-muted-foreground">(no mobile)</span>}
        </label>
        <p className="text-xs text-muted-foreground">The confirmation goes out now; the reminder 24 hours before.</p>
      </div>

      <div className="space-y-2">
        <Button
          className={cn('h-11 w-full text-sm font-semibold transition-all', ready && !disabled ? 'bg-success text-success-foreground shadow-md hover:bg-success/90 hover:shadow-lg' : 'bg-muted text-muted-foreground shadow-none')}
          disabled={disabled || !ready}
          onClick={() =>
            act(
              () =>
                bookLeadAppointment({
                  data: { leadId: lead.id, at: wallTimeToEpoch(`${day}T${time}`, timeZone), sendEmail: sendEmail && !lead.doNotContact, sendText: sendText && !lead.doNotContact },
                }),
              booked ? 'Appointment moved' : 'Appointment booked',
            )
          }
        >
          {saving ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
          {saving ? 'Booking…' : ready ? `${booked ? 'Move to' : 'Book'} ${new Date(`${day}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${slotLabel(time)}` : 'Pick a day and time'}
        </Button>
        {booked && (
          <Button size="sm" variant="ghost" className="w-full text-destructive hover:text-destructive" disabled={disabled} onClick={() => act(() => cancelLeadAppointment({ data: { leadId: lead.id } }), 'Appointment cancelled')}>
            Cancel appointment
          </Button>
        )}
      </div>

      {visible.length > 0 && (
        <ul className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
          {visible.map((m) => (
            <li key={m.id} className="flex items-start gap-2">
              <span className={cn('mt-1 size-2 shrink-0 rounded-full', dotOf(m))} aria-hidden />
              <span>
                <span className="font-medium text-foreground">
                  {m.which === 'reminder' ? 'Reminder' : 'Confirmation'} {m.channel}
                </span>{' '}
                {status(m, timeZone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
