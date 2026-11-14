import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleQboConnect } from '#/lib/qbo-routes.server'

// Private route (admin session): starts the QuickBooks sign-in (docs/adr/0006-quickbooks-sync.md).
export const Route = createFileRoute('/api/qbo/connect')({
  server: { handlers: { GET: ({ request }) => handleQboConnect(request, env) } },
})
