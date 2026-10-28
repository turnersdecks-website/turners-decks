import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handlePublicEstimator } from '#/lib/public-estimator'

// Public route (PLAN.md > Route policy; FLW-201): the estimator's questions, never its prices.
export const Route = createFileRoute('/api/public/estimator')({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicEstimator(request, env),
    },
  },
})
