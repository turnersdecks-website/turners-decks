import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { createAuth } from '#/lib/auth'

// PLAN.md > Route policy: every server function and loader enforces requireStaff; privileged
// ones enforce requireAdmin. Enforced server side; a thrown Response becomes the HTTP reply.

/** Rejects a caller without a Staff session (401); puts the signed-in Staff member on context. */
export const requireStaff = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const session = await createAuth(env).api.getSession({ headers: getRequest().headers })
  if (!session) throw new Response('Unauthorized', { status: 401 })
  return next({ context: { staff: session.user } })
})

/** requireStaff plus role admin (403 otherwise). For privileged server functions. */
export const requireAdmin = createMiddleware({ type: 'function' })
  .middleware([requireStaff])
  .server(({ next, context }) => {
    if (context.staff.role !== 'admin') throw new Response('Forbidden', { status: 403 })
    return next()
  })
