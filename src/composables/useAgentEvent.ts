import { onScopeDispose } from 'vue'
import type { HttpAgent } from '@ag-ui/client'
import type { AgentSubscriber } from '@ag-ui/client'

/**
 * Subscribe to specific AG-UI events on an agent instance.
 *
 * Automatically unsubscribes when the component unmounts.
 * Useful when you need fine-grained event handling beyond what
 * `useAgent` provides out of the box.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAgent, useAgentEvent } from 'ag-ui-vue'
 *
 * const { agent } = useAgent({ url: '/api/agent' })
 *
 * useAgentEvent(agent, {
 *   onToolCallStartEvent({ event }) {
 *     console.log('Tool called:', event.toolCallName)
 *   },
 *   onCustomEvent({ event }) {
 *     if (event.name === 'rating_info') {
 *       // handle custom event
 *     }
 *   },
 * })
 * </script>
 * ```
 */
export function useAgentEvent(agent: HttpAgent, subscriber: AgentSubscriber) {
  const subscription = agent.subscribe(subscriber)

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  return subscription
}
