import { Camera, Copy, EyeOff, Images, MessageSquare, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { formatDay } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { LINK_STAGES, type LinkStage, PHOTO_LINK_DAYS, PHOTO_STAGES, PHOTO_STAGE_LABELS } from '#/lib/photo-vocab'
import { createPhotoLink, listPhotoLinks, listPhotos, revokePhotoLink, updatePhoto } from '#/lib/photos.functions'
import { cn } from '#/lib/utils'

// Photos on a Lead, Job or Customer page (GLOSSARY Photo, Photo link): the photos by stage, and "Send photo link" to
// text Pat an upload link. Loaded on the client after the page, so a slow photo list never holds the page up.

type Target = { leadId?: string; jobId?: string; customerId?: string }
type Photo = Awaited<ReturnType<typeof listPhotos>>[number]
type OpenLink = Awaited<ReturnType<typeof listPhotoLinks>>[number]
type NewLink = Awaited<ReturnType<typeof createPhotoLink>>

/** `sms:` with only a body: the phone's Messages app opens and you pick Pat. */
const smsHref = (message: string) => `sms:?&body=${encodeURIComponent(message)}`

export function PhotosPanel({ target, defaultStage, timeZone }: { target: Target; defaultStage?: LinkStage; timeZone: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [links, setLinks] = useState<OpenLink[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const canSend = Boolean(target.leadId || target.jobId)

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        listPhotos({ data: target }),
        canSend ? listPhotoLinks({ data: { leadId: target.leadId, jobId: target.jobId } }) : Promise.resolve([]),
      ])
      setPhotos(p)
      setLinks(l)
    } catch (error) {
      toast.error(await errorMessage(error))
      setPhotos([])
    }
  }, [target.leadId, target.jobId, target.customerId, canSend])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(p: Photo, change: { favorite?: boolean; hidden?: boolean }) {
    try {
      await updatePhoto({ data: { photoId: p.id, ...change } })
      setPhotos((list) => list?.map((x) => (x.id === p.id ? { ...x, ...change } : x)) ?? null)
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }

  const visible = (photos ?? []).filter((p) => showHidden || !p.hidden)
  const hiddenCount = (photos ?? []).filter((p) => p.hidden).length

  return (
    <section aria-label="Photos" className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Images className="size-4 text-muted-foreground" />
          Photos
        </h2>
        {canSend && <SendPhotoLink target={target} defaultStage={defaultStage ?? 'before'} onSent={load} />}
      </div>

      {links.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
              <span>
                {PHOTO_STAGE_LABELS[l.stage]} link sent {formatDay(new Date(l.createdAt), timeZone)} · {l.photoCount} {l.photoCount === 1 ? 'photo' : 'photos'}
                {l.doneAt ? ' · Pat marked it done' : ''}
                <span className="text-muted-foreground"> · works until {formatDay(new Date(l.expiresAt), timeZone)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={async () => {
                  try {
                    await revokePhotoLink({ data: { linkId: l.id } })
                    toast.success('Link turned off')
                    await load()
                  } catch (error) {
                    toast.error(await errorMessage(error))
                  }
                }}
              >
                Turn off
              </Button>
            </li>
          ))}
        </ul>
      )}

      {photos === null ? (
        <p className="text-sm text-muted-foreground">Loading photos…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos yet.{canSend ? ' Send Pat a photo link to get some.' : ''}</p>
      ) : (
        PHOTO_STAGES.map((stage) => {
          const group = visible.filter((p) => p.stage === stage)
          if (!group.length) return null
          return (
            <div key={stage} className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {PHOTO_STAGE_LABELS[stage]} ({group.length})
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.map((p) => (
                  <li key={p.id} className={cn('group relative aspect-square overflow-hidden rounded-lg bg-muted', p.hidden && 'opacity-40')}>
                    <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer" title={p.takenAt ? `Taken ${formatDay(new Date(p.takenAt), timeZone)}` : undefined}>
                      <img src={`/api/photos/${p.id}?size=thumb`} alt={p.caption ?? ''} loading="lazy" className="size-full object-cover" />
                    </a>
                    <div className="absolute inset-x-1 bottom-1 flex justify-between">
                      <button
                        type="button"
                        aria-label={p.favorite ? 'Remove star' : 'Star this photo'}
                        aria-pressed={p.favorite}
                        onClick={() => toggle(p, { favorite: !p.favorite })}
                        className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white"
                      >
                        <Star className={cn('size-4', p.favorite && 'fill-yellow-400 text-yellow-400')} />
                      </button>
                      <button
                        type="button"
                        aria-label={p.hidden ? 'Show this photo' : 'Hide this photo'}
                        onClick={() => toggle(p, { hidden: !p.hidden })}
                        className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white"
                      >
                        <EyeOff className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })
      )}
      {hiddenCount > 0 && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? 'Hide hidden photos' : `Show ${hiddenCount} hidden`}
        </button>
      )}
    </section>
  )
}

function SendPhotoLink({ target, defaultStage, onSent }: { target: Target; defaultStage: LinkStage; onSent: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<LinkStage>(defaultStage)
  const [link, setLink] = useState<NewLink | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      setLink(await createPhotoLink({ data: { leadId: target.leadId, jobId: target.jobId, stage } }))
      await onSent()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy. Press and hold the link to copy it.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setLink(null)
          setStage(defaultStage)
        }
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Camera />
        Send photo link
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Pat a photo link</DialogTitle>
          <DialogDescription>
            Pat opens it on his phone and takes the photos; they land here. It works for {PHOTO_LINK_DAYS} days and can only add photos.
          </DialogDescription>
        </DialogHeader>
        {!link ? (
          <>
            <fieldset className="grid grid-cols-3 gap-2" disabled={busy}>
              <legend className="sr-only">Which photos</legend>
              {LINK_STAGES.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium',
                    stage === s ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground',
                  )}
                >
                  <input type="radio" name="photo-stage" value={s} checked={stage === s} onChange={() => setStage(s)} className="sr-only" />
                  {PHOTO_STAGE_LABELS[s]}
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button onClick={create} disabled={busy}>
                Make the link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">{link.title}</p>
            <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all select-all">{link.url}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild>
                <a href={smsHref(link.message)}>
                  <MessageSquare />
                  Text Pat
                </a>
              </Button>
              <Button variant="outline" onClick={copy}>
                <Copy />
                Copy link
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">“Text Pat” opens Messages on this phone or Mac with the link filled in; pick Pat and send.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
