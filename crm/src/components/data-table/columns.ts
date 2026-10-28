import type { Column, RowData } from "@tanstack/react-table"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Name in the View menu and in the default mobile card; defaults to a string header, then the column id. */
    label?: string
    /** Classes for the column's <th> and <td>. */
    className?: string
    /** Default mobile card placement: `title` (card heading), `detail` (label + value grid, the default) or `hidden`. */
    mobile?: "title" | "detail" | "hidden"
  }
}

export function columnLabel<TData>(column: Column<TData, unknown>): string {
  const header = column.columnDef.header
  return column.columnDef.meta?.label ?? (typeof header === "string" ? header : column.id)
}
