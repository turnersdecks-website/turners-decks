import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleQuoWebhook } from '#/lib/quo-webhook'

// Public route (PLAN.md > Route policy): Quo's webhook. The Standard Webhooks signature, checked against the secret
// Quo gave when Settings > Texting connected it, is the credential (src/lib/quo.ts).
export const Route = createFileRoute('/api/public/quo-webhook')({
  server: {
    handlers: {
      POST: ({ request }) => handleQuoWebhook(request, env),
    },
  },
})
