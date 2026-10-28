import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleUpload } from '#/lib/lead-files.server'

// Private route, POST only (PLAN.md > Route policy, plan 009 decision 12): upload a Quote file,
// `?lead=<id>&kind=<kind>` with the file's bytes as the body. Staff session and same origin required.
export const Route = createFileRoute('/api/lead-files')({
  server: {
    handlers: {
      POST: ({ request }) => handleUpload(request, env),
    },
  },
})
