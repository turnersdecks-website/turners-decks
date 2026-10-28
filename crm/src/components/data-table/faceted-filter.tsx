import { Check, PlusCircle } from "lucide-react"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "#/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover"
import { Separator } from "#/components/ui/separator"
import { cn } from "#/lib/utils"
import type { DataTableFacet } from "./state"

// Kit data-table-faceted-filter: popover with a searchable checklist and per-value counts.
export function DataTableFacetedFilter({
  facet,
  selected,
  counts,
  onToggle,
  onClear,
}: {
  facet: DataTableFacet
  selected: string[]
  counts?: Map<unknown, number> | undefined
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const chosen = new Set(selected)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle />
          {facet.title}
          {chosen.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                {chosen.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {chosen.size > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {chosen.size} selected
                  </Badge>
                ) : (
                  facet.options
                    .filter((option) => chosen.has(option.value))
                    .map((option) => (
                      <Badge variant="secondary" key={option.value} className="rounded-sm px-1 font-normal">
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={facet.title} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {facet.options.map((option) => {
                const isSelected = chosen.has(option.value)
                const count = counts?.get(option.value)
                return (
                  <CommandItem key={option.value} value={option.label} onSelect={() => onToggle(option.value)}>
                    <div
                      className={cn(
                        "border-primary flex size-4 items-center justify-center rounded-sm border",
                        isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible",
                      )}
                    >
                      <Check className="text-current" />
                    </div>
                    {option.icon && <option.icon className="text-muted-foreground" />}
                    <span>{option.label}</span>
                    {count !== undefined && <span className="ml-auto font-mono text-xs tabular-nums">{count}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {chosen.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={onClear} className="justify-center text-center">
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
