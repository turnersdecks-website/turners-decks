// Pure state helpers behind the shared DataTable (plan 007 decisions 6 and 11). No React here, so they unit-test
// without a DOM; tests in crm/test/data-table-state.test.ts.
import type { ColumnFiltersState } from '@tanstack/react-table'
import type * as React from 'react'

type RowLike = { getValue: (columnId: string) => unknown }

/** Multi-select facet filter: a row passes when its value is one of the chosen values; no choice keeps every row. */
export function facetFilterFn(row: RowLike, columnId: string, filterValue: unknown): boolean {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true
  return filterValue.includes(row.getValue(columnId))
}
// TanStack calls this to drop the filter entirely when it is cleared.
facetFilterFn.autoRemove = (value: unknown) => !Array.isArray(value) || value.length === 0

function valuesOf(filters: ColumnFiltersState, columnId: string): string[] {
  const value = filters.find((f) => f.id === columnId)?.value
  return Array.isArray(value) ? (value as string[]) : []
}

function withValues(filters: ColumnFiltersState, columnId: string, values: string[]): ColumnFiltersState {
  const rest = filters.filter((f) => f.id !== columnId)
  if (values.length === 0) return rest
  const index = filters.findIndex((f) => f.id === columnId)
  const next = { id: columnId, value: values }
  if (index === -1) return [...rest, next]
  return [...filters.slice(0, index), next, ...filters.slice(index + 1)]
}

/** Adds the facet value if absent, removes it if present; the column's filter goes away with its last value. */
export function toggleFilterValue(filters: ColumnFiltersState, columnId: string, value: string): ColumnFiltersState {
  const current = valuesOf(filters, columnId)
  return withValues(filters, columnId, current.includes(value) ? current.filter((v) => v !== value) : [...current, value])
}

export type DataTableFacetOption = { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }
export type DataTableFacet = { columnId: string; title: string; options: DataTableFacetOption[] }
export type FilterChip = { columnId: string; title: string; value: string; label: string }

/** One removable chip per chosen facet value, in facet then option order. Non-facet filters (text search) get none. */
export function filterChips(filters: ColumnFiltersState, facets: DataTableFacet[]): FilterChip[] {
  return facets.flatMap((facet) => {
    const chosen = valuesOf(filters, facet.columnId)
    return facet.options
      .filter((option) => chosen.includes(option.value))
      .map((option) => ({ columnId: facet.columnId, title: facet.title, value: option.value, label: option.label }))
  })
}

/** The 1-based range of rows on the current page ("26–42 of 42"); an empty table is 0–0 of 0. */
export function pageSummary({ pageIndex, pageSize, total }: { pageIndex: number; pageSize: number; total: number }) {
  if (total === 0) return { from: 0, to: 0, total: 0 }
  const from = pageIndex * pageSize + 1
  return { from, to: Math.min(total, from + pageSize - 1), total }
}

/** Lists that load a capped array say so when the cap was hit (plan 007 decision 11). */
export function cappedFootnote(rowCount: number, cap: number | undefined): string | null {
  return cap !== undefined && rowCount >= cap ? `Showing the newest ${cap}` : null
}

/**
 * The pagination bar only appears once the rows need more than one page at the smallest page size on offer (K10):
 * a short list shows no bar, and a page size someone picked can always be changed back.
 */
export function showPagination({ total, pageSize, pageSizeOptions }: { total: number; pageSize: number; pageSizeOptions: number[] }): boolean {
  return total > Math.min(pageSize, ...pageSizeOptions)
}

/**
 * Global search covers every column that holds text or a number in any row. TanStack's default decides from the first
 * row only, so a nullable column (a Lead's email or phone) dropped out of the search whenever the newest row had none.
 */
export function globalSearchOptions(getTable: () => { getCoreRowModel: () => { flatRows: RowLike[] } }) {
  return {
    getColumnCanGlobalFilter: (column: { id: string }) =>
      getTable()
        .getCoreRowModel()
        .flatRows.some((row) => {
          const value = row.getValue(column.id)
          return typeof value === 'string' || typeof value === 'number'
        }),
  }
}

type SortableColumnLike = { getCanSort: () => boolean; columnDef: { header?: unknown } }

/**
 * Columns the mobile sort control offers: the ones with a sort control on the desktop table, i.e. a component header
 * (DataTableColumnHeader) on a column that can sort. Plain string headers have no sort control there either.
 */
export function mobileSortColumns<C extends SortableColumnLike>(columns: C[]): C[] {
  return columns.filter((column) => column.getCanSort() && typeof column.columnDef.header === 'function')
}
