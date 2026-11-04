import { createGlobalState, useDark, useToggle } from '@vueuse/core'

/**
 * Playground-wide dark mode. Global so the frontend-tools demo's
 * `setDarkMode` tool can flip the whole app, not just its own panel.
 * The storage key matches the pre-paint script in index.html.
 */
export const useTheme = createGlobalState(() => {
  const isDark = useDark({ storageKey: 'playground-theme' })
  const toggle = useToggle(isDark)
  return { isDark, toggle }
})
