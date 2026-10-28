import { Outlet, createFileRoute, redirect, useRouterState } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { AppSidebar } from '#/components/app-sidebar'
import { CommandMenuProvider } from '#/components/layout/command-menu'
import { StaffHeader } from '#/components/layout/header'
import { SidebarProvider } from '#/components/ui/sidebar'
import { isFullBleed } from '#/lib/nav'
import { parseSidebarOpen } from '#/lib/sidebar-state'
import { getCurrentStaff } from '#/lib/staff.functions'
import { cn } from '#/lib/utils'

// The sidebar's saved open state (plan 007 decision 7): the request cookie on the server, document.cookie on the
// client, so the first render already has the right width on hard reloads and client navigation.
const readSidebarOpen = createIsomorphicFn()
  .server(() => parseSidebarOpen(getRequestHeader('cookie')))
  .client(() => parseSidebarOpen(document.cookie))

// Every page except /sign-in, /forgot-password and /reset-password lives under this layout
// (PLAN.md > Route policy). The server functions behind each page enforce requireStaff too.
// Admin Kit shell (kit:src/app/(admin)/layout.tsx): sidebar, header, then the page.
export const Route = createFileRoute('/_staff')({
  beforeLoad: async () => {
    try {
      return { staff: await getCurrentStaff(), sidebarOpen: readSidebarOpen() }
    } catch (error) {
      if (error instanceof Response && error.status === 401) throw redirect({ to: '/sign-in' })
      throw error
    }
  },
  component: StaffLayout,
})

function StaffLayout() {
  const { staff, sidebarOpen } = Route.useRouteContext()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const fullBleed = isFullBleed(path)
  return (
    <CommandMenuProvider role={staff.role}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar staff={staff} />
        {/* Full-bleed screens (Pipeline, Messages, Appointments) get the viewport height and full width; the page
            scrolls inside <main> so they can lay out columns that fill it. */}
        <div id="content" className={cn('flex w-full min-w-0 flex-1 flex-col bg-background', fullBleed && 'h-svh')}>
          <StaffHeader role={staff.role} />
          <main
            data-layout={fullBleed ? 'full-bleed' : undefined}
            className={cn(
              'w-full min-w-0 flex-1 p-4 sm:p-6',
              fullBleed ? 'flex min-h-0 flex-col overflow-auto' : 'mx-auto max-w-7xl',
            )}
          >
            <Outlet />
          </main>
        </div>
      </SidebarProvider>
    </CommandMenuProvider>
  )
}
