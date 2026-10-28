import { describe, expect, it } from 'vitest'
import { cappedFootnote, facetFilterFn, filterChips, pageSummary, showPagination, toggleFilterValue } from '#/components/data-table/state'

const row = (values: Record<string, unknown>) => ({ getValue: (id: string) => values[id] })

describe('DataTable faceted filters', () => {
  it('keeps rows whose value is one of the chosen facet values, and every row when none is chosen', () => {
    expect(facetFilterFn(row({ stage: 'quoted' }), 'stage', ['new', 'quoted'])).toBe(true)
    expect(facetFilterFn(row({ stage: 'won' }), 'stage', ['new', 'quoted'])).toBe(false)
    expect(facetFilterFn(row({ stage: 'won' }), 'stage', [])).toBe(true)
    expect(facetFilterFn(row({ stage: 'won' }), 'stage', undefined)).toBe(true)
  })

  it('toggles a facet value on and off, dropping the column filter when its last value goes', () => {
    const one = toggleFilterValue([], 'stage', 'new')
    expect(one).toEqual([{ id: 'stage', value: ['new'] }])
    const two = toggleFilterValue(one, 'stage', 'won')
    expect(two).toEqual([{ id: 'stage', value: ['new', 'won'] }])
    expect(toggleFilterValue(two, 'stage', 'new')).toEqual([{ id: 'stage', value: ['won'] }])
    expect(toggleFilterValue([{ id: 'stage', value: ['won'] }, { id: 'source', value: ['call'] }], 'stage', 'won')).toEqual([
      { id: 'source', value: ['call'] },
    ])
  })
})

describe('DataTable filter chips', () => {
  const facets = [
    { columnId: 'stage', title: 'Stage', options: [{ label: 'New', value: 'new' }, { label: 'Won', value: 'won' }] },
    { columnId: 'source', title: 'Source', options: [{ label: 'Website', value: 'website' }] },
  ]

  it('lists one chip per chosen facet value with its column title and option label, in facet order', () => {
    const filters = [
      { id: 'source', value: ['website'] },
      { id: 'stage', value: ['won', 'new'] },
    ]
    expect(filterChips(filters, facets)).toEqual([
      { columnId: 'stage', title: 'Stage', value: 'new', label: 'New' },
      { columnId: 'stage', title: 'Stage', value: 'won', label: 'Won' },
      { columnId: 'source', title: 'Source', value: 'website', label: 'Website' },
    ])
  })

  it('ignores filters on columns that are not facets and values no option names', () => {
    expect(filterChips([{ id: 'name', value: 'gree' }, { id: 'stage', value: ['gone'] }], facets)).toEqual([])
  })
})

describe('DataTable pagination summary', () => {
  it('gives the 1-based row range shown on the current page', () => {
    expect(pageSummary({ pageIndex: 0, pageSize: 25, total: 42 })).toEqual({ from: 1, to: 25, total: 42 })
    expect(pageSummary({ pageIndex: 1, pageSize: 25, total: 42 })).toEqual({ from: 26, to: 42, total: 42 })
    expect(pageSummary({ pageIndex: 0, pageSize: 25, total: 0 })).toEqual({ from: 0, to: 0, total: 0 })
  })
})

describe('DataTable capped list footnote', () => {
  it('says the list is cut to the newest rows only when the cap was hit', () => {
    expect(cappedFootnote(200, 200)).toBe('Showing the newest 200')
    expect(cappedFootnote(199, 200)).toBeNull()
    expect(cappedFootnote(500, undefined)).toBeNull()
  })
})

describe('DataTable pagination bar', () => {
  const options = [10, 25, 50, 100]
  it('is hidden while every row fits on one page at the smallest page size', () => {
    expect(showPagination({ total: 0, pageSize: 25, pageSizeOptions: options })).toBe(false)
    expect(showPagination({ total: 3, pageSize: 25, pageSizeOptions: options })).toBe(false)
    expect(showPagination({ total: 10, pageSize: 25, pageSizeOptions: options })).toBe(false)
  })
  it('shows once a smaller page size would split the rows, so a chosen size can always be changed back', () => {
    expect(showPagination({ total: 11, pageSize: 25, pageSizeOptions: options })).toBe(true)
    expect(showPagination({ total: 30, pageSize: 25, pageSizeOptions: options })).toBe(true)
  })
  it('uses the page size itself when it is smaller than every option', () => {
    expect(showPagination({ total: 6, pageSize: 5, pageSizeOptions: options })).toBe(true)
    expect(showPagination({ total: 5, pageSize: 5, pageSizeOptions: options })).toBe(false)
  })
})
