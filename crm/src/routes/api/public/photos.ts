import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handlePhotoUpload } from '#/lib/photos.server'

// Public route (PLAN.md > Route policy; GLOSSARY Photo link): Pat's upload page sends one photo per POST. A working
// link token (`?t=`) or home screen token plus link id (`?d=&l=`) is the only credential; it can only add photos.
export const Route = createFileRoute('/api/public/photos')({
  server: {
    handlers: {
      POST: ({ request }) => handlePhotoUpload(request, env),
    },
  },
})
