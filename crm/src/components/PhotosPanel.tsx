import { Camera, ChevronLeft, ChevronRight, Copy, Download, EyeOff, Loader2, MessageSquare, Sparkles, Star, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { formatDay } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { preparePhoto } from '#/lib/photo-prepare'
import { type LinkStage, PHOTO_LINK_DAYS, PHOTO_STAGES, PHOTO_STAGE_LABELS, type PhotoStage, isLinkStage } from '#/lib/photo-vocab'
import { createPhotoLink, listPhotoLinks, listPhotos, revokePhotoLink, updatePhoto } from '#/lib/photos.functions'
import { cn } from '#/lib/utils'

// Photos on a Lead, Job or Customer page (GLOSSARY Photo, Photo link): one box per stage (Before, During, After, AI
// mock), each with its own action: "Send photo link" texts Pat an upload link for that stage; "Add AI mock" uploads
// pictures from this computer. A photo opens in a viewer here (arrows, star, hide). Loaded after the page.

type Target = { leadId?: string; jobId?: string; customerId?: string }
type Photo = Awaited<ReturnType<typeof listPhotos>>[number]
type OpenLink = Awaited<ReturnType<typeof listPhotoLinks>>[number]
type NewLink = Awaited<ReturnType<typeof createPhotoLink>>

/** `sms:` with only a body: the phone's Messages app opens and you pick Pat. */
const smsHref = (message: string) => `sms:?&body=${encodeURIComponent(message)}`

const EMPTY: Record<PhotoStage, string> = {
  before: 'No before photos yet.',
  during: 'No during photos yet.',
  after: 'No after photos yet.',
  mock: 'No AI mocks yet.',
}

export function PhotosPanel({ target, timeZone }: { target: Target; timeZone: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [links, setLinks] = useState<OpenLink[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [viewing, setViewing] = useState<{ list: Photo[]; index: number } | null>(null)
  const canAdd = Boolean(target.leadId || target.jobId)

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        listPhotos({ data: target }),
        canAdd ? listPhotoLinks({ data: { leadId: target.leadId, jobId: target.jobId } }) : Promise.resolve([]),
      ])
      setPhotos(p)
      setLinks(l)
    } catch (error) {
      toast.error(await errorMessage(error))
      setPhotos([])
    }
  }, [target.leadId, target.jobId, target.customerId, canAdd])

  useEffect(() => {
    void load()
  }, [load])

  async function change(p: Photo, c: { favorite?: boolean; hidden?: boolean }) {
    try {
      await updatePhoto({ data: { photoId: p.id, ...c } })
      const apply = (x: Photo) => (x.id === p.id ? { ...x, ...c } : x)
      setPhotos((list) => list?.map(apply) ?? null)
      setViewing((v) => (v ? { ...v, list: v.list.map(apply) } : v))
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }

  const visible = (photos ?? []).filter((p) => showHidden || !p.hidden)
  const hiddenCount = (photos ?? []).filter((p) => p.hidden).length

  return (
    <section aria-label="Photos" className="space-y-3">
      {!canAdd && <p className="text-sm text-muted-foreground">Photos from all of this Customer’s Jobs. Open a Job to send Pat a photo link or add an AI mock.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {PHOTO_STAGES.map((stage) => (
          <StageBox
            key={stage}
            stage={stage}
            target={target}
            canAdd={canAdd}
            photos={photos === null ? null : visible.filter((p) => p.stage === stage)}
            links={links.filter((l) => l.stage === stage)}
            timeZone={timeZone}
            onChanged={load}
            onOpen={(list, index) => setViewing({ list, index })}
            onToggle={change}
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? 'Hide hidden photos' : `Show ${hiddenCount} hidden`}
        </button>
      )}
      <Lightbox viewing={viewing} timeZone={timeZone} onIndex={(index) => setViewing((v) => (v ? { ...v, index } : v))} onClose={() => setViewing(null)} onToggle={change} />
    </section>
  )
}

function StageBox({
  stage,
  target,
  canAdd,
  photos,
  links,
  timeZone,
  onChanged,
  onOpen,
  onToggle,
}: {
  stage: PhotoStage
  target: Target
  canAdd: boolean
  photos: Photo[] | null
  links: OpenLink[]
  timeZone: string
  onChanged: () => Promise<void>
  onOpen: (list: Photo[], index: number) => void
  onToggle: (p: Photo, c: { favorite?: boolean; hidden?: boolean }) => void
}) {
  const isMock = stage === 'mock'
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {isMock && <Sparkles className="size-4 text-highlight" aria-hidden />}
          {PHOTO_STAGE_LABELS[stage]}
          {photos && photos.length > 0 && <span className="font-normal text-muted-foreground">({photos.length})</span>}
        </h3>
        {canAdd && (isLinkStage(stage) ? <SendPhotoLink target={target} stage={stage} onSent={onChanged} /> : <AddMocks target={target} onAdded={onChanged} />)}
      </div>

      {links.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5">
              <span>
                Link sent {formatDay(new Date(l.createdAt), timeZone)} · {l.photoCount} {l.photoCount === 1 ? 'photo' : 'photos'}
                {l.doneAt ? ' · Pat marked it done' : ''}
                <span className="text-muted-foreground"> · works until {formatDay(new Date(l.expiresAt), timeZone)}</span>
              </span>
              <button
                type="button"
                className="font-medium underline-offset-2 hover:underline"
                onClick={async () => {
                  try {
                    await revokePhotoLink({ data: { linkId: l.id } })
                    toast.success('Link turned off')
                    await onChanged()
                  } catch (error) {
                    toast.error(await errorMessage(error))
                  }
                }}
              >
                Turn off
              </button>
            </li>
          ))}
        </ul>
      )}

      {photos === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{EMPTY[stage]}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id} className={cn('relative aspect-square overflow-hidden rounded-lg bg-muted', p.hidden && 'opacity-40')}>
              <button type="button" onClick={() => onOpen(photos, i)} className="size-full" aria-label={`Open ${PHOTO_STAGE_LABELS[stage].toLowerCase()} photo ${i + 1}`}>
                <img src={`/api/photos/${p.id}?size=thumb`} alt={p.caption ?? ''} loading="lazy" className="size-full object-cover" />
              </button>
              {isMock && <AiBadge className="absolute top-1 left-1" />}
              {p.favorite && (
                <button type="button" aria-label="Remove star" onClick={() => onToggle(p, { favorite: false })} className="absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-full bg-black/45">
                  <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AiBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white', className)} title="Made with AI, not a real photo">
      <Sparkles className="size-3" aria-hidden />
      AI
    </span>
  )
}

