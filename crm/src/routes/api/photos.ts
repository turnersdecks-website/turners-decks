import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleStaffPhotoUpload } from '#/lib/photos.server'

// Private route, POST only (PLAN.md > Route policy): Staff add a photo or AI mock to a Lead or Job from the CRM,
// `?lead=<id>` or `?job=<id>` and `&stage=<stage>`. Staff session and same origin required.
export const Route = createFileRoute('/api/photos')({
  server: {
    handlers: {
      POST: ({ request }) => handleStaffPhotoUpload(request, env),
    },
  },
})
