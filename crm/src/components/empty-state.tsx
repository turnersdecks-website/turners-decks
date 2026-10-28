import type { ComponentType, ReactNode } from "react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { cn } from "#/lib/utils"

// Kit `ui/empty` as one component: "No Leads yet.", "No Follow-ups", Look up's "We haven't been to X", forbidden and
// missing-record states. Copy comes from the caller (GLOSSARY wording), never from here.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bordered = false,
  className,
}: {
  icon?: ComponentType<{ className?: string }> | undefined
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Dashed outline, for an empty state that stands alone on a page rather than inside a card or table. */
  bordered?: boolean
  className?: string | undefined
}) {
  return (
    <Empty data-slot="empty-state" className={cn(bordered && "border", "p-6 md:p-10", className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
