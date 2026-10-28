import { Link, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { Fragment } from 'react'
import { useCommandMenu } from '#/components/layout/command-menu'
import { ThemeSwitch } from '#/components/layout/theme-switch'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { headerTrail } from '#/lib/nav'

// Kit header (kit:src/components/layout/header.tsx): mobile sidebar trigger, page title (with a parent crumb on
// detail pages), Cmd+K search button and the theme switch. No notification bell and no preset picker.
export function StaffHeader({ role }: { role: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { setOpen } = useCommandMenu()
  const trail = headerTrail(path, role)

  return (
    <header className="grid h-12 w-full min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-background px-3 shadow-[inset_0_-1px_0_var(--border)] md:h-14 md:grid-cols-[minmax(0,1fr)_auto] md:px-4">
      <SidebarTrigger className="size-8 shrink-0 md:hidden" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {trail.parent && (
            <Fragment>
              <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
                <BreadcrumbLink asChild>
                  <Link to={trail.parent.url} className="truncate">
                    {trail.parent.title}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
            </Fragment>
          )}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate text-sm font-medium">{trail.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex size-9 shrink-0 items-center justify-center gap-0 p-0 text-muted-foreground hover:text-foreground sm:w-auto sm:gap-2 sm:px-2.5"
          onClick={() => setOpen(true)}
          aria-label="Search and go to (Ctrl+K)"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden text-sm lg:inline">Go to a screen…</span>
          <Kbd className="hidden sm:inline-flex">⌘ K</Kbd>
        </Button>
        <ThemeSwitch />
      </div>
    </header>
  )
}
