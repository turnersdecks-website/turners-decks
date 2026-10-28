import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BASE, signedInStaff } from './staff'

// Every Staff member reaches Your profile (/settings) from the sidebar header (name/avatar); the "Company settings"
// menu item stays admin-only.

const page = async (path: string, cookie: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.text()
}

describe('sidebar user header', () => {
  it.each(['staff', 'admin'] as const)('links to /settings for a %s', async (role) => {
    const { cookie } = await signedInStaff(role, { name: 'Pat Header' })

    const html = await page('/crm', cookie)

    expect(html).toMatch(/<a(?=[^>]*href="\/settings")(?=[^>]*aria-label="Your profile")[^>]*>/)
  })

  it('a staff-role member does not see the Company settings item', async () => {
    const { cookie } = await signedInStaff('staff')

    expect(await page('/crm', cookie)).not.toContain('Company settings')
  })
})

describe('sidebar open state', () => {
  it('renders collapsed on the server when the sidebar_state cookie says false, open otherwise', async () => {
    const { cookie } = await signedInStaff('staff')

    expect(await page('/crm', `${cookie}; sidebar_state=false`)).toMatch(/data-state="collapsed"/)
    const open = await page('/crm', cookie)
    expect(open).toMatch(/data-state="expanded"/)
    expect(open).not.toMatch(/data-state="collapsed"/)
  })
})
