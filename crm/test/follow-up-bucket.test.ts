import { describe, expect, it } from 'vitest'
import { followUpBucket, wallTimeToEpoch } from '#/lib/dates'

// The Follow-up queue groups open Follow-ups by the company's calendar day, not UTC's.

const NY = 'America/New_York'
// 2026-10-20 21:30 in Maine (EDT, UTC-4) = 2026-10-21 01:30 UTC.
const now = Date.UTC(2026, 9, 21, 1, 30)

describe('followUpBucket', () => {
  it.each([
    ['earlier the day before (Maine time)', Date.UTC(2026, 9, 19, 23, 0), 'overdue'],
    ['earlier today in Maine, though the UTC date is yesterday', Date.UTC(2026, 9, 20, 12, 0), 'today'],
    ['later tonight in Maine, though the UTC date is tomorrow', Date.UTC(2026, 9, 21, 3, 0), 'today'],
    ['tomorrow morning in Maine', Date.UTC(2026, 9, 21, 13, 0), 'upcoming'],
  ])('%s is %s', (_when, due, bucket) => {
    expect(followUpBucket(due, now, NY)).toBe(bucket)
  })
})

describe('wallTimeToEpoch (the Follow-up date picker is read in the company timezone, not the browser’s)', () => {
  it.each([
    ['a summer (EDT) time', '2026-10-20T10:00', Date.UTC(2026, 9, 20, 14, 0)],
    ['a winter (EST) time', '2026-12-01T09:30', Date.UTC(2026, 11, 1, 14, 30)],
  ])('%s', (_what, local, expected) => {
    expect(wallTimeToEpoch(local, NY)).toBe(expected)
  })
})
