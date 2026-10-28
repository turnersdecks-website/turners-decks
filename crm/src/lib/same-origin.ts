// Cross-site check for private API routes that change data. The CSRF middleware in src/start.ts covers server
// functions only, so a server route that accepts a POST calls this itself (plan 009 decision 12): a browser that says
// the request came from another site (`Sec-Fetch-Site`) or from another origin (`Origin`) is refused.

/** True unless the request says it came from another site or origin. */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return false
  return true
}
