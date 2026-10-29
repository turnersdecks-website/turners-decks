import { Camera, Check, CircleAlert, Images, Loader2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { preparePhoto } from '#/lib/photo-prepare'

// Pat's upload page body (GLOSSARY Photo link): one big button, photos upload in the background two at a time and
// retry on a bad signal, a thumbnail and check mark per photo, and an optional "I'm done".

type Status = 'preparing' | 'uploading' | 'done' | 'failed'
type Item = { key: string; file: File; status: Status; preview: string | null; tries: number; error?: string }

const MAX_TRIES = 5
const PARALLEL = 2

export function PhotoUploader({
  title,
  credentials,
  existingIds,
  initiallyDone,
}: {
  title: string
  /** Query string that proves the link: `t=<token>` or `d=<home screen>&l=<link id>`. */
  credentials: string
  existingIds: string[]
  initiallyDone: boolean
}) {
  const [items, setItems] = useState<Item[]>([])
  const [expired, setExpired] = useState(false)
  const [done, setDone] = useState(initiallyDone)
  const [finishing, setFinishing] = useState(false)
  const running = useRef(new Set<string>())
  const prepared = useRef(new Map<string, Awaited<ReturnType<typeof preparePhoto>>>())

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  async function upload(item: Item) {
    running.current.add(item.key)
    try {
      let ready = prepared.current.get(item.key)
      if (!ready) {
        patch(item.key, { status: 'preparing' })
        ready = await preparePhoto(item.file)
        prepared.current.set(item.key, ready)
        patch(item.key, { preview: URL.createObjectURL(ready.thumb) })
      }
      patch(item.key, { status: 'uploading' })
      const body = new FormData()
      body.append('photo', ready.photo, 'photo.jpg')
      body.append('thumb', ready.thumb, 'thumb.jpg')
      if (ready.takenAt) body.append('takenAt', String(ready.takenAt))
      const res = await fetch(`/api/public/photos?${credentials}`, { method: 'POST', body })
      if (res.status === 410) {
        setExpired(true)
        patch(item.key, { status: 'failed', error: 'Link expired' })
        return
      }
      if (!res.ok) throw new Error(await res.text())
      prepared.current.delete(item.key)
      patch(item.key, { status: 'done', error: undefined })
    } catch (err) {
      const tries = item.tries + 1
      const message = err instanceof Error && err.message ? err.message : 'Upload failed'
      patch(item.key, { status: 'failed', tries, error: message })
      // A bad signal: try again on its own, waiting a little longer each time.
      if (tries < MAX_TRIES) setTimeout(() => patch(item.key, { status: 'uploading', tries }), 2000 * 2 ** tries)
    } finally {
      running.current.delete(item.key)
    }
  }

  // The queue: start waiting photos while fewer than PARALLEL are in flight.
  useEffect(() => {
    if (expired) return
    const waiting = items.filter((i) => (i.status === 'uploading' || i.status === 'preparing') && !running.current.has(i.key))
    const free = PARALLEL - running.current.size
    for (const item of waiting.slice(0, Math.max(0, free))) void upload(item)
  })

  // Keep Pat from closing the page while photos are still going.
  useEffect(() => {
    const busy = items.some((i) => i.status !== 'done' && !(i.status === 'failed' && i.tries >= MAX_TRIES))
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [items])

  function add(picker: HTMLInputElement) {
    const files = picker.files
    if (!files?.length) return
    const added = [...files].map((file) => ({ key: crypto.randomUUID(), file, status: 'preparing' as Status, preview: null, tries: 0 }))
    setItems((list) => [...list, ...added])
    setDone(false)
    picker.value = ''
  }

  async function finish() {
    setFinishing(true)
    try {
      const res = await fetch(`/api/public/photos/done?${credentials}`, { method: 'POST' })
      if (res.status === 410) setExpired(true)
      else if (res.ok) setDone(true)
    } finally {
      setFinishing(false)
    }
  }

  const sent = existingIds.length + items.filter((i) => i.status === 'done').length
  const pending = items.filter((i) => i.status !== 'done').length

  if (expired) {
    return (
      <Shell title={title}>
        <p className="rounded-2xl bg-amber-50 p-5 text-lg text-amber-900">This photo link has expired or was turned off. Ask Kristin for a new one.</p>
      </Shell>
    )
  }

  return (
    <Shell title={title}>
      {/* Two buttons because a web page cannot open the phone's full Camera app: "Take a photo" goes straight to the
          camera (one shot, then back here); "Choose from camera roll" picks many at once, e.g. shots taken in the
          Camera app. */}
      <label className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl bg-brand px-6 py-6 text-2xl font-semibold text-brand-foreground shadow-lg active:scale-[0.99]">
        <Camera className="size-11" aria-hidden />
        Take a photo
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => add(e.target)} />
      </label>
      <label className="flex min-h-20 w-full cursor-pointer items-center justify-center gap-3 rounded-3xl border-2 border-brand bg-card px-6 text-xl font-semibold text-brand active:scale-[0.99]">
        <Images className="size-7" aria-hidden />
        Choose from camera roll
        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => add(e.target)} />
      </label>

      <p className="text-center text-base text-muted-foreground" aria-live="polite">
        {sent === 0 && pending === 0 ? 'Photos upload as soon as you take them. Taking a lot? Shoot them in your Camera app, then choose them all from your camera roll.' : `${sent} uploaded${pending ? `, ${pending} on the way` : ''}`}
      </p>

      {(items.length > 0 || existingIds.length > 0) && (
        <ul className="grid grid-cols-3 gap-2">
          {existingIds.map((id) => (
            <li key={id} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
              <img src={`/api/public/photos/${id}?${credentials}`} alt="" className="size-full object-cover" loading="lazy" />
              <Badge state="done" />
            </li>
          ))}
          {items.map((i) => (
            <li key={i.key} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
              {i.preview && <img src={i.preview} alt="" className="size-full object-cover" />}
              {i.status === 'failed' && i.tries >= MAX_TRIES ? (
                <button
                  type="button"
                  onClick={() => patch(i.key, { status: 'uploading', tries: 0 })}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-sm font-semibold text-white"
                >
                  <RotateCw className="size-6" aria-hidden />
                  Tap to retry
                </button>
              ) : (
                <Badge state={i.status} />
              )}
            </li>
          ))}
        </ul>
      )}

      {sent > 0 && (
        <button
          type="button"
          onClick={finish}
          disabled={finishing || pending > 0 || done}
          className="min-h-16 w-full rounded-2xl border-2 border-primary text-xl font-semibold text-primary disabled:opacity-50"
        >
          {done ? 'Done. Thanks!' : pending > 0 ? 'Uploading…' : "I'm done"}
        </button>
      )}
    </Shell>
  )
}

function Badge({ state }: { state: Status }) {
  const base = 'absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full shadow'
  if (state === 'done')
    return (
      <span className={`${base} bg-green-600 text-white`} aria-label="Uploaded">
        <Check className="size-4" />
      </span>
    )
  if (state === 'failed')
    return (
      <span className={`${base} bg-amber-500 text-white`} aria-label="Trying again">
        <CircleAlert className="size-4" />
      </span>
    )
  return (
    <span className={`${base} bg-white/90 text-foreground`} aria-label="Uploading">
      <Loader2 className="size-4 animate-spin" />
    </span>
  )
}

export function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-5 bg-background px-4 pt-6 pb-10">
      <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Turner’s Decks</p>
      <h1 className="text-2xl leading-tight font-bold">{title}</h1>
      {children}
    </main>
  )
}

export function ExpiredLink() {
  return (
    <Shell title="This photo link has expired">
      <p className="text-lg text-muted-foreground">It is more than 14 days old or was turned off. Ask Kristin for a new one.</p>
    </Shell>
  )
}
