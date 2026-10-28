import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getRouter } from '#/router'
import { type AnyRoute, leafRoutes, serverHandlersOf } from './route-enumeration'
import { BASE } from './staff'

// PLAN.md > Architecture > Route policy. Everything not listed here is private.
const PUBLIC_PAGES = ['/sign-in', '/forgot-password', '/reset-password']
const PUBLIC_SERVER_ROUTES: Record<string, string[] | '*'> = {
  '/api/auth/$': '*', // Better Auth authorizes its own endpoints
  '/api/public/intake': ['POST', 'OPTIONS'],
}

const routes = Object.values(getRouter().routesById) as AnyRoute[]
const url = (path: string) => `${BASE}${path.replace('$', 'anything')}`

const pages = leafRoutes(routes).filter((r) => r.options.component)
const serverHandlers = serverHandlersOf(routes)
const isPublicHandler = (path: string, method: string) => {
  const allowed = PUBLIC_SERVER_ROUTES[path]
  return allowed === '*' || (allowed?.includes(method) ?? false)
}

describe('route policy', () => {
  it('finds the app routes', () => {
    expect(pages.map((r) => r.fullPath)).toEqual(expect.arrayContaining(['/leads', ...PUBLIC_PAGES]))
    expect(serverHandlers).toContainEqual({ path: '/api/public/intake', method: 'POST' })
  })

  it('every listed public server route exists with exactly the listed methods (no stale or wider entry)', () => {
    for (const [path, methods] of Object.entries(PUBLIC_SERVER_ROUTES)) {
      if (methods === '*') continue
      expect(serverHandlers.filter((h) => h.path === path).map((h) => h.method).sort(), path).toEqual([...methods].sort())
    }
  })

  it.each(pages.filter((r) => !PUBLIC_PAGES.includes(r.fullPath)).map((r) => r.fullPath))(
    'private page %s sends a caller with no session to /sign-in',
    async (path) => {
      const res = await SELF.fetch(url(path), { redirect: 'manual' })

      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(res.status).toBeLessThan(400)
      expect(new URL(res.headers.get('location')!, BASE).pathname).toBe('/sign-in')
    },
  )

  it.each(PUBLIC_PAGES)('public page %s renders with no session', async (path) => {
    const res = await SELF.fetch(url(path), { redirect: 'manual' })

    expect(res.status).toBe(200)
  })

  it.each(serverHandlers.filter((h) => !isPublicHandler(h.path, h.method)).map((h) => [h.method, h.path]))(
    'private server route %s %s rejects a caller with no session',
    async (method, path) => {
      const res = await SELF.fetch(url(path), { method, headers: { origin: BASE }, redirect: 'manual' })

      expect(res.status).toBe(401)
    },
  )
})
