import { Calculator, Globe, Mail, MessageCircle, PenLine, Phone, type LucideIcon } from 'lucide-react'
import { type Channel, CHANNELS, channelLabel } from '#/lib/lead-origin'
import { cn } from '#/lib/utils'

// How a Lead came in, as a small colored pill (Leads board, list and the Lead page). Colors stay soft so a column of
// cards reads at a glance without shouting; the label is always there, so color is never the only cue.
const STYLE: Record<Channel, { icon: LucideIcon; cls: string }> = {
  estimator: { icon: Calculator, cls: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  quote_form: { icon: Globe, cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  website: { icon: Globe, cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  text: { icon: MessageCircle, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  call: { icon: Phone, cls: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300' },
  email: { icon: Mail, cls: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' },
  manual: { icon: PenLine, cls: 'bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300' },
}

export function ChannelPill({ channel, className }: { channel: string | null | undefined; className?: string }) {
  const s = (CHANNELS as readonly string[]).includes(channel ?? '') ? STYLE[channel as Channel] : { icon: PenLine, cls: 'bg-muted text-muted-foreground' }
  const Icon = s.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', s.cls, className)}>
      <Icon className="size-3" aria-hidden />
      {channelLabel(channel)}
    </span>
  )
}
