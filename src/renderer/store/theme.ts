import { create } from 'zustand'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'nakoda.theme'
const query = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return query()?.matches === false ? 'light' : 'dark'
  return choice
}

/** Puts the `dark` class on <html> (shadcn's `dark:` variants and our dark tokens switch on it). */
function apply(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

type ThemeState = { choice: ThemeChoice; resolved: ResolvedTheme; set: (choice: ThemeChoice) => void }

export const useTheme = create<ThemeState>((set) => ({
  choice: read(),
  resolved: resolve(read()),
  set: (choice) => {
    try {
      localStorage.setItem(KEY, choice)
    } catch {
      /* private mode: the choice lasts until reload */
    }
    const resolved = resolve(choice)
    apply(resolved)
    set({ choice, resolved })
  },
}))

/** Call once at startup: applies the saved choice and follows the OS when the choice is "system". */
export function initTheme(): void {
  apply(useTheme.getState().resolved)
  query()?.addEventListener('change', () => {
    const { choice } = useTheme.getState()
    if (choice !== 'system') return
    const resolved = resolve(choice)
    apply(resolved)
    useTheme.setState({ resolved })
  })
}
