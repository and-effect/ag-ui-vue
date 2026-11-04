import { shallowRef } from 'vue'
import type { HttpAgent } from '@ag-ui/client'
import type { BaseEvent } from '@and-effect/ag-ui-vue'
import { useAgentEvent } from '@and-effect/ag-ui-vue'

export interface InspectedEvent {
  seq: number
  at: Date
  event: BaseEvent
}

const MAX_EVENTS = 500

// Module-level so the inspector panel (in the app shell) can show events from
// whichever demo is mounted. Only one demo is mounted at a time.
const events = shallowRef<InspectedEvent[]>([])
let seq = 0

function clear() {
  events.value = []
}

/**
 * Playground-only: stream an agent's raw AG-UI events into the inspector
 * panel. Call it from a demo's setup; the subscription ends when the demo
 * unmounts (useAgentEvent cleans up on scope dispose).
 */
export function inspect(agent: HttpAgent) {
  clear()
  useAgentEvent(agent, {
    onEvent({ event }) {
      const next = [...events.value, { seq: seq++, at: new Date(), event }]
      events.value = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
    },
  })
}

export function useEventInspector() {
  return { events, clear }
}
