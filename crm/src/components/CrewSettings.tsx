import { Plus, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { getCrewSettings, saveCrewSettingsFn } from '#/lib/crew-time.functions'
import { errorMessage } from '#/lib/errors'

// Settings > Company > Crew (crew-time.server.ts): the crew list with each person's usual pay, and the daily
// check-in text to Pat on build days (off until switched on here).

type Loaded = Awaited<ReturnType<typeof getCrewSettings>>
type Row = { id?: string; name: string; aliases: string; payType: '' | 'hourly' | 'day'; rate: string; active: boolean }

const HOURS = [16, 17, 18, 19, 20]
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} PM`
const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs'

export function CrewSettingsSection() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(18)
  const [saving, setSaving] = useState(false)

  const adopt = (s: Loaded | Omit<Loaded, 'preview'>) => {
    setRows(s.crew.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases ?? '', payType: c.payType ?? '', rate: c.rateCents === null ? '' : String(c.rateCents / 100), active: c.active })))
    setEnabled(s.enabled)
    setHour(s.hour)
  }
  useEffect(() => {
    getCrewSettings().then(
      (s) => {
        setLoaded(s)
        adopt(s)
      },
      async (e) => toast.error(await errorMessage(e)),
    )
  }, [])

  async function save() {
    setSaving(true)
    try {
      const s = await saveCrewSettingsFn({
        data: {
          enabled,
          hour,
          crew: rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, payType: r.payType || null, rate: r.rate === '' ? null : Number(r.rate), active: r.active })),
        },
      })
      adopt(s)
      toast.success('Crew saved')
    } catch (e) {
      toast.error(await errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <section id="crew" aria-labelledby="crew-title" className="scroll-mt-20">
      <h2 id="crew-title" className="text-lg font-semibold tracking-tight">
        Crew
      </h2>
      <p className="text-sm text-muted-foreground">Who works on the decks and their usual pay. Pat can give a different amount in his reply for any day.</p>
      <div className="my-4 h-px bg-border" />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Also called</th>
              <th className="px-3 py-2 font-medium">Usual pay</th>
              <th className="px-3 py-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className={r.active ? '' : 'opacity-60'}>
                <td className="px-3 py-2">
                  <Input aria-label="Name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-9 min-w-28" />
                </td>
                <td className="px-3 py-2">
                  <Input aria-label="Also called" placeholder="Tom, T" value={r.aliases} onChange={(e) => set(i, { aliases: e.target.value })} className="h-9 min-w-28" />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <Input aria-label="Usual pay" inputMode="decimal" value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} className="h-9 w-20" />
                    <select aria-label="Pay type" className={selectClass} value={r.payType} onChange={(e) => set(i, { payType: e.target.value as Row['payType'] })}>
                      <option value="">not set</option>
                      <option value="hourly">per hour</option>
                      <option value="day">per day</option>
                    </select>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Checkbox aria-label="Active" checked={r.active} onCheckedChange={(v) => set(i, { active: v === true })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button className="mt-2" size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { name: '', aliases: '', payType: 'hourly', rate: '', active: true }])}>
        <Plus /> Add someone
      </Button>

      <div className="mt-6 space-y-3 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          Text Pat on build days: who worked and how many hours
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Send at</span>
          <select className={selectClass} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">for each Job at the Build step. Texting must be on (Connections).</span>
        </div>
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium text-muted-foreground">What Pat gets</p>
          <p className="rounded-md bg-muted px-3 py-2">{loaded.preview}</p>
          <p className="text-xs text-muted-foreground">
            The CRM texts back what it recorded, e.g. "Got it for Kondracki deck, Fri 11/20: Tommy 8h at $25/hr, Gary $250 day. Reply FIX if that's wrong." He can also reply NONE, SAME (same crew as the last day) or FIX.
          </p>
        </div>
      </div>

      <Button className="mt-4" onClick={save} disabled={saving}>
        <Save /> Save crew
      </Button>
    </section>
  )
}
