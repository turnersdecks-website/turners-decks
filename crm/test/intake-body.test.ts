import { env } from 'cloudflare:test'
import { afterEach, expect, it, vi } from 'vitest'
import { handleIntake } from '#/lib/intake'
import { BASE, SITE_ORIGIN, mockSiteverify } from './intake-helpers'

afterEach(() => vi.restoreAllMocks())

function endlessBody() {
  const chunk = new TextEncoder().encode('x'.repeat(1024))
  return new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) })
}

it('a body that never ends is cut off at 64 KB and refused, never read in full', async () => {
  mockSiteverify()
  const res = await handleIntake(
    new Request(`${BASE}/api/public/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_ORIGIN, 'cf-connecting-ip': '10.9.9.9' },
      body: endlessBody(),
      // @ts-expect-error -- `duplex` is required for streamed request bodies outside workerd's types
      duplex: 'half',
    }),
    env,
  )

  expect(res.status).toBe(413)
}, 5000)

it('a declared Content-Length over 64 KB is refused without reading the body', async () => {
  mockSiteverify()
  let pulled = 0
  const body = new ReadableStream<Uint8Array>({
    pull: (c) => {
      pulled++
      c.enqueue(new Uint8Array(1024))
    },
  })
  const res = await handleIntake(
    new Request(`${BASE}/api/public/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_ORIGIN, 'content-length': String(70 * 1024) },
      body,
      // @ts-expect-error -- see above
      duplex: 'half',
    }),
    env,
  )

  expect(res.status).toBe(413)
  expect(pulled).toBeLessThanOrEqual(1)
})
