import { Download, ExternalLink, Paperclip, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { Button } from '#/components/ui/button'
import type { LeadFileKind } from '#/db/schema'
import { formatDay } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { LEAD_FILE_LABELS, LEAD_FILE_MAX_BYTES, LEAD_FILE_SLOTS } from '#/lib/lead-files'
import { type LeadFile, removeLeadFile } from '#/lib/lead-files.functions'
import { cn } from '#/lib/utils'

// The Lead page's Quote tab (plan 009 T3): five Quote file slots, one current file each (GLOSSARY: Quote file). Lovable
// has no file uploads; the tab and its slots are an owner-approved deviation. Each slot follows the kit's
// PaymentAttachmentUploader (ecommerce/order-detail-2): a dashed box with a Paperclip tile when empty, a bordered file
// row (Paperclip tile, name, size) when filled. Uploads go to POST /api/lead-files as the raw bytes (XMLHttpRequest, for
// progress); the server checks type and size again and is the one that counts. Nothing here changes the stage.

const HINTS: Partial<Record<LeadFileKind, string>> = {
  materials_list: 'One file. Several pages? Put them in one PDF.',
  customer_quote: 'Upload the quote PDF you send the Homeowner.',
  contractor_agreement: 'Our agreement with the crew for this deck. Internal only, never sent to the Homeowner.',
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic'
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'heic'])
const TOO_BIG = 'Files can be up to 25 MB.'
const BAD_TYPE = 'Upload a PDF, JPG, PNG or HEIC.'
const MAY_NOT_HAVE_SAVED = 'The upload may not have saved. Reload to check.'

/** Kit order-detail-2 `formatAttachmentSize`. */
function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

/** A quick message for a file the server would refuse anyway, or null. */
function clientCheck(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXTENSIONS.has(ext)) return BAD_TYPE
  if (file.size > LEAD_FILE_MAX_BYTES) return TOO_BIG
  if (file.size === 0) return 'The file is empty.'
  return null
}

type UploadResult = { ok: true } | { ok: false; message: string; refresh: boolean }

/** POSTs the file's bytes. 409 and 500 (and a lost connection) may mean the slot changed, so the page refreshes. */
function sendFile(leadId: string, kind: LeadFileKind, file: File, replaceId: string | undefined, onProgress: (percent: number) => void) {
  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/lead-files?lead=${encodeURIComponent(leadId)}&kind=${kind}`)
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    if (replaceId) xhr.setRequestHeader('x-replace', replaceId)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.floor((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 201) return resolve({ ok: true })
      const text = xhr.responseText.trim()
      if (xhr.status === 401) return resolve({ ok: false, message: 'You are signed out. Sign in again, then upload.', refresh: false })
      // 500: the batch may have committed (the server says so); any other 500 body is not for Staff.
      if (xhr.status === 500) return resolve({ ok: false, message: MAY_NOT_HAVE_SAVED, refresh: true })
      if (xhr.status === 409) return resolve({ ok: false, message: text || 'Someone else just changed this file. Reload.', refresh: true })
      // 400 cut off, 413 too big, 415 wrong type, 404 Lead gone, 503 storage failed: the server's own words.
      resolve({ ok: false, message: text && (xhr.status < 500 || xhr.status === 503) ? text : 'Upload failed. Try again.', refresh: false })
    }
    // The request may have reached the server before the connection dropped.
    xhr.onerror = () => resolve({ ok: false, message: MAY_NOT_HAVE_SAVED, refresh: true })
    xhr.send(file)
  })
}

export function QuoteFiles({ leadId, files, timeZone, onChange }: { leadId: string; files: Record<LeadFileKind, LeadFile | null>; timeZone: string; onChange: () => Promise<unknown> }) {
  return (
    <section aria-label="Quote files" className="overflow-hidden rounded-xl border bg-card text-sm text-card-foreground shadow-xs">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Paperclip className="size-4" aria-hidden />
        </span>
        <h2 className="font-semibold">Quote files</h2>
      </div>
      <ul className="divide-y">
        {LEAD_FILE_SLOTS.map((kind) => (
          <QuoteFileSlot key={kind} leadId={leadId} kind={kind} file={files[kind]} timeZone={timeZone} onChange={onChange} />
        ))}
      </ul>
    </section>
  )
}

function QuoteFileSlot({ leadId, kind, file, timeZone, onChange }: { leadId: string; kind: LeadFileKind; file: LeadFile | null; timeZone: string; onChange: () => Promise<unknown> }) {
  const label = LEAD_FILE_LABELS[kind]
  const hint = HINTS[kind]
  const inputRef = useRef<HTMLInputElement | null>(null)
  const inputId = `quote-file-${kind}`
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    const replaceId = file?.id
    const refused = clientCheck(picked)
    setError(refused)
    if (refused) return
    setBusy(true)
    setProgress(0)
    try {
      const result = await sendFile(leadId, kind, picked, replaceId, setProgress)
      setProgress(null)
      if (result.ok) {
        toast.success(`${label} ${replaceId ? 'replaced' : 'uploaded'}`)
        await onChange()
      } else {
        setError(result.message)
        if (result.refresh) await onChange()
      }
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function remove() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      try {
        await removeLeadFile({ data: { fileId: file.id } })
        toast.success(`${label} removed`)
      } catch (e) {
        // 404: already replaced or removed; the refresh shows what is current.
        setError(await errorMessage(e))
      }
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  const pickButton = (text: string, Icon: typeof Upload) => (
    <Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`${text} ${label}`} onClick={() => inputRef.current?.click()}>
      <Icon />
      {text}
    </Button>
  )
  const href = file ? `/api/lead-files/${file.id}` : ''
  const heic = file?.contentType === 'image/heic'

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5" data-quote-slot={kind}>
      <div className="space-y-0.5">
        <h3 className="font-medium">{label}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {/* A real button opens the picker (a <label> as in the kit cannot be focused or disabled). */}
      <input ref={inputRef} id={inputId} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />

      {file ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium" title={file.fileName}>
                {file.fileName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatAttachmentSize(file.sizeBytes)} · {file.uploadedByName ? `Uploaded by ${file.uploadedByName}` : 'Uploaded'} · {formatDay(file.uploadedAt, timeZone)}
              </p>
              {heic && <p className="text-xs text-muted-foreground">HEIC opens on iPhone and Mac</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {!heic && (
              <Button asChild size="sm" variant="outline">
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>
                  <ExternalLink />
                  Open
                </a>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <a href={`${href}?download=1`} download aria-label={`Download ${label}`}>
                <Download />
                Download
              </a>
            </Button>
            {pickButton('Replace', RefreshCw)}
            <ConfirmDialog
              trigger={
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} aria-label={`Remove ${label}`}>
                  <Trash2 />
                  Remove
                </Button>
              }
              title="Remove this file?"
              description="Staff can't open it from here afterwards, but it isn't deleted."
              confirmLabel="Remove"
              destructive
              pending={busy}
              onConfirm={remove}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="font-medium">No file yet.</p>
              <p className="text-xs text-muted-foreground">PDF, JPG, PNG or HEIC, up to 25 MB.</p>
            </div>
          </div>
          <div className="sm:shrink-0">{pickButton('Upload', Upload)}</div>
        </div>
      )}

      <p aria-live="polite" className={cn('text-xs empty:hidden', progress === null ? 'text-destructive' : 'text-muted-foreground')}>
        {progress !== null ? `Uploading… ${progress}%` : error}
      </p>
    </li>
  )
}
