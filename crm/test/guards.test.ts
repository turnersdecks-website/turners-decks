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

describe('every server function enforces requireStaff', () => {
  it('finds every createServerFn in src/ (none unexported)', () => {
    const declared = Object.values(sources).reduce((n, src) => n + (src.match(/createServerFn\(/g)?.length ?? 0), 0)
    expect(declared).toBeGreaterThan(0)
    expect(serverFns.map((f) => f.name)).toHaveLength(declared)
  })

  it.each(serverFns.map((f) => [f.name, f.fn] as const))('%s rejects a caller with no session', async (_name, fn) => {
    const res = await callServerFn(fn)

    expect(res.status).toBe(401)
  })
})
