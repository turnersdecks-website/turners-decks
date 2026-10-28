import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleIntake } from '#/lib/intake'

// Public route (PLAN.md > Route policy).
export const Route = createFileRoute('/api/public/intake')({
  server: {
    handlers: {
      POST: ({ request }) => handleIntake(request, env),
      OPTIONS: ({ request }) => handleIntake(request, env),
    },
  },
})
