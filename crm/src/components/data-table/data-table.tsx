import { useMemo, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type Table as TanstackTable,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, X } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { cn } from "#/lib/utils"
import { columnLabel } from "./columns"
import { DataTableFacetedFilter } from "./faceted-filter"
import { DataTablePagination } from "./pagination"
import { DataTableRowActions } from "./row-actions"
import {
  cappedFootnote,
  facetFilterFn,
  filterChips,
  globalSearchOptions,
  mobileSortColumns,
  showPagination,
  toggleFilterValue,
  type DataTableFacet,
} from "./state"
import { DataTableViewOptions } from "./view-options"

// The one shared list table (plan 007 decisions 6, 11, 12), ported from the kit's users table
// (original/(users)/users/components/*) plus the mobile card list from ecommerce/customer-list-1.
//
// Modes:
// - `client` (default): sorts, filters and paginates the rows it is given. Pass `cap` (the server's limit) to show
//   "Showing the newest N" when the list was cut.
// - `manual`: the screen owns sorting/filter/search state (usually in search params) and renders its own
//   pagination (e.g. Submissions' "Older" cursor link) through `footer`. Rows are shown as given.
//
// Both the desktop table and the mobile cards are server-rendered (the cards show below `md`).

const ACTIONS_COLUMN_ID = "__actions"

type CommonProps<TData> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[]
  data: TData[]
  getRowId?: (row: TData, index: number) => string
  /** Accessible name for the table. */
  label?: string
  /** Text search box. Without `columnId` it searches every text column. */
  search?: { placeholder: string; columnId?: string }
  /** Multi-select filters shown in the toolbar, with removable chips for chosen values. */
  facets?: DataTableFacet[]
  /** DropdownMenuItem elements for the row's "..." menu; adds an actions column and a menu on each mobile card. */
  rowActions?: (row: TData) => ReactNode
  rowActionsLabel?: (row: TData) => string
  /** Custom mobile card; without it a card is built from the columns' `meta.mobile` placement. */
  mobileCard?: (row: TData) => ReactNode
  /** Shown instead of rows when there are none (e.g. an EmptyState). */
  empty?: ReactNode
  /** Right side of the toolbar (e.g. Download CSV). */
  toolbar?: ReactNode
  /** Screen-owned filter controls, shown after the search box and facets on the toolbar's left. */
  filters?: ReactNode
  initialColumnVisibility?: VisibilityState
  /** Applied to each desktop row, e.g. `data-stage` attributes or highlight classes. */
  rowProps?: (row: TData) => React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>
  className?: string
}

export type DataTableClientProps<TData> = CommonProps<TData> & {
  mode?: "client"
  initialSorting?: SortingState
  pageSize?: number
  pageSizeOptions?: number[]
  /** The server's row limit; when `data.length` reaches it a "Showing the newest N" footnote appears. */
  cap?: number
}

export type DataTableManualProps<TData> = CommonProps<TData> & {
  mode: "manual"
  sorting?: SortingState
  /** Without it, headers are not sortable. */
  onSortingChange?: (sorting: SortingState) => void
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  /** Pagination the screen renders itself, e.g. an "Older" link. */
  footer?: ReactNode
}

export type DataTableProps<TData> = DataTableClientProps<TData> | DataTableManualProps<TData>

function columnIdOf<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  if (column.id) return column.id
  const key = (column as { accessorKey?: unknown }).accessorKey
  return typeof key === "string" ? key : undefined
}

