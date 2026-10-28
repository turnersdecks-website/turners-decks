import { describe, expect, it } from 'vitest'
import { THEME_KEY, applyTheme, readTheme, toggledTheme } from '#/lib/theme'

const memoryStorage = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const fakeRoot = () => {
  const classes = new Set<string>()
  return {
    classes,
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c), on) },
  }
}

describe('theme', () => {
  it('uses the key the Lovable app saved under', () => {
    expect(THEME_KEY).toBe('pg-theme')
  })

  it('reads light unless dark was saved', () => {
    expect(readTheme(memoryStorage())).toBe('light')
    expect(readTheme(memoryStorage({ 'pg-theme': 'dark' }))).toBe('dark')
    expect(readTheme(memoryStorage({ 'pg-theme': 'purple' }))).toBe('light')
  })

  it('toggles between light and dark', () => {
    expect(toggledTheme('light')).toBe('dark')
    expect(toggledTheme('dark')).toBe('light')
  })

  it('applying dark saves it and puts .dark on the root; applying light removes it', () => {
    const storage = memoryStorage()
    const root = fakeRoot()

    applyTheme('dark', storage, root)
    expect(readTheme(storage)).toBe('dark')
    expect(root.classes.has('dark')).toBe(true)

    applyTheme('light', storage, root)
    expect(readTheme(storage)).toBe('light')
    expect(root.classes.has('dark')).toBe(false)
  })
})
