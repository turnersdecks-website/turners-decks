import { BarChart3, Building2, Calculator, Hammer, Inbox, KanbanSquare, Users, type LucideIcon } from 'lucide-react'

// Sidebar groups ported from the Good Cover CRM (itself from the Lovable app-sidebar), cut to Good Cover v1: the
// Pipeline, All Leads, Company settings and Submissions. Pine & Gable's other screens come back with their features.
// FLW-203: Estimator settings, which every Staff member may view (only admins edit).
// Customers and Jobs (GLOSSARY): their own group, after Leads (a won Lead becomes a Customer).
// `admin` hides an item from non-admins in the sidebar only; the server guards are the real check.

export type NavItem = { title: string; url: string; icon: LucideIcon; admin?: boolean }
export type NavGroup = { title: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  // Contacts are people; Leads and Jobs are work, each one page with Board / List views (leads.tsx, jobs.tsx).
  {
    title: 'CRM',
    items: [
      { title: 'Contacts', url: '/contacts', icon: Users },
      { title: 'Leads', url: '/leads', icon: KanbanSquare },
      { title: 'Jobs', url: '/jobs', icon: Hammer },
      { title: 'Lead sources', url: '/lead-sources', icon: BarChart3 },
    ],
  },
  {
    title: 'Company',
    items: [
      { title: 'Company settings', url: '/settings', icon: Building2, admin: true },
      { title: 'Estimator settings', url: '/settings/estimator', icon: Calculator },
      { title: 'Submissions', url: '/submissions', icon: Inbox, admin: true },
    ],
  },
]

export function visibleNavGroups(role: string): NavGroup[] {
  const isAdmin = role === 'admin'
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.admin || isAdmin) })).filter(
    (g) => g.items.length > 0,
  )
}

// An item is active on its page and pages under it (Leads on /leads/$id, Jobs on /jobs/$id); Contacts also on Customer
// pages (/customers/$id). Company settings is exact, so /settings/estimator lights only Estimator settings.
export function isNavItemActive(path: string, url: string): boolean {
  if (url === '/settings') return normalize(path) === url
  if (path === url || path.startsWith(url + '/')) return true
  return url === '/contacts' && path.startsWith('/customers/')
}

export type HeaderTrail = { title: string; parent?: { title: string; url: string } }

// Pages reached from a sidebar screen rather than listed in it; the parent is the item that stays active for them.
const SUB_PAGES: { match: (path: string) => boolean; title: string; parent: string }[] = [
  { match: (p) => p.startsWith('/leads/'), title: 'Lead', parent: '/leads' },
  { match: (p) => p.startsWith('/customers/'), title: 'Customer', parent: '/contacts' },
  { match: (p) => p.startsWith('/jobs/'), title: 'Job', parent: '/jobs' },
]

const normalize = (path: string) => path.replace(/\/+$/, '') || '/'

/** The header's page title, with a parent crumb on pages under a sidebar screen. */
export function headerTrail(path: string, role: string): HeaderTrail {
  const p = normalize(path)
  const items = NAV_GROUPS.flatMap((g) => g.items)
  const sub = SUB_PAGES.find((s) => s.match(p))
  if (sub) {
    const parent = items.find((i) => i.url === sub.parent)!
    return { title: sub.title, parent: { title: parent.title, url: parent.url } }
  }
  // Staff see only their own profile on /settings; Company settings is the admin's view of the same page.
  if (p === '/settings' && role !== 'admin') return { title: 'Your profile' }
  const item = items.find((i) => i.url === p)
  return { title: item?.title ?? 'Turner’s Decks' }
}

// Leads and Jobs (board and list) use the whole width and height (plan 007 decision 7).
const FULL_BLEED = ['/leads', '/jobs']

export function isFullBleed(path: string): boolean {
  return FULL_BLEED.includes(normalize(path))
}
