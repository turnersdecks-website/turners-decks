export type AnyRoute = {
  fullPath: string
  children?: unknown
  options: { component?: unknown; server?: { handlers?: unknown } }
}

// Methods to probe. `ANY` catches every method token the runtime receives, so the list ends with a
// token that no handler names (`PROPFIND`) to stand for all the others. workerd accepts TRACE;
// CONNECT and TRACK throw "Invalid HTTP method string" in workerd's Request, so they cannot arrive.
const PROBE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'PROPFIND']

// Mirrors handleServerRoutes in @tanstack/start-server-core (createStartHandler.js): HEAD falls back
// to GET then ANY; every other method falls back to ANY.
const dispatches = (handlers: Record<string, unknown>, method: string) =>
  method === 'HEAD'
    ? (handlers.HEAD ?? handlers.GET ?? handlers.ANY) !== undefined
    : (handlers[method] ?? handlers.ANY) !== undefined

// Pages are leaf routes; layout routes with children are not URLs of their own.
export const leafRoutes = (routes: AnyRoute[]) => routes.filter((r) => !r.children)

// Every (path, method) the runtime would hand to a server handler, on every registered route
// (parents included). Handler factories are resolved the same way TanStack Start does at request
// time (`createHandlers: (d) => d`).
export const serverHandlersOf = (routes: AnyRoute[]) =>
  routes.flatMap((r) => {
    const declared = r.options.server?.handlers
    const handlers = (
      typeof declared === 'function' ? declared({ createHandlers: <T>(d: T) => d }) : (declared ?? {})
    ) as Record<string, unknown>
    const methods = [...PROBE_METHODS, ...Object.keys(handlers).filter((m) => m !== 'ANY')]
    return [...new Set(methods)]
      .filter((method) => dispatches(handlers, method))
      .map((method) => ({ path: r.fullPath, method }))
  })
