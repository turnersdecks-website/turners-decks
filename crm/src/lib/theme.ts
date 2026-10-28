// Light/dark mode, as the Lovable app did it (src/hooks/use-theme.ts): `.dark` on <html>, saved in localStorage.
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'pg-theme'

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void }
type Root = { classList: { toggle(token: string, force: boolean): boolean } }

export function readTheme(storage: Storage): Theme {
  return storage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
}

export function toggledTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme, storage: Storage, root: Root) {
  storage.setItem(THEME_KEY, theme)
  root.classList.toggle('dark', theme === 'dark')
}

// Inline <head> script: sets `.dark` before first paint so a dark-mode user sees no light flash.
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==='dark')document.documentElement.classList.add('dark')}catch(e){}`
