import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { createAuth } from '#/lib/auth'
import { limitAuthRequest } from '#/lib/auth-rate-limit'
import { seedFirstAdmin } from '#/lib/seed-admin'

// Public route: Better Auth authorizes its own endpoints (PLAN.md > Route policy).
// Plan 006 S13: Better Auth's admin endpoints (/api/auth/admin/*: set role, ban, remove, impersonate, create, ...)
// are not served. The app uses none of them over HTTP; Staff management goes through the CRM's own server
// functions (src/lib/team.functions.ts), which keep the last-admin rule and revoke sessions atomically.
const handle = async ({ request }: { request: Request }) => {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/auth/admin/')) return new Response('Not found', { status: 404 })
  const refused = await limitAuthRequest(env, request)
  if (refused) return refused
  // One indexed lookup per sign-in; a no-op once any admin exists or the seed secrets are empty.
  if (path.endsWith('/sign-in/email')) await seedFirstAdmin(env)
  return createAuth(env).handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handle, POST: handle } },
})
