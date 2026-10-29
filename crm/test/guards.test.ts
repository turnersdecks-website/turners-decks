import { describe, expect, it } from 'vitest'
import { callServerFn } from './staff'

type ServerFn = { url: string; method?: string; serverFnMeta: { id: string } }

// Every module under src/, imported the way the Worker imports it.
const modules = import.meta.glob<Record<string, unknown>>(['/src/**/*.{ts,tsx}', '!/src/**/*.gen.ts'], {
  eager: true,
})
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.gen.ts'], {
  eager: true,
  query: '?raw',
  import: 'default',
})

function isServerFn(value: unknown): value is ServerFn {
  return typeof value === 'function' && typeof (value as Partial<ServerFn>).url === 'string' && 'serverFnMeta' in value
}

const serverFns = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(([, value]) => isServerFn(value))
    .map(([name, fn]) => ({ name: `${file}#${name}`, fn: fn as ServerFn })),
)

// Behind Pat's photo pages: they need a working link or home screen token instead, and return null without one.
const PUBLIC_SERVER_FNS = ['/src/lib/photos.functions.ts#getPhotoRequest', '/src/lib/photos.functions.ts#getPhotoHome']

describe('every server function enforces requireStaff', () => {
  it('finds every createServerFn in src/ (none unexported)', () => {
    const declared = Object.values(sources).reduce((n, src) => n + (src.match(/createServerFn\(/g)?.length ?? 0), 0)
    expect(declared).toBeGreaterThan(0)
    expect(serverFns.map((f) => f.name)).toHaveLength(declared)
  })

  it.each(serverFns.filter((f) => !PUBLIC_SERVER_FNS.includes(f.name)).map((f) => [f.name, f.fn] as const))('%s rejects a caller with no session', async (_name, fn) => {
    const res = await callServerFn(fn)

    expect(res.status).toBe(401)
  })
})

describe('the public photo server functions', () => {
  it.each(PUBLIC_SERVER_FNS)('%s exists and gives nothing away without a working token', async (name) => {
    const found = serverFns.find((f) => f.name === name)
    expect(found).toBeDefined()
    const res = await callServerFn(found!.fn, undefined, { t: 'not-a-real-token-but-long-enough', d: 'not-a-real-token-but-long-enough', l: 'x' })
    expect(res.status).toBe(200)
    expect(await res.text()).not.toMatch(/lead|job|customer/i)
  })
})
