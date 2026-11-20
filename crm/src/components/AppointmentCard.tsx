import { CalendarClock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { bookLeadAppointment, cancelLeadAppointment, listAppointmentMessages } from '#/lib/appointments.functions'
import { epochToWallTime, formatWhen, wallTimeToEpoch } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'

// Lead page rail: the free consultation (src/lib/appointments.server.ts). Book or move it, choose email and/or text,
// and see what was sent and what is waiting (the reminder, 24 hours before).

type Msg = Awaited<ReturnType<typeof listAppointmentMessages>>[number]

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
  const [when, setWhen] = useState(lead.appointmentAt ? epochToWallTime(new Date(lead.appointmentAt).getTime(), timeZone) : '')
  const [sendEmail, setSendEmail] = useState(Boolean(lead.email))
  const [sendText, setSendText] = useState(Boolean(lead.phoneE164))
  const [saving, setSaving] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const loadMessages = useCallback(() => listAppointmentMessages({ data: { leadId: lead.id } }).then(setMsgs, () => setMsgs([])), [lead.id])
  useEffect(() => void loadMessages(), [loadMessages])
  useEffect(() => setWhen(lead.appointmentAt ? epochToWallTime(new Date(lead.appointmentAt).getTime(), timeZone) : ''), [lead.appointmentAt, timeZone])

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

  return (
    <section aria-label="Appointment" className="space-y-3 border-b px-4 py-4 sm:px-5" data-slot="appointment-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 text-muted-foreground" />
        Appointment
      </h2>
      {booked && <p className="text-sm font-medium">{formatWhen(lead.appointmentAt!, timeZone)}</p>}
      <Input type="datetime-local" aria-label="Appointment date and time" value={when} disabled={disabled} onChange={(e) => setWhen(e.target.value)} />
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
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || !when}
          onClick={() =>
            act(
              () => bookLeadAppointment({ data: { leadId: lead.id, at: wallTimeToEpoch(when, timeZone), sendEmail: sendEmail && !lead.doNotContact, sendText: sendText && !lead.doNotContact } }),
              booked ? 'Appointment moved' : 'Appointment booked',
            )
          }
        >
          {booked ? 'Move appointment' : 'Book appointment'}
        </Button>
        {booked && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => act(() => cancelLeadAppointment({ data: { leadId: lead.id } }), 'Appointment cancelled')}>
            Cancel it
          </Button>
        )}
      </div>
      {visible.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {visible.map((m) => (
            <li key={m.id}>
              <span className="font-medium text-foreground">
                {m.which === 'reminder' ? 'Reminder' : 'Confirmation'} {m.channel}
              </span>{' '}
              {status(m, timeZone)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
