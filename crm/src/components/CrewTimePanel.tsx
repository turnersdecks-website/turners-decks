import { AlertTriangle, Check, HardHat, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { addCrewTimeFn, clearCrewReviewFn, getJobCrewTime, removeCrewTimeFn } from '#/lib/crew-time.functions'
import { formatMoney } from '#/lib/customer-vocab'
import { errorMessage } from '#/lib/errors'
import { cn } from '#/lib/utils'

// Job page: who worked on the Job, day by day (crew-time.server.ts). Rows come from Pat's replies to the 6 PM
// check-in text or are added here. Flagged rows (a name not on the crew list, or no pay) are marked for Kristin.
// The totals fill the Job's labor hours and labor cost.

type Data = Awaited<ReturnType<typeof getJobCrewTime>>

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs'

export function CrewTimePanel({ jobId, today, onChanged }: { jobId: string; today: string; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ workDate: today, crewMemberId: '', name: '', hours: '', payType: 'hourly' as 'hourly' | 'day', rate: '' })
  const load = useCallback(() => getJobCrewTime({ data: { jobId } }).then(setData, () => setData(null)), [jobId])
  useEffect(() => void load(), [load])

  async function act(fn: () => Promise<Data>, done: string) {
    setBusy(true)
    try {
      setData(await fn())
      toast.success(done)
      onChanged()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const days = [...new Set(data.rows.map((r) => r.workDate))]
  const picked = data.crew.find((c) => c.id === form.crewMemberId)

  return (
    <section aria-label="Crew time" className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5" data-slot="crew-time">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <HardHat className="size-4 text-muted-foreground" />
          Crew time
        </h2>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus /> Add by hand
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Days logged</p>
          <p className="text-lg font-semibold tabular-nums">{days.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crew hours</p>
          <p className="text-lg font-semibold tabular-nums">{Math.round(data.totals.hours * 10) / 10}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crew cost</p>
          <p className="text-lg font-semibold tabular-nums">{formatMoney(data.totals.costCents) || '$0'}</p>
        </div>
      </div>
      {data.needsReview > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {data.needsReview === 1 ? '1 entry needs' : `${data.needsReview} entries need`} a look: a name not on the crew list, or no pay to price it.
        </p>
      )}

      {adding && (
        <form
          className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault()
            void act(
              () =>
                addCrewTimeFn({
                  data: {
                    jobId,
                    workDate: form.workDate,
                    crewMemberId: form.crewMemberId || null,
                    name: form.crewMemberId ? undefined : form.name,
                    hours: form.hours === '' ? null : Number(form.hours),
                    payType: form.rate === '' ? null : form.payType,
                    rate: form.rate === '' ? null : Number(form.rate),
                  },
                }),
              'Crew time added',
            ).then(() => setForm((f) => ({ ...f, crewMemberId: '', name: '', hours: '', rate: '' })))
          }}
        >
          <label className="text-xs sm:col-span-1">
            Day
            <Input type="date" value={form.workDate} max={today} onChange={(e) => setForm({ ...form, workDate: e.target.value })} className="h-9" />
          </label>
          <label className="text-xs sm:col-span-2">
            Who
            <select className={selectClass} value={form.crewMemberId} onChange={(e) => setForm({ ...form, crewMemberId: e.target.value })}>
              <option value="">Someone else…</option>
              {data.crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!form.crewMemberId && <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-9" />}
          </label>
          <label className="text-xs">
            Hours
            <Input inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} className="h-9" placeholder="8" />
          </label>
          <label className="text-xs sm:col-span-2">
            Pay {picked?.rateCents != null && <span className="text-muted-foreground">(blank = usual {formatMoney(picked.rateCents)}{picked.payType === 'hourly' ? '/hr' : ' a day'})</span>}
            <div className="flex gap-1">
              <Input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="h-9" placeholder="$" />
              <select className={cn(selectClass, 'w-28')} value={form.payType} onChange={(e) => setForm({ ...form, payType: e.target.value as 'hourly' | 'day' })}>
                <option value="hourly">per hour</option>
                <option value="day">for the day</option>
              </select>
            </div>
          </label>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={busy}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
        </form>
      )}

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No crew time yet. Pat's replies to the 6 PM text land here, or add it by hand.</p>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const rows = data.rows.filter((r) => r.workDate === d)
            const dayCost = rows.reduce((a, r) => a + (r.costCents ?? 0), 0)
            return (
              <div key={d}>
                <div className="flex items-baseline justify-between border-b pb-1 text-xs font-medium text-muted-foreground">
                  <span>{dayLabel(d)}</span>
                  <span className="tabular-nums">{formatMoney(dayCost) || '$0'}</span>
                </div>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.id} className={cn('flex items-center justify-between gap-2 py-1.5 text-sm', r.needsReview && 'text-warning-foreground')}>
                      <span className="flex min-w-0 items-center gap-2">
                        {r.needsReview && <AlertTriangle className="size-3.5 shrink-0" aria-label="Needs a look" />}
                        <span className="truncate font-medium">{r.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {r.hours !== null ? `${r.hours}h` : ''}
                          {r.payType === 'day' && r.rateCents !== null ? ` · ${formatMoney(r.rateCents)} day` : ''}
                          {r.payType === 'hourly' && r.rateCents !== null ? ` · ${formatMoney(r.rateCents)}/hr` : ''}
                        </span>
                        {r.source === 'text' && <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-label="From Pat's text" />}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="tabular-nums">{r.costCents === null ? '–' : formatMoney(r.costCents)}</span>
                        {r.needsReview && (
                          <Button size="icon-sm" variant="ghost" title="Looks right" aria-label="Mark checked" disabled={busy} onClick={() => act(() => clearCrewReviewFn({ data: { id: r.id } }), 'Marked checked')}>
                            <Check className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Remove"
                          aria-label={`Remove ${r.name} on ${dayLabel(d)}`}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Remove ${r.name} on ${dayLabel(d)}?`)) void act(() => removeCrewTimeFn({ data: { id: r.id } }), 'Removed')
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
