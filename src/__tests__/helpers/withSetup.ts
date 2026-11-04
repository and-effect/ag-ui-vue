import { createApp, defineComponent } from 'vue'

/**
 * Mounts a composable inside a real Vue component so that lifecycle hooks
 * like onUnmounted fire correctly. Returns the composable result and an
 * unmount function that triggers cleanup.
 */
export function withSetup<T>(composable: () => T): [T, () => void] {
  let result!: T
  const app = createApp(
    defineComponent({
      setup() {
        result = composable()
        return {}
      },
      render() {
        return null
      },
    }),
  )
  const host = document.createElement('div')
  app.mount(host)
  return [result, () => app.unmount()]
}
