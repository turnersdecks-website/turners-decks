import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handlePhotoDone } from '#/lib/photos.server'

// Public route (GLOSSARY Photo link): Pat tapped "I'm done" on his upload page.
export const Route = createFileRoute('/api/public/photos/done')({
  server: {
    handlers: {
      POST: ({ request }) => handlePhotoDone(request, env),
    },
  },
})
