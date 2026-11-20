import { Mail, MessageSquare, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { formatWhen } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { dismissAllFailedFn, dismissMessageFn, getMessageLog, retryMessageFn } from '#/lib/message-log.functions'
import { cn } from '#/lib/utils'

// Settings > Message log (message-log.server.ts): the CRM's emails and texts from the last 30 days and what happened
// to each, with the error in plain view. Failed ones can be sent again or dismissed (which clears the banner).

type Row = Awaited<ReturnType<typeof getMessageLog>>[number]

const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  sent: { label: 'Sent', cls: 'border-success/30 bg-success/10 text-success' },
  waiting: { label: 'Waiting', cls: 'border-highlight/50 bg-highlight/15 text-highlight-foreground' },
  retrying: { label: 'Retrying', cls: 'border-warning/40 bg-warning/15 text-warning-foreground' },
  failed: { label: 'Failed', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', cls: 'border-border bg-muted text-muted-foreground' },
  dismissed: { label: 'Dismissed', cls: 'border-border bg-muted text-muted-foreground' },
}

export function MessageLogSection({ timeZone }: { timeZone: string }) {
  const [filter, setFilter] = useState<'problems' | 'all'>('problems')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setRows(await getMessageLog({ data: { filter } }))
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }, [filter])
  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id)
    try {
      await fn()
      toast.success(done)
      await load()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const failedCount = (rows ?? []).filter((r) => r.status === 'failed' || r.status === 'retrying').length

  return (
    <section aria-labelledby="message-log-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="message-log-title" className="text-lg font-semibold tracking-tight">
            Message log
          </h2>
          <p className="text-sm text-muted-foreground">Emails and texts the CRM sent or tried to send in the last 30 days, and any error.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Show" className="inline-flex rounded-md border p-0.5 text-sm">
            {(['problems', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn('rounded px-3 py-1', filter === f ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {f === 'problems' ? 'Needs attention' : 'Everything'}
              </button>
            ))}
          </div>
          {filter === 'problems' && failedCount > 1 && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('all', () => dismissAllFailedFn(), 'All failed messages dismissed')}>
              Dismiss all
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border">
        {rows === null ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{filter === 'problems' ? 'Nothing needs attention. Every message went out.' : 'No messages in the last 30 days.'}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const st = STATUS[r.status]
              const canAct = r.status === 'failed' || r.status === 'retrying'
              const Icon = r.channel === 'text' ? MessageSquare : Mail
              return (
                <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-status={r.status}>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', st.cls)}>{st.label}</span>
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-medium">{r.label}</span>
                      {r.createdAt && <span className="text-xs text-muted-foreground">{formatWhen(r.createdAt, timeZone)}</span>}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {r.to && <span className="text-foreground">To {r.to}</span>}
                      {r.to && r.summary && ' · '}
                      {r.summary}
                    </p>
                    {r.status === 'waiting' && r.nextAttemptAt && <p className="text-xs text-muted-foreground">Goes out {formatWhen(r.nextAttemptAt, timeZone)}</p>}
                    {r.error && r.status !== 'sent' && (
                      <p className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-words text-foreground/80">
                        {r.error}
                        {r.attempts > 0 && <span className="text-muted-foreground"> ({r.attempts} {r.attempts === 1 ? 'try' : 'tries'})</span>}
                      </p>
                    )}
                  </div>
                  {canAct && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm('Send this again? If it did reach them the first time, they will get it twice.'))
                            void act(r.id, () => retryMessageFn({ data: { id: r.id } }), 'Sending again')
                        }}
                      >
                        <RotateCw /> Retry
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(r.id, () => dismissMessageFn({ data: { id: r.id } }), 'Dismissed')}>
                        <X /> Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
