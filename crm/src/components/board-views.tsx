import { useNavigate } from '@tanstack/react-router'
import { KanbanSquare, List } from 'lucide-react'
import { type BoardView, type ViewPage, saveView } from '#/lib/view-pref'
import { cn } from '#/lib/utils'

// Shared pieces of the two-view pages (Leads, Jobs): the Board / List switch and the list's tabs.

/** Board / List switch. Saves the choice (view-pref.ts) and puts it in the URL so links and Back keep it. */
export function ViewToggle({ page, view }: { page: ViewPage; view: BoardView }) {
  const navigate = useNavigate()
  const pick = (v: BoardView) => {
    saveView(page, v)
    void navigate({ to: '.', search: ((s: Record<string, unknown>) => ({ ...s, view: v })) as never, replace: true })
  }
  const btn = (v: BoardView, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => pick(v)}
      aria-pressed={view === v}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition',
        view === v ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="View" className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {btn('board', 'Board', KanbanSquare)}
      {btn('list', 'List', List)}
    </div>
  )
}

/** The list view's tabs (Open / Won / Lost / All...), each with its count. */
export function ShowTabs<T extends string>({ tabs, value, counts }: { tabs: readonly { id: T; label: string }[]; value: T; counts: Record<T, number> }) {
  const navigate = useNavigate()
  return (
    <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => void navigate({ to: '.', search: ((s: Record<string, unknown>) => ({ ...s, show: t.id })) as never, replace: true })}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition',
            value === t.id ? 'border-primary/40 bg-primary/5 font-semibold' : 'border-transparent text-muted-foreground hover:bg-muted',
          )}
        >
          {t.label}
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums">{counts[t.id]}</span>
        </button>
      ))}
    </div>
  )
}
