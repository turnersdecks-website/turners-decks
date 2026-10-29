import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleStaffPhoto } from '#/lib/photos.server'

// Private route, GET only (PLAN.md > Route policy): a photo (`?size=thumb` for its thumbnail), for signed-in Staff.
export const Route = createFileRoute('/api/photos/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleStaffPhoto(request, env, params.id),
    },
  },
})
