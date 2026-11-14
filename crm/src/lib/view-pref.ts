// Board or list for Leads and Jobs (one page each, two views). The choice is remembered per browser in a cookie, read
// on the server for the first render and from document.cookie on the client (as sidebar-state.ts), so the page never
// flashes the wrong view. With no saved choice, phones get the list (a board is 8 columns of sideways scrolling) and
// larger screens the board.

export type BoardView = 'board' | 'list'
export type ViewPage = 'leads' | 'jobs'

export const viewCookie = (page: ViewPage) => `${page}_view`

/** The saved view in a Cookie header, or null. */
export function parseView(cookieHeader: string | null | undefined, page: ViewPage): BoardView | null {
  for (const pair of (cookieHeader ?? '').split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1 || pair.slice(0, eq).trim() !== viewCookie(page)) continue
    const v = pair.slice(eq + 1).trim()
    return v === 'board' || v === 'list' ? v : null
  }
  return null
}

/** No saved choice: the list on phones (by User-Agent on the server, by width in the browser), else the board. */
export const defaultViewFor = (isPhone: boolean): BoardView => (isPhone ? 'list' : 'board')
export const isPhoneUserAgent = (ua: string | null | undefined) => /Mobi|iPhone|Android.*Mobile/i.test(ua ?? '')

/** Saves the choice for a year. */
export function saveView(page: ViewPage, view: BoardView) {
  document.cookie = `${viewCookie(page)}=${view}; path=/; max-age=31536000; samesite=lax`
}

export function parseBoardView(v: unknown): BoardView | undefined {
  return v === 'board' || v === 'list' ? v : undefined
}
