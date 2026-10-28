import { env } from 'cloudflare:test'
import { getDb } from '#/db/client'
import { enqueueJob } from '#/lib/outbox'

export const RESEND_URL = 'https://api.resend.com/emails'

/** The Worker env once a Resend key exists (the test env has none, like staging today). */
export const sendingEnv = { ...env, RESEND_API_KEY: 're_test_key_0001' }

export type ResendCall = { idempotencyKey: string | null; authorization: string | null; body: Record<string, any> }

/**
 * A stand-in for Resend's HTTP API. `answer` decides each response (default: accepted with a fresh email id).
 * `calls` records every request that reached it.
 */
export function mockResend(answer: (call: ResendCall, n: number) => Response | Promise<Response> = () => accepted()) {
  const calls: ResendCall[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (req.url !== RESEND_URL || req.method !== 'POST') throw new Error(`unexpected fetch ${req.method} ${req.url}`)
    const call = {
      idempotencyKey: req.headers.get('idempotency-key'),
      authorization: req.headers.get('authorization'),
      body: await req.json<Record<string, any>>(),
    }
    calls.push(call)
    return answer(call, calls.length)
  }) as typeof globalThis.fetch
  return { fetch, calls, callsFor: (jobId: string) => calls.filter((c) => c.idempotencyKey === jobId) }
}

export const accepted = (id = `email_${crypto.randomUUID()}`) => Response.json({ id }, { status: 200 })
export const resendDown = () => Response.json({ name: 'internal_server_error', message: 'Unexpected error' }, { status: 500 })

/** Enqueues a password-reset style job (the payload is the email itself) and returns its id. */
export async function enqueueTestEmail(to = `staff-${crypto.randomUUID()}@example.com`) {
  const db = getDb(env.DB)
  const job = enqueueJob(db, {
    kind: 'password_reset',
    dedupeKey: `test:${crypto.randomUUID()}`,
    payload: { to, subject: 'Reset your Good Cover CRM password', text: 'Choose a new password: https://crm.example/reset/SECRET-TOKEN' },
  })
  await job.insert
  return job.id
}

export function readJob(id: string) {
  return env.DB.prepare('SELECT * FROM notification_jobs WHERE id = ?').bind(id).first<Record<string, any>>()
}
