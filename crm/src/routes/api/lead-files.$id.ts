import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleDownload } from '#/lib/lead-files.server'

// Private route, GET only (PLAN.md > Route policy, plan 009 decision 12): open or download a Quote file by id
// (`?download=1` for an attachment). Staff session required; the bytes stream from the private R2 bucket.
export const Route = createFileRoute('/api/lead-files/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleDownload(request, env, params.id),
    },
  },
})
