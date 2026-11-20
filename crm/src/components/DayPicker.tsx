import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { cn } from '#/lib/utils'

// A day picker in the CRM's own style (the browser's native one looks out of place): a field-sized button that
// opens a month calendar. Values are wall dates "YYYY-MM-DD" (no time zone math); `min` greys out earlier days.

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const parse = (v: string) => {
  const [y, m, d] = v.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** The 6-week grid for a month: each cell's wall date and whether it falls in that month. */
export function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Array.from({ length: 42 }, (_, i) => {
    const dt = new Date(Date.UTC(year, month, 1 - first + i))
    return { value: iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()), day: dt.getUTCDate(), inMonth: dt.getUTCMonth() === month }
  })
}

export function DayPicker({
  value,
  onChange,
  min,
  today,
  disabled,
  id,
}: {
  value: string
  onChange: (v: string) => void
  min?: string
  today: string
  disabled?: boolean
  id?: string
}) {
  const start = parse(value || today)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ y: start.y, m: start.m })
  const cells = monthGrid(view.y, view.m)
  const shift = (n: number) => setView(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }))
  const monthName = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const label = value
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'Pick a day'
  const canGoBack = !min || iso(view.y, view.m, 1) > min.slice(0, 8) + '01'

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          const s = parse(value || today)
          setView({ y: s.y, m: s.m })
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-base shadow-xs transition-colors',
            'hover:border-highlight focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            open && 'border-highlight ring-2 ring-highlight/30',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => shift(-1)} className="flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30">
            <ChevronLeft className="size-4" />
          </button>
          <span className="font-display text-sm font-semibold">{monthName}</span>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} className="flex size-8 items-center justify-center rounded-md hover:bg-accent">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={monthName}>
          {WEEKDAYS.map((w) => (
            <span key={w} className="pb-1 text-[11px] font-medium text-muted-foreground">
              {w}
            </span>
          ))}
          {cells.map((c) => {
            const past = Boolean(min && c.value < min)
            const selected = c.value === value
            const isToday = c.value === today
            return (
              <button
                key={c.value}
                type="button"
                disabled={past}
                aria-pressed={selected}
                aria-label={new Date(`${c.value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                onClick={() => {
                  onChange(c.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex size-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors',
                  !c.inMonth && 'text-muted-foreground/50',
                  past ? 'cursor-not-allowed text-muted-foreground/35' : 'hover:bg-highlight/20',
                  isToday && !selected && 'font-semibold ring-1 ring-highlight',
                  selected && 'bg-brand font-semibold text-brand-foreground hover:bg-brand',
                )}
              >
                {c.day}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
