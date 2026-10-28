import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { listLeads } from '#/lib/leads.functions'
import { BASE, callServerFn, signedInStaff } from './staff'

const fromOtherSite = (cookie: string, headers: Record<string, string>) =>
  SELF.fetch(`${BASE}/_serverFn/${listLeads.serverFnMeta.id}`, {
    headers: { 'x-tsr-serverfn': 'true', cookie, ...headers },
  })

it('a same-origin server function call from a signed-in Staff member succeeds', async () => {
  const { cookie } = await signedInStaff()

  expect((await callServerFn(listLeads, cookie)).status).toBe(200)
})

it.each([
  ['Sec-Fetch-Site', { 'sec-fetch-site': 'cross-site' }],
  ['Origin', { origin: 'https://evil.example' }],
])('a cross-site server function call is refused even with a Staff cookie (%s)', async (_by, headers) => {
  const { cookie } = await signedInStaff()

  expect((await fromOtherSite(cookie, headers)).status).toBe(403)
})
