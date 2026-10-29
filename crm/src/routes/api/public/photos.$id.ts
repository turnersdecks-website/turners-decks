import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handlePublicPhoto } from '#/lib/photos.server'

// Public route (GLOSSARY Photo link): a thumbnail on Pat's upload page, only of a photo sent through that same link.
export const Route = createFileRoute('/api/public/photos/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePublicPhoto(request, env, params.id),
    },
  },
})