function Lightbox({
  viewing,
  timeZone,
  onIndex,
  onClose,
  onToggle,
}: {
  viewing: { list: Photo[]; index: number } | null
  timeZone: string
  onIndex: (i: number) => void
  onClose: () => void
  onToggle: (p: Photo, c: { favorite?: boolean; hidden?: boolean }) => void
}) {
  const p = viewing?.list[viewing.index]
  const count = viewing?.list.length ?? 0
  const go = (d: number) => viewing && count > 1 && onIndex((viewing.index + d + count) % count)

  useEffect(() => {
    if (!viewing) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <Dialog open={Boolean(p)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[min(96vw,72rem)] gap-3 p-3 sm:p-4">
        {p && (
          <>
            <DialogHeader className="px-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                {PHOTO_STAGE_LABELS[p.stage as PhotoStage]} {count > 1 && <span className="font-normal text-muted-foreground">{viewing!.index + 1} of {count}</span>}
                {p.stage === 'mock' && <AiBadge />}
              </DialogTitle>
              <DialogDescription>
                {p.takenAt ? `Taken ${formatDay(new Date(p.takenAt), timeZone)}` : `Added ${formatDay(new Date(p.uploadedAt), timeZone)}`}
                {p.width && p.height ? ` · ${p.width} × ${p.height}` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black">
              <img key={p.id} src={`/api/photos/${p.id}`} alt={p.caption ?? ''} className="max-h-[70vh] w-auto max-w-full object-contain" />
              {count > 1 && (
                <>
                  <button type="button" aria-label="Previous photo" onClick={() => go(-1)} className="absolute left-2 flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                    <ChevronLeft className="size-6" />
                  </button>
                  <button type="button" aria-label="Next photo" onClick={() => go(1)} className="absolute right-2 flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                    <ChevronRight className="size-6" />
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Button size="sm" variant={p.favorite ? 'default' : 'outline'} onClick={() => onToggle(p, { favorite: !p.favorite })} aria-pressed={p.favorite}>
                <Star className={cn(p.favorite && 'fill-current')} />
                {p.favorite ? 'Starred' : 'Star'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onToggle(p, { hidden: !p.hidden })} aria-pressed={p.hidden}>
                <EyeOff />
                {p.hidden ? 'Hidden' : 'Hide'}
              </Button>
              <Button size="sm" variant="ghost" asChild className="ml-auto">
                <a href={`/api/photos/${p.id}`} download>
                  <Download />
                  Download
                </a>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddMocks({ target, onAdded }: { target: Target; onAdded: () => Promise<void> }) {
  const [busy, setBusy] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  async function add(files: FileList | null) {
    if (!files?.length) return
    const list = [...files]
    if (input.current) input.current.value = ''
    setBusy(list.length)
    let failed = 0
    for (const file of list) {
      try {
        const ready = await preparePhoto(file)
        const body = new FormData()
        body.append('photo', ready.photo, 'photo.jpg')
        body.append('thumb', ready.thumb, 'thumb.jpg')
        const q = target.jobId ? `job=${encodeURIComponent(target.jobId)}` : `lead=${encodeURIComponent(target.leadId!)}`
        const res = await fetch(`/api/photos?${q}&stage=mock`, { method: 'POST', body })
        if (!res.ok) throw new Error(await res.text())
      } catch {
        failed++
      }
      setBusy((n) => n - 1)
    }
    if (failed) toast.error(`${failed} of ${list.length} could not be added.`)
    else toast.success(list.length === 1 ? 'AI mock added' : `${list.length} AI mocks added`)
    await onAdded()
  }

  return (
    <Button size="sm" variant="outline" asChild disabled={busy > 0}>
      <label className="cursor-pointer">
        {busy > 0 ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy > 0 ? `Adding ${busy}…` : 'Add AI mock'}
        <input ref={input} type="file" accept="image/*" multiple className="sr-only" disabled={busy > 0} onChange={(e) => add(e.target.files)} />
      </label>
    </Button>
  )
}

function SendPhotoLink({ target, stage, onSent }: { target: Target; stage: LinkStage; onSent: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
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
        if (!v) setLink(null)
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Camera />
        Send photo link
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Pat a link for {PHOTO_STAGE_LABELS[stage].toLowerCase()} photos</DialogTitle>
          <DialogDescription>
            Pat opens it on his phone and takes the photos; they land here. It works for {PHOTO_LINK_DAYS} days and can only add photos.
          </DialogDescription>
        </DialogHeader>
        {!link ? (
          <DialogFooter>
            <Button onClick={create} disabled={busy}>
              Make the link
            </Button>
          </DialogFooter>
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
