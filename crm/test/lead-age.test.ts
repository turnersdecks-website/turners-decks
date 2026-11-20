import { describe, expect, it } from 'vitest'
import { leadAge } from '#/components/LeadAgePill'

describe('leadAge (New Lead age pill)', () => {
  const now = Date.UTC(2026, 10, 20, 18, 0)
  const ago = (ms: number) => new Date(now - ms)
  const H = 60 * 60_000
  it('shows hours under a day and whole days after', () => {
    expect(leadAge(ago(10 * 60_000), now)).toMatchObject({ label: '<1h', tone: 'fresh' })
    expect(leadAge(ago(5 * H + 59 * 60_000), now)).toMatchObject({ label: '5h', tone: 'fresh' })
    expect(leadAge(ago(23 * H), now).label).toBe('23h')
    expect(leadAge(ago(24 * H), now)).toMatchObject({ label: '1d', tone: 'waiting', words: '1 day ago' })
    expect(leadAge(ago(2 * 24 * H + 20 * H), now)).toMatchObject({ label: '2d', tone: 'waiting' })
    expect(leadAge(ago(3 * 24 * H), now)).toMatchObject({ label: '3d', tone: 'late' })
  })
})

import { monthGrid } from '#/components/DayPicker'

describe('monthGrid (appointment day picker)', () => {
  it('lays November 2026 out from Sunday Nov 1, six full weeks', () => {
    const g = monthGrid(2026, 10)
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual({ value: '2026-11-01', day: 1, inMonth: true })
    expect(g.find((c) => c.value === '2026-11-28')).toMatchObject({ day: 28, inMonth: true })
    expect(g[41]).toMatchObject({ value: '2026-12-12', inMonth: false })
  })
  it('starts a month that begins midweek with the end of the month before', () => {
    expect(monthGrid(2027, 0)[0]).toEqual({ value: '2026-12-27', day: 27, inMonth: false })
  })
})
