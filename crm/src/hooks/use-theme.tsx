import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { type Theme, applyTheme, readTheme, toggledTheme } from '#/lib/theme'

// One shared light/dark state for the whole app (plan 007 decision 7). Saved under `pg-theme`; THEME_BOOT_SCRIPT in
// __root.tsx sets `.dark` before first paint, and this provider picks the saved value up after hydration.
type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void; toggle: () => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const saved = readTheme(localStorage)
    setThemeState(saved)
    document.documentElement.classList.toggle('dark', saved === 'dark')
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next, localStorage, document.documentElement)
  }, [])

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next = toggledTheme(current)
      applyTheme(next, localStorage, document.documentElement)
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider.')
  return context
}
