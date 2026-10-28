import { readLatestVersion } from '#/lib/estimator/settings.server'
import { toPublic } from '#/lib/estimator/public'

// `GET /api/public/estimator` (FLW-201, ADR 0003): the latest Published version's questions, options, defaults,
// step layout and copy, for the site's estimator. No prices and no site-review flags. A simple CORS GET (no
// preflight); cached for a minute, which is safe because intake prices against the version the browser sends.

type PublicEstimatorEnv = { DB: D1Database; INTAKE_ALLOWED_ORIGINS?: string }

export const PUBLIC_ESTIMATOR_MAX_AGE = 60

export async function handlePublicEstimator(request: Request, env: PublicEstimatorEnv): Promise<Response> {
  const origin = request.headers.get('origin')
  const allowed = (env.INTAKE_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())
  if (origin !== null && !allowed.includes(origin)) {
    return Response.json({ ok: false, error: 'origin_not_allowed' }, { status: 403, headers: { vary: 'Origin' } })
  }
  const live = await readLatestVersion(env.DB)
  return Response.json(toPublic(live.document, live.version), {
    headers: {
      ...(origin ? { 'access-control-allow-origin': origin } : {}),
      vary: 'Origin',
      'cache-control': `public, max-age=${PUBLIC_ESTIMATOR_MAX_AGE}`,
    },
  })
}