export function DataTable<TData>(props: DataTableProps<TData>) {
  const { data, facets = [], search, rowActions, rowActionsLabel, mobileCard, empty, toolbar, filters, label, rowProps, className } = props
  const manual = props.mode === "manual"

  const [sortingState, setSortingState] = useState<SortingState>(manual ? [] : (props.initialSorting ?? []))
  const [filtersState, setFiltersState] = useState<ColumnFiltersState>([])
  const [globalFilterState, setGlobalFilterState] = useState("")
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(props.initialColumnVisibility ?? {})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: manual ? 0 : (props.pageSize ?? 25) })

  const sorting = manual ? (props.sorting ?? []) : sortingState
  const columnFilters = manual ? (props.columnFilters ?? []) : filtersState
  const setColumnFilters = (next: ColumnFiltersState) => (manual ? props.onColumnFiltersChange?.(next) : setFiltersState(next))
  const searchValue = manual
    ? (props.searchValue ?? "")
    : search?.columnId
      ? ((filtersState.find((f) => f.id === search.columnId)?.value as string | undefined) ?? "")
      : globalFilterState

  const facetIds = useMemo(() => new Set(facets.map((f) => f.columnId)), [facets])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo((): ColumnDef<TData, any>[] => {
    const withFilters = props.columns.map((column) => {
      const id = columnIdOf(column)
      return id && facetIds.has(id) && !column.filterFn ? { ...column, filterFn: facetFilterFn } : column
    })
    if (!rowActions) return withFilters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions: ColumnDef<TData, any> = {
      id: ACTIONS_COLUMN_ID,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DataTableRowActions label={rowActionsLabel?.(row.original)}>{rowActions(row.original)}</DataTableRowActions>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { className: "w-12", mobile: "hidden" },
    }
    return [...withFilters, actions]
  }, [props.columns, facetIds, rowActions, rowActionsLabel])

  const table: TanstackTable<TData> = useReactTable<TData>({
    data,
    columns,
    ...(props.getRowId ? { getRowId: props.getRowId } : {}),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter: manual ? undefined : globalFilterState,
      ...(manual ? {} : { pagination }),
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      if (manual) props.onSortingChange?.(next)
      else setSortingState(next)
    },
    onColumnFiltersChange: (updater) => setColumnFilters(typeof updater === "function" ? updater(columnFilters) : updater),
    onGlobalFilterChange: setGlobalFilterState,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    // Search every text column, not only those with a value in the first row (TanStack's default).
    ...globalSearchOptions(() => table),
    enableSorting: manual ? Boolean(props.onSortingChange) : true,
    manualSorting: manual,
    manualFiltering: manual,
    manualPagination: manual,
    autoResetPageIndex: !manual,
    getCoreRowModel: getCoreRowModel(),
    ...(manual
      ? {}
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          getFacetedRowModel: getFacetedRowModel(),
          getFacetedUniqueValues: getFacetedUniqueValues(),
        }),
  })

  function setSearch(value: string) {
    if (manual) props.onSearchChange?.(value)
    else if (search?.columnId) table.getColumn(search.columnId)?.setFilterValue(value || undefined)
    else setGlobalFilterState(value)
  }

  const chips = filterChips(columnFilters, facets)
  const rows = table.getRowModel().rows
  const footnote = manual ? null : cappedFootnote(data.length, props.cap)
  const pageSizeOptions = manual ? [] : (props.pageSizeOptions ?? [10, 25, 50, 100])
  const showToolbar = Boolean(search || facets.length || toolbar || filters || !manual)

  return (
    <div data-slot="data-table" className={cn("flex flex-col gap-4", className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {search && (
              <Input
                type="search"
                aria-label={search.placeholder}
                placeholder={search.placeholder}
                value={searchValue}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 w-full sm:w-[220px] lg:w-[280px]"
              />
            )}
            {facets.map((facet) => (
              <DataTableFacetedFilter
                key={facet.columnId}
                facet={facet}
                selected={(columnFilters.find((f) => f.id === facet.columnId)?.value as string[] | undefined) ?? []}
                counts={manual ? undefined : table.getColumn(facet.columnId)?.getFacetedUniqueValues()}
                onToggle={(value) => setColumnFilters(toggleFilterValue(columnFilters, facet.columnId, value))}
                onClear={() => setColumnFilters(columnFilters.filter((f) => f.id !== facet.columnId))}
              />
            ))}
            {filters}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
            <DataTableViewOptions table={table} />
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-slot="data-table-chips">
          {chips.map((chip) => (
            <Button
              key={`${chip.columnId}:${chip.value}`}
              variant="secondary"
              size="sm"
              className="h-7 gap-1 rounded-full px-2.5 text-xs font-normal"
              onClick={() => setColumnFilters(toggleFilterValue(columnFilters, chip.columnId, chip.value))}
            >
              <span className="text-muted-foreground">{chip.title}:</span> {chip.label}
              <X className="size-3" />
              <span className="sr-only">Remove filter</span>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setColumnFilters(columnFilters.filter((f) => !facetIds.has(f.id)))}
          >
            Reset
          </Button>
        </div>
      )}

      <div className="hidden overflow-hidden rounded-md border md:block">
        <Table aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={header.column.columnDef.meta?.className}
                      aria-sort={
                        header.column.getCanSort() ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined
                      }
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} {...rowProps?.(row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
                  {empty ?? <span className="text-muted-foreground">No results.</span>}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <MobileSort table={table} />

      <div className="flex flex-col gap-3 md:hidden" data-slot="data-table-cards">
        {rows.length ? (
          rows.map((row) =>
            mobileCard ? (
              <div key={row.id}>{mobileCard(row.original)}</div>
            ) : (
              <DefaultMobileCard key={row.id} row={row} rowActions={rowActions} rowActionsLabel={rowActionsLabel} />
            ),
          )
        ) : (
          <div className="text-muted-foreground rounded-lg border p-6 text-center text-sm">{empty ?? "No results."}</div>
        )}
      </div>

      {manual
        ? props.footer && <div className="flex flex-wrap items-center justify-end gap-2">{props.footer}</div>
        : showPagination({
            total: table.getFilteredRowModel().rows.length,
            pageSize: pagination.pageSize,
            pageSizeOptions: pageSizeOptions,
          }) && <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />}
      {footnote && (
        <p className="text-muted-foreground text-xs" data-slot="data-table-footnote">
          {footnote}
        </p>
      )}
    </div>
  )
}

function DefaultMobileCard<TData>({
  row,
  rowActions,
  rowActionsLabel,
}: {
  row: Row<TData>
  rowActions?: ((row: TData) => ReactNode) | undefined
  rowActionsLabel?: ((row: TData) => string) | undefined
}) {
  // Every cell, not just the desktop-visible ones: hiding a column on the table (View menu) must not empty the cards.
  const cells = row.getAllCells().filter((cell) => cell.column.columnDef.meta?.mobile !== "hidden")
  const title: Cell<TData, unknown> | undefined =
    cells.find((cell) => cell.column.columnDef.meta?.mobile === "title") ?? cells[0]
  const details = cells.filter((cell) => cell !== title)
  return (
    <article className="bg-card rounded-lg border p-4" data-slot="data-table-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-medium">{title && flexRender(title.column.columnDef.cell, title.getContext())}</div>
        {rowActions && (
          <DataTableRowActions label={rowActionsLabel?.(row.original)}>{rowActions(row.original)}</DataTableRowActions>
        )}
      </div>
      {details.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {details.map((cell) => (
            <div key={cell.id} className="flex min-w-0 flex-col gap-1">
              <dt className="text-muted-foreground text-xs">{columnLabel(cell.column)}</dt>
              <dd className="min-w-0 text-sm break-words">{flexRender(cell.column.columnDef.cell, cell.getContext())}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

/** Phones have no column headers, so sorting moves to a field + direction control above the cards (below `md`). */
function MobileSort<TData>({ table }: { table: TanstackTable<TData> }) {
  const columns = mobileSortColumns(table.getAllLeafColumns())
  if (columns.length === 0) return null
  const current = table.getState().sorting[0]
  const column = current ? columns.find((c) => c.id === current.id) : undefined
  const desc = current?.desc ?? false
  return (
    <div className="flex items-center gap-2 md:hidden" data-slot="data-table-mobile-sort">
      <Select
        value={column?.id ?? ""}
        onValueChange={(id) => {
          const next = table.getColumn(id)
          if (next) table.setSorting([{ id, desc: column ? desc : next.getFirstSortDir() === "desc" }])
        }}
      >
        <SelectTrigger className="h-8 flex-1" aria-label="Sort by">
          {/* Children, not the item text, so the server-rendered trigger already names the field. */}
          <SelectValue placeholder="Sort by">{column ? columnLabel(column) : null}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {columnLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        disabled={!column}
        onClick={() => column && table.setSorting([{ id: column.id, desc: !desc }])}
      >
        {desc ? <ArrowDown /> : <ArrowUp />}
        {desc ? "Descending" : "Ascending"}
      </Button>
    </div>
  )
}
