import { Check, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { selectClass } from '#/components/LeadForm'
import { Checkbox } from '#/components/ui/checkbox'
import { errorMessage } from '#/lib/errors'
import { PROJECT_STEPS, PROJECT_STEP_LABELS, type ProjectStep, stepProgress } from '#/lib/project-steps'
import { getJobChecklist, moveJobStep, tickChecklistItem } from '#/lib/projects.functions'
import { cn } from '#/lib/utils'

// A Job's project step and checklist (GLOSSARY Project step), on the Job page and in the board's side panel. The
// current step is open; the others fold. Items that tick themselves show a sparkle and say where the tick comes from.

type Checklist = Awaited<ReturnType<typeof getJobChecklist>>

export function ProjectChecklist({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const [list, setList] = useState<Checklist | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<ProjectStep | null>(null)

  const load = useCallback(async () => {
    try {
      const l = await getJobChecklist({ data: { jobId } })
      setList(l)
      setOpen((o) => o ?? l.step)
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  async function move(step: ProjectStep) {
    setBusy(true)
    try {
      await moveJobStep({ data: { jobId, step } })
      setOpen(step)
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function tick(key: string, done: boolean) {
    setList((l) => (l ? { ...l, items: l.items.map((i) => (i.key === key ? { ...i, done } : i)) } : l))
    try {
      setList(await tickChecklistItem({ data: { jobId, key, done } }))
      onChanged?.()
    } catch (error) {
      toast.error(await errorMessage(error))
      await load()
    }
  }

  if (!list) return <p className="text-sm text-muted-foreground">Loading…</p>
  const currentIndex = PROJECT_STEPS.indexOf(list.step)
  const next = PROJECT_STEPS[currentIndex + 1]
  const current = stepProgress(list.items, list.step)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Project step</span>
          <select value={list.step} disabled={busy} onChange={(e) => move(e.target.value as ProjectStep)} className={selectClass}>
            {PROJECT_STEPS.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STEP_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {next && (
          <button
            type="button"
            disabled={busy}
            onClick={() => move(next)}
            className={cn(
              'h-9 rounded-md border px-3 text-sm font-medium',
              current.total > 0 && current.done === current.total ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            Move to {PROJECT_STEP_LABELS[next]}
          </button>
        )}
      </div>

      <ol className="space-y-2">
        {PROJECT_STEPS.filter((s) => s !== 'done').map((step) => {
          const items = list.items.filter((i) => i.step === step)
          const p = stepProgress(list.items, step)
          const isCurrent = step === list.step
          const isPast = PROJECT_STEPS.indexOf(step) < currentIndex
          const expanded = open === step
          return (
            <li key={step} className={cn('rounded-lg border', isCurrent && 'border-primary/50 bg-primary/5')}>
              <button type="button" onClick={() => setOpen(expanded ? null : step)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                    isPast ? 'border-primary bg-primary text-primary-foreground' : isCurrent ? 'border-primary text-primary' : 'text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {isPast ? <Check className="size-3" /> : PROJECT_STEPS.indexOf(step) + 1}
                </span>
                <span className={cn('flex-1 font-medium', !isCurrent && !isPast && 'text-muted-foreground')}>{PROJECT_STEP_LABELS[step]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{p.total ? `${p.done}/${p.total}` : 'Nothing to do'}</span>
              </button>
              {expanded && items.length > 0 && (
                <ul className="space-y-1 border-t px-3 py-2">
                  {items.map((i) => (
                    <li key={i.key}>
                      <label className={cn('flex min-h-9 items-start gap-2.5 py-1 text-sm', i.kind === 'auto' ? 'cursor-default' : 'cursor-pointer')}>
                        <Checkbox
                          className="mt-0.5"
                          checked={i.done}
                          disabled={i.kind === 'auto'}
                          onCheckedChange={(v) => tick(i.key, v === true)}
                          aria-describedby={i.autoHint ? `hint-${i.key}` : undefined}
                        />
                        <span className="min-w-0">
                          <span className={cn(i.done && 'text-muted-foreground line-through')}>{i.label}</span>
                          {i.kind === 'auto' && (
                            <span id={`hint-${i.key}`} className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Sparkles className="size-3" aria-hidden />
                              {i.done ? 'Done automatically' : i.autoHint}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
