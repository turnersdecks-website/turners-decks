import { describe, expect, it } from 'vitest'
import { type AnyRoute, serverHandlersOf } from './route-enumeration'

const noop = () => new Response(null)

describe('server handler enumeration', () => {
  it('includes a handler on a route that has children', () => {
    const routes: AnyRoute[] = [
      { fullPath: '/api/parent', children: [{}], options: { server: { handlers: { GET: noop } } } },
    ]

    expect(serverHandlersOf(routes)).toContainEqual({ path: '/api/parent', method: 'GET' })
  })

  it('resolves a handler factory', () => {
    const routes: AnyRoute[] = [
      {
        fullPath: '/api/factory',
        options: {
          server: {
            handlers: ({ createHandlers }: { createHandlers: <T>(d: T) => T }) =>
              createHandlers({ GET: noop, POST: { handler: noop } }),
          },
        },
      },
    ]

    expect(serverHandlersOf(routes)).toEqual([
      { path: '/api/factory', method: 'GET' },
      { path: '/api/factory', method: 'HEAD' },
      { path: '/api/factory', method: 'POST' },
    ])
  })

  it('expands ANY into every method the runtime dispatches to it, including HEAD, OPTIONS, TRACE and unlisted tokens', () => {
    const routes: AnyRoute[] = [{ fullPath: '/api/any', options: { server: { handlers: { ANY: noop } } } }]

    expect(serverHandlersOf(routes).map((h) => h.method)).toEqual([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'TRACE',
      'PROPFIND',
    ])
  })

  it('a GET handler also serves HEAD', () => {
    const routes: AnyRoute[] = [{ fullPath: '/api/get', options: { server: { handlers: { GET: noop } } } }]

    expect(serverHandlersOf(routes)).toEqual([
      { path: '/api/get', method: 'GET' },
      { path: '/api/get', method: 'HEAD' },
    ])
  })

  it('a POST-only handler is not reachable by HEAD or OPTIONS', () => {
    const routes: AnyRoute[] = [{ fullPath: '/api/post', options: { server: { handlers: { POST: noop } } } }]

    expect(serverHandlersOf(routes)).toEqual([{ path: '/api/post', method: 'POST' }])
  })

  it('specific handlers beside ANY still leave every other method on ANY', () => {
    const routes: AnyRoute[] = [
      { fullPath: '/api/mixed', options: { server: { handlers: { POST: noop, ANY: noop } } } },
    ]

    expect(serverHandlersOf(routes).map((h) => h.method)).toEqual(
      expect.arrayContaining(['GET', 'HEAD', 'POST', 'OPTIONS', 'TRACE', 'PROPFIND']),
    )
  })
})
