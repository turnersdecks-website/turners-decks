import type { ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "#/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"

// Kit data-table-row-actions: a "..." menu holding DropdownMenuItem children supplied by the screen.
// Plan 007 decision 12: actions a page test asserts in SSR HTML stay outside this menu.
export function DataTableRowActions({ label = "Open menu", children }: { label?: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="data-[state=open]:bg-muted size-8">
          <MoreHorizontal />
          <span className="sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
