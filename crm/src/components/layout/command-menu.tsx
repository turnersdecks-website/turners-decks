import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Moon, Sun } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/ui/command'
import { useTheme } from '#/hooks/use-theme'
import { visibleNavGroups } from '#/lib/nav'

// Cmd/Ctrl+K menu, ported from the Admin Kit (kit:src/components/command-menu.tsx + search-provider.tsx): go to any
// sidebar screen the Staff member can see, switch theme. Pine & Gable's Lead and Prospect search runs on its Look up
// screen, which is not in Good Cover v1; the All Leads table has the search.

type CommandMenuContextValue = { open: boolean; setOpen: (open: boolean) => void }

const CommandMenuContext = createContext<CommandMenuContextValue>({ open: false, setOpen: () => undefined })

export const useCommandMenu = () => useContext(CommandMenuContext)

export function CommandMenuProvider({ role, children }: { role: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo(() => ({ open, setOpen }), [open])
  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      <CommandMenu role={role} open={open} setOpen={setOpen} />
    </CommandMenuContext.Provider>
  )
}

function CommandMenu({ role, open, setOpen }: { role: string } & CommandMenuContextValue) {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const run = useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen],
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Go to a screen…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[min(24rem,60svh)]">
        <CommandEmpty>No results found.</CommandEmpty>
        {visibleNavGroups(role).map((group) => (
          <CommandGroup key={group.title || 'main'} heading={group.title || 'Go to'}>
            {group.items.map((item) => (
              <CommandItem key={item.url} value={item.title} onSelect={() => run(() => navigate({ to: item.url }))}>
                <ArrowRight className="text-muted-foreground/80" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem value="Light theme" onSelect={() => run(() => setTheme('light'))}>
            <Sun /> <span>Light</span>
          </CommandItem>
          <CommandItem value="Dark theme" onSelect={() => run(() => setTheme('dark'))}>
            <Moon /> <span>Dark</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
