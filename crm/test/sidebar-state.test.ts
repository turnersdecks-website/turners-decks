import { describe, expect, it } from 'vitest'
import { SIDEBAR_COOKIE_NAME, parseSidebarOpen } from '#/lib/sidebar-state'

// The sidebar's open state lives in the `sidebar_state` cookie (written by SidebarProvider). Plan 007 decision 7:
// absent or invalid → open.

describe('parseSidebarOpen', () => {
  it('uses the cookie the sidebar writes', () => {
    expect(SIDEBAR_COOKIE_NAME).toBe('sidebar_state')
  })

  it('is closed only when the cookie says false', () => {
    expect(parseSidebarOpen('sidebar_state=false')).toBe(false)
    expect(parseSidebarOpen('sidebar_state=true')).toBe(true)
  })

  it('is open with no cookie header or no sidebar cookie', () => {
    expect(parseSidebarOpen(undefined)).toBe(true)
    expect(parseSidebarOpen(null)).toBe(true)
    expect(parseSidebarOpen('')).toBe(true)
    expect(parseSidebarOpen('better-auth.session_token=abc; other=1')).toBe(true)
  })

  it('is open when the value is not true or false', () => {
    expect(parseSidebarOpen('sidebar_state=')).toBe(true)
    expect(parseSidebarOpen('sidebar_state=0')).toBe(true)
    expect(parseSidebarOpen('sidebar_state=FALSE')).toBe(true)
    expect(parseSidebarOpen('sidebar_state=falsey')).toBe(true)
  })

  it('finds the cookie among others, with or without spaces', () => {
    expect(parseSidebarOpen('a=1; sidebar_state=false; b=2')).toBe(false)
    expect(parseSidebarOpen('a=1;sidebar_state=false')).toBe(false)
    expect(parseSidebarOpen('  sidebar_state = false ')).toBe(false)
  })

  it('does not match a cookie whose name only ends with sidebar_state', () => {
    expect(parseSidebarOpen('old_sidebar_state=false')).toBe(true)
    expect(parseSidebarOpen('xsidebar_state=false; sidebar_state=true')).toBe(true)
  })

  it('takes the first sidebar_state cookie, as browsers send the most specific path first', () => {
    expect(parseSidebarOpen('sidebar_state=false; sidebar_state=true')).toBe(false)
  })
})
