// The sidebar's open state, saved by SidebarProvider (components/ui/sidebar.tsx) in the `sidebar_state` cookie.
// Plan 007 decision 7: read on the server for the first render and from document.cookie on the client, so the
// sidebar never flashes; an absent or invalid value means open.

export const SIDEBAR_COOKIE_NAME = 'sidebar_state'

/** Open unless the first `sidebar_state` cookie in the header is exactly `false`. */
export function parseSidebarOpen(cookieHeader: string | null | undefined): boolean {
  for (const pair of (cookieHeader ?? '').split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1 || pair.slice(0, eq).trim() !== SIDEBAR_COOKIE_NAME) continue
    return pair.slice(eq + 1).trim() !== 'false'
  }
  return true
}
