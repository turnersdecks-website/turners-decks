import { Check, Moon, Sun } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#/components/ui/dropdown-menu'
import { useTheme } from '#/hooks/use-theme'
import { cn } from '#/lib/utils'

// Kit theme switch (kit:src/components/theme-switch.tsx) on our shared theme context: Light / Dark only, no System
// and no preset picker (plan 007 decisions 3 and 7). Both icons are rendered and CSS picks one from `.dark`, which the
// boot script sets before paint, so the server HTML and the first client render match.
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn('size-9 rounded-lg', className)} aria-label="Toggle theme">
          <Sun className="size-[1.2rem] dark:hidden" aria-hidden="true" />
          <Moon className="hidden size-[1.2rem] dark:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="size-4" aria-hidden="true" />
          Light
          <Check className={cn('ml-auto size-3.5', theme !== 'light' && 'invisible')} aria-hidden="true" />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="size-4" aria-hidden="true" />
          Dark
          <Check className={cn('ml-auto size-3.5', theme !== 'dark' && 'invisible')} aria-hidden="true" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
