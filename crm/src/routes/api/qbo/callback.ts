import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleQboCallback } from '#/lib/qbo-routes.server'

// Private route (admin session): Intuit sends the admin back here after they approve the connection.
export const Route = createFileRoute('/api/qbo/callback')({
  server: { handlers: { GET: ({ request }) => handleQboCallback(request, env) } },
})
