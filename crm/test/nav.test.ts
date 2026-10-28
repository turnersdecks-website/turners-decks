import { describe, expect, it } from 'vitest'
import { headerTrail, isFullBleed, isNavItemActive, visibleNavGroups } from '#/lib/nav'

const titles = (role: string) => visibleNavGroups(role).flatMap((g) => g.items.map((i) => i.title))

describe('sidebar navigation', () => {
  it('shows Staff the Pipeline and All Leads, without admin-only items', () => {
    expect(visibleNavGroups('staff').map((g) => g.title)).toEqual(['Leads'])
    expect(titles('staff')).toEqual(['Pipeline', 'All Leads'])
  })

  it('shows an admin Company settings and Submissions as well', () => {
    const company = visibleNavGroups('admin').find((g) => g.title === 'Company')!
    expect(company.items.map((i) => i.title)).toEqual(['Company settings', 'Submissions'])
  })

  it('has none of the screens that are not in v1', () => {
    for (const title of ['Home', 'Follow-ups', 'Messages', 'Appointments', 'Calls', 'Team', 'Statistics', 'Jobs', 'Mail queue']) {
      expect(titles('admin')).not.toContain(title)
    }
  })

  it('links every item to its planned path', () => {
    const urls = visibleNavGroups('admin').flatMap((g) => g.items.map((i) => i.url))
    expect(urls).toEqual(['/crm', '/leads', '/settings', '/submissions'])
  })

  it('marks an item active on its path and sub-paths, and Pipeline (not All Leads) on a Lead page', () => {
    expect(isNavItemActive('/submissions', '/submissions')).toBe(true)
    expect(isNavItemActive('/submissionsx', '/submissions')).toBe(false)
    expect(isNavItemActive('/leads/abc', '/crm')).toBe(true)
    expect(isNavItemActive('/leads/abc', '/leads')).toBe(false)
    expect(isNavItemActive('/leads', '/leads')).toBe(true)
    expect(isNavItemActive('/settings', '/crm')).toBe(false)
  })
})

describe('header title and breadcrumbs', () => {
  it('titles a sidebar screen with its item', () => {
    expect(headerTrail('/crm', 'staff')).toEqual({ title: 'Pipeline' })
    expect(headerTrail('/leads', 'staff')).toEqual({ title: 'All Leads' })
    expect(headerTrail('/submissions', 'admin')).toEqual({ title: 'Submissions' })
    expect(headerTrail('/crm/', 'staff')).toEqual({ title: 'Pipeline' })
  })

  it('puts a Lead page under the Pipeline', () => {
    expect(headerTrail('/leads/abc', 'staff')).toEqual({ title: 'Lead', parent: { title: 'Pipeline', url: '/crm' } })
  })

  it('titles /settings Your profile for Staff and Company settings for an admin', () => {
    expect(headerTrail('/settings', 'staff')).toEqual({ title: 'Your profile' })
    expect(headerTrail('/settings', 'admin')).toEqual({ title: 'Company settings' })
  })

  it('falls back to the company name', () => {
    expect(headerTrail('/nowhere', 'staff')).toEqual({ title: 'Turner’s Decks' })
  })
})

describe('full-bleed screens', () => {
  it('is the Pipeline', () => {
    expect(isFullBleed('/crm')).toBe(true)
    expect(isFullBleed('/crm/')).toBe(true)
  })

  it('are not other screens, Lead pages included', () => {
    expect(isFullBleed('/leads/abc')).toBe(false)
    expect(isFullBleed('/leads')).toBe(false)
    expect(isFullBleed('/crmx')).toBe(false)
  })
})
