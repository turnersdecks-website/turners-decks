import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { type BoardView, type ViewPage, defaultViewFor, isPhoneUserAgent, parseView } from '#/lib/view-pref'

/** The view a page opens in when the URL does not say: the saved choice, else by device (view-pref.ts). */
export const readDefaultView = createIsomorphicFn()
  .server((page: ViewPage): BoardView => parseView(getRequestHeader('cookie'), page) ?? defaultViewFor(isPhoneUserAgent(getRequestHeader('user-agent'))))
  .client((page: ViewPage): BoardView => parseView(document.cookie, page) ?? defaultViewFor(window.matchMedia('(max-width: 767px)').matches))
