import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTable, getCoreRowModel, getFilteredRowModel, type ColumnDef, type Table } from '@tanstack/table-core'
import { describe, expect, it } from 'vitest'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { globalSearchOptions, mobileSortColumns } from '#/components/data-table/state'

// The shared DataTable (plan 007 review round 1): global search, mobile cards and the mobile sort control.

type Person = { id: string; name: string; email: string | null; phone: string | null; received: number }

const people: Person[] = [
  // The newest row has no email or phone: TanStack's default would drop both columns from the search.
  { id: '1', name: 'Nora Newest', email: null, phone: null, received: 3 },
  { id: '2', name: 'Pat Older', email: 'pat@example.com', phone: '+16105550100', received: 2 },
]

describe('DataTable global search', () => {
  it('searches every text column even when the first row has no value in it', () => {
    const columns: ColumnDef<Person, unknown>[] = [
      { accessorKey: 'name' },
      { accessorKey: 'email' },
      { accessorKey: 'phone' },
    ]
    const search = (globalFilter: string) => {
      const table: Table<Person> = createTable<Person>({
        data: people,
        columns,
        state: { globalFilter },
        onStateChange: () => {},
        renderFallbackValue: null,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        ...globalSearchOptions(() => table),
      })
      table.setOptions((prev) => ({ ...prev, state: { ...table.initialState, globalFilter } }))
      return table.getRowModel().rows.map((r) => r.original.id)
    }
    expect(search('pat@example')).toEqual(['2'])
    expect(search('5550100')).toEqual(['2'])
    expect(search('nora')).toEqual(['1'])
  })
})

const columns: ColumnDef<Person, unknown>[] = [
  { accessorKey: 'name', header: 'Name', meta: { mobile: 'title' } },
  { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? 'no email' },
  { accessorKey: 'received', header: ({ column }) => createElement(DataTableColumnHeader<Person, unknown>, { column, title: 'Received' }), meta: { label: 'Received' } },
]

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(DataTable<Person>, { columns, data: people, getRowId: (p: Person) => p.id, ...props }))

const cardsOf = (html: string) => html.slice(html.indexOf('data-slot="data-table-cards"'))
const mobileSortOf = (html: string) => {
  const start = html.indexOf('data-slot="data-table-mobile-sort"')
  return start === -1 ? null : html.slice(start, html.indexOf('data-slot="data-table-cards"'))
}

describe('DataTable mobile cards', () => {
  it('show every column by its mobile placement, even ones hidden on the desktop table', () => {
    const html = render({ initialColumnVisibility: { name: false, email: false } })
    const cards = cardsOf(html)
    expect(cards).toContain('Pat Older')
    expect(cards).toContain('pat@example.com')
    expect(cards).toContain('Email')
  })
})

describe('DataTable mobile sort control', () => {
  it('shows the current sort field and direction from the table sorting state', () => {
    const control = mobileSortOf(render({ initialSorting: [{ id: 'received', desc: true }] }))
    expect(control).not.toBeNull()
    expect(control).toContain('Received')
    expect(control).toContain('aria-label="Sort by"')
    expect(control).toContain('Descending')
  })

  it('offers the columns that have a sort control on the desktop table (a component header that can sort)', () => {
    const table: Table<Person> = createTable<Person>({
      data: people,
      columns: [...columns, { id: 'actions', header: () => null, cell: () => null }],
      state: {},
      onStateChange: () => {},
      renderFallbackValue: null,
      getCoreRowModel: getCoreRowModel(),
    })
    expect(mobileSortColumns(table.getAllLeafColumns()).map((c) => c.id)).toEqual(['received'])
  })

  it('offers no control when no column can sort', () => {
    expect(mobileSortOf(render({ mode: 'manual' }))).toBeNull()
  })
})
