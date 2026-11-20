import { useEffect, useState } from 'react'
import { cn } from '#/lib/utils'

// How long a New Lead has waited: hours under a day ("5h"), whole days after ("3d"). Fresh is green, a day or two
// is amber, three days or more is red, so the Leads to call first stand out. Shown only for stage New.

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

export function leadAge(createdAt: Date | string, now: number) {
  const ms = Math.max(0, now - new Date(createdAt).getTime())
  if (ms < HOUR) return { label: '<1h', words: 'less than an hour ago', tone: 'fresh' as const }
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    return { label: `${h}h`, words: `${h} hour${h === 1 ? '' : 's'} ago`, tone: 'fresh' as const }
  }
  const d = Math.floor(ms / DAY)
  return { label: `${d}d`, words: `${d} day${d === 1 ? '' : 's'} ago`, tone: d < 3 ? ('waiting' as const) : ('late' as const) }
}

const TONES = {
  fresh: 'border-success/30 bg-success/10 text-success',
  waiting: 'border-warning/40 bg-warning/15 text-warning-foreground',
  late: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function LeadAgePill({ stage, createdAt, className }: { stage: string; createdAt: Date | string; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (stage !== 'new') return null
  const age = leadAge(createdAt, now)
  return (
    <span
      data-slot="lead-age"
      title={`Came in ${age.words}`}
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums', TONES[age.tone], className)}
    >
      {age.label}
      <span className="sr-only"> old, came in {age.words}</span>
    </span>
  )
}
