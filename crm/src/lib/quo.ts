// Quo (formerly OpenPhone) REST API and webhook signatures (docs/adr/0004-quo-texting.md).
// API: https://www.quo.com/docs, version 2026-03-30 (sent on every call; webhooks made with it are pinned to it).
// Webhook signatures follow Standard Webhooks: HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${raw body}`,
// keyed with the base64 part of the `whsec_` secret, sent as space-separated `v1,<base64>` entries.

export const QUO_API = 'https://api.quo.com'
export const QUO_API_VERSION = '2026-03-30'
/** What the CRM subscribes to: texts in and out, and how calls ended (voicemails carry a transcript). */
export const QUO_WEBHOOK_EVENTS = ['message.received', 'message.delivered', 'call.completed', 'call.voicemail.completed'] as const
/** Standard Webhooks' default tolerance for the timestamp, against replays. */
export const SIGNATURE_TOLERANCE_S = 5 * 60
const TIMEOUT_MS = 10_000

export type QuoDeps = { fetch?: typeof globalThis.fetch }

type QuoError = { message?: string; title?: string }

async function call<T>(apiKey: string, method: string, path: string, body: unknown, deps: QuoDeps): Promise<T> {
  const res = await (deps.fetch ?? globalThis.fetch)(`${QUO_API}${path}`, {
    method,
    headers: { authorization: apiKey, 'quo-api-version': QUO_API_VERSION, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = await res.json<{ data?: T } & QuoError>().catch(() => ({}) as { data?: T } & QuoError)
  if (!res.ok) throw new QuoApiError(res.status, json.message ?? json.title ?? `Quo answered ${res.status}`)
  return json.data as T
}

export class QuoApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'QuoApiError'
  }
}

export type QuoPhoneNumber = { id: string; number: string; name?: string | null }

/** The workspace's Quo numbers (`PN...` ids with their E.164 numbers). */
export function listPhoneNumbers(apiKey: string, deps: QuoDeps = {}) {
  return call<QuoPhoneNumber[]>(apiKey, 'GET', '/phone-numbers', undefined, deps)
}

/** Makes the CRM's webhook for one Quo number. Quo returns the signing secret (`key`) only here. */
export function createWebhook(apiKey: string, input: { url: string; phoneNumberId: string; label: string }, deps: QuoDeps = {}) {
  return call<{ id: string; key: string }>(
    apiKey,
    'POST',
    '/webhooks',
    { url: input.url, events: QUO_WEBHOOK_EVENTS, resourceIds: [input.phoneNumberId], label: input.label },
    deps,
  )
}

/** Removes an earlier CRM webhook (reconnecting). A webhook that is already gone is fine. */
export async function deleteWebhook(apiKey: string, webhookId: string, deps: QuoDeps = {}) {
  try {
    await call(apiKey, 'DELETE', `/webhooks/${encodeURIComponent(webhookId)}`, undefined, deps)
  } catch (err) {
    if (!(err instanceof QuoApiError && err.status === 404)) throw err
  }
}

/**
 * Send outcome. Quo's send has no idempotency key, so a request that may have reached Quo is never repeated:
 * `definite` is true only when Quo refused it (nothing was sent), and `retry` only for 429 (rate limited, not sent).
 */
export type SmsSendResult =
  | { ok: true; id: string | null }
  | { ok: false; definite: boolean; retry: boolean; error: string; status: number | null }

export async function sendSms(apiKey: string, input: { from: string; to: string; content: string }, deps: QuoDeps = {}): Promise<SmsSendResult> {
  try {
    const id = (await call<{ id?: string }>(apiKey, 'POST', '/messages', { from: input.from, to: [input.to], content: input.content }, deps))?.id ?? null
    return { ok: true, id }
  } catch (err) {
    if (err instanceof QuoApiError) {
      const definite = err.status >= 400 && err.status < 500 && err.status !== 408
      return { ok: false, definite, retry: err.status === 429, error: `quo ${err.status}: ${err.message}`, status: err.status }
    }
    // Timeout or connection error: Quo may have taken it.
    return { ok: false, definite: false, retry: false, error: String(err), status: null }
  }
}

/** Checks a delivery's Standard Webhooks signature. `now` in ms. */
export async function verifyQuoSignature(secret: string, headers: Headers, rawBody: string, now = Date.now()): Promise<boolean> {
  const id = headers.get('webhook-id')
  const ts = headers.get('webhook-timestamp')
  const sigs = headers.get('webhook-signature')
  if (!id || !ts || !sigs || !/^\d{1,12}$/.test(ts)) return false
  if (Math.abs(now / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_S) return false
  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  } catch {
    return false
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)))
  for (const entry of sigs.split(' ')) {
    const [version, value] = entry.split(',', 2)
    if (version !== 'v1' || !value) continue
    let given: Uint8Array
    try {
      given = base64ToBytes(value)
    } catch {
      continue
    }
    if (sameBytes(given, mac)) return true
  }
  return false
}

/** Builds a signature header the way Quo does (tests, and the "Send a test" check). */
export async function signQuoDelivery(secret: string, id: string, ts: number, rawBody: string) {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)))
  return `v1,${bytesToBase64(mac)}`
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Constant-time compare (no early exit on the first differing byte). */
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

/** Carrier opt-out and opt-in keywords (CTIA): a text that is only one of these word changes text consent. */
export const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout', 'opt out']
export const START_WORDS = ['start', 'unstop']
export const keywordOf = (text: string | null | undefined) => (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
