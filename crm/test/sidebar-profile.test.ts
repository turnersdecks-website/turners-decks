import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BASE, signedInStaff } from './staff'

// Every Staff member reaches Your profile (/profile) from the sidebar header (name/avatar); the "Company settings"
// menu item stays admin-only.

const page = async (path: string, cookie: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.text()
}

describe('sidebar user header', () => {
  it.each(['staff', 'admin'] as const)('links to /profile for a %s', async (role) => {
    const { cookie } = await signedInStaff(role, { name: 'Pat Header' })

    const html = await page('/leads', cookie)

    expect(html).toMatch(/<a(?=[^>]*href="\/profile")(?=[^>]*aria-label="Your profile")[^>]*>/)
  })

  it('a staff-role member does not see the Settings item', async () => {
    const { cookie } = await signedInStaff('staff')

    expect(await page('/leads', cookie)).not.toMatch(/href="\/settings"/)
  })
})

describe('sidebar open state', () => {
  it('renders collapsed on the server when the sidebar_state cookie says false, open otherwise', async () => {
    const { cookie } = await signedInStaff('staff')

    expect(await page('/leads', `${cookie}; sidebar_state=false`)).toMatch(/data-state="collapsed"/)
    const open = await page('/leads', cookie)
    expect(open).toMatch(/data-state="expanded"/)
    expect(open).not.toMatch(/data-state="collapsed"/)
  })
})
