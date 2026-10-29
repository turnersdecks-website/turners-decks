import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronsUpDown, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '#/components/ui/sidebar'
import { useTheme } from '#/hooks/use-theme'
import { authClient } from '#/lib/auth-client'
import { type NavGroup, isNavItemActive, visibleNavGroups } from '#/lib/nav'
import { cn } from '#/lib/utils'

// Admin Kit sidebar layout (kit:src/components/layout/app-sidebar.tsx, sidebar-brand.tsx, nav-group.tsx,
// nav-user.tsx) with our lib/nav.ts groups and role filtering. No team switcher.

export type SidebarStaff = { name: string; email: string; role: string }

export function AppSidebar({ staff }: { staff: SidebarStaff }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="relative h-14 shrink-0 px-2 py-1 transition-[height] duration-200 ease-linear group-data-[collapsible=icon]:h-24 group-data-[collapsible=icon]:py-2">
        <SidebarBrand />
        <SidebarTrigger className="absolute top-3 right-2 size-8 shrink-0 transition-[top] duration-200 ease-linear group-data-[collapsible=icon]:top-14" />
      </SidebarHeader>
      <SidebarContent>
        {visibleNavGroups(staff.role).map((g) => (
          <NavGroupSection key={g.title || 'main'} group={g} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser staff={staff} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function SidebarBrand() {
  return (
    <div className="flex h-12 w-full min-w-0 shrink-0 items-center gap-2 p-2 pr-11 pl-2.5 transition-[padding,gap] duration-200 ease-linear group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
      {/* The "T" square from the website logo (public/td-mark*.png, cut from src/assets/images/turners-decks-*-logo.png). */}
      <img src="/td-mark.png" alt="" aria-hidden="true" className="size-8 shrink-0 dark:hidden" />
      <img src="/td-mark-white.png" alt="" aria-hidden="true" className="hidden size-8 shrink-0 dark:block" />
      <div className="grid min-w-0 flex-1 overflow-hidden text-left text-xs leading-tight transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0">
        <span className="truncate font-heading text-sm font-bold">Turner’s Decks</span>
        <span className="truncate text-muted-foreground">CRM</span>
      </div>
    </div>
  )
}

function NavGroupSection({ group }: { group: NavGroup }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      {group.title && <SidebarGroupLabel>{group.title}</SidebarGroupLabel>}
      <SidebarMenu>
        {group.items.map((i) => (
          <SidebarMenuItem key={i.url}>
            <SidebarMenuButton asChild tooltip={i.title} isActive={isNavItemActive(path, i.url)}>
              <Link to={i.url} onClick={() => setOpenMobile(false)}>
                <i.icon />
                <span>{i.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

const initialsOf = (staff: SidebarStaff) =>
  (staff.name || staff.email || '?')
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

// Footer user block. The name row is a real link to Your profile (/settings) for every Staff member, so it is in the
// server-rendered HTML; the menu next to it holds theme and Log out. The Company settings item stays admin-only.
function NavUser({ staff }: { staff: SidebarStaff }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const initials = initialsOf(staff)

  async function signOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in', replace: true })
  }

  const who = (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg bg-highlight text-sm font-bold text-highlight-foreground">{initials}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{staff.name || staff.email}</span>
        <span className="truncate text-xs text-muted-foreground">{staff.role}</span>
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
        <SidebarMenuButton asChild size="lg" tooltip="Your profile" className="min-w-0 flex-1">
          <Link to="/settings" aria-label="Your profile" title="Your profile" onClick={() => setOpenMobile(false)}>
            {who}
          </Link>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent"
              aria-label="Account menu"
            >
              <ChevronsUpDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" side={isMobile ? 'top' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-highlight text-sm font-bold text-highlight-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{staff.name || staff.email}</span>
                  <span className="truncate text-xs text-muted-foreground">{staff.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={() => setOpenMobile(false)}>
                  <UserRound />
                  Your profile
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun />
                Light mode
                <Check className={cn('ml-auto', theme !== 'light' && 'invisible')} aria-hidden="true" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon />
                Dark mode
                <Check className={cn('ml-auto', theme !== 'dark' && 'invisible')} aria-hidden="true" />
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="text-destructive" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
