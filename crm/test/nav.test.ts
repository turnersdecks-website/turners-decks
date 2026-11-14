import { describe, expect, it } from 'vitest'
import { headerTrail, isFullBleed, isNavItemActive, visibleNavGroups } from '#/lib/nav'

const titles = (role: string) => visibleNavGroups(role).flatMap((g) => g.items.map((i) => i.title))

describe('sidebar navigation', () => {
  it('shows Staff Contacts, Leads, Jobs and Estimator settings, without admin-only items', () => {
    expect(visibleNavGroups('staff').map((g) => g.title)).toEqual(['CRM', 'Company'])
    expect(titles('staff')).toEqual(['Contacts', 'Leads', 'Jobs', 'Estimator settings'])
  })

  it('shows an admin Company settings and Submissions as well', () => {
    const company = visibleNavGroups('admin').find((g) => g.title === 'Company')!
    expect(company.items.map((i) => i.title)).toEqual(['Company settings', 'Estimator settings', 'Submissions'])
  })

  it('has none of the screens that are not in v1', () => {
    for (const title of ['Home', 'Follow-ups', 'Messages', 'Appointments', 'Calls', 'Team', 'Statistics', 'Mail queue']) {
      expect(titles('admin')).not.toContain(title)
    }
  })

  it('links every item to its planned path', () => {
    const urls = visibleNavGroups('admin').flatMap((g) => g.items.map((i) => i.url))
    expect(urls).toEqual(['/contacts', '/leads', '/jobs', '/settings', '/settings/estimator', '/submissions'])
  })

  it('marks an item active on its path and sub-paths: Leads on a Lead page, Contacts on a Customer page', () => {
    expect(isNavItemActive('/submissions', '/submissions')).toBe(true)
    expect(isNavItemActive('/submissionsx', '/submissions')).toBe(false)
    expect(isNavItemActive('/leads/abc', '/leads')).toBe(true)
    expect(isNavItemActive('/leads', '/leads')).toBe(true)
    expect(isNavItemActive('/customers/abc', '/contacts')).toBe(true)
    expect(isNavItemActive('/jobs/abc', '/jobs')).toBe(true)
    expect(isNavItemActive('/settings', '/leads')).toBe(false)
  })

  it('marks only Estimator settings active on /settings/estimator', () => {
    expect(isNavItemActive('/settings/estimator', '/settings/estimator')).toBe(true)
    expect(isNavItemActive('/settings/estimator', '/settings')).toBe(false)
    expect(isNavItemActive('/settings', '/settings')).toBe(true)
  })
})

describe('header title and breadcrumbs', () => {
  it('titles a sidebar screen with its item', () => {
    expect(headerTrail('/leads', 'staff')).toEqual({ title: 'Leads' })
    expect(headerTrail('/contacts', 'staff')).toEqual({ title: 'Contacts' })
    expect(headerTrail('/submissions', 'admin')).toEqual({ title: 'Submissions' })
    expect(headerTrail('/settings/estimator', 'staff')).toEqual({ title: 'Estimator settings' })
    expect(headerTrail('/leads/', 'staff')).toEqual({ title: 'Leads' })
  })

  it('puts a Lead page under Leads', () => {
    expect(headerTrail('/leads/abc', 'staff')).toEqual({ title: 'Lead', parent: { title: 'Leads', url: '/leads' } })
  })

  it('puts a Customer page under Contacts and a Job page under Jobs', () => {
    expect(headerTrail('/customers/abc', 'staff')).toEqual({ title: 'Customer', parent: { title: 'Contacts', url: '/contacts' } })
    expect(headerTrail('/jobs/abc', 'staff')).toEqual({ title: 'Job', parent: { title: 'Jobs', url: '/jobs' } })
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
  it('are Leads and Jobs (board and list)', () => {
    expect(isFullBleed('/leads')).toBe(true)
    expect(isFullBleed('/leads/')).toBe(true)
    expect(isFullBleed('/jobs')).toBe(true)
  })

  it('are not other screens, Lead pages included', () => {
    expect(isFullBleed('/leads/abc')).toBe(false)
    expect(isFullBleed('/contacts')).toBe(false)
    expect(isFullBleed('/leadsx')).toBe(false)
  })
})
