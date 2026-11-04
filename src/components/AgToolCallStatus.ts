import { defineComponent, h, Fragment, type PropType, type VNode } from 'vue'
import type { ReactiveToolCall, ToolCallStatus } from '../composables/useToolCalls'

// Map from ToolCallStatus (underscore) to Vue slot name (kebab-case).
// Template #awaiting-result maps to slots['awaiting-result'] in render functions.
const STATUS_SLOT: Record<ToolCallStatus, string> = {
  running: 'running',
  awaiting_result: 'awaiting-result',
  completed: 'completed',
  error: 'error',
}

function extractProps(toolCall: ReactiveToolCall, index: number) {
  return {
    toolCall,
    index,
    id: toolCall.id,
    name: toolCall.name,
    args: toolCall.args,
    parsedArgs: toolCall.parsedArgs,
    result: toolCall.result,
    status: toolCall.status,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    duration: toolCall.duration,
  }
}

/**
 * Headless tool call status list. Iterates tool calls and delegates rendering
 * entirely to named slots — no HTML output of its own.
 *
 * Designed to be paired with `useToolCalls`. Pass `activeToolCalls` to show
 * only in-progress calls, or pass `[...toolCalls.value.values()]` for all.
 *
 * **Per-status slots** (preferred — no v-if branching needed):
 * - `#running="{ toolCall, name, args, parsedArgs, index }"`
 * - `#awaiting-result="{ toolCall, name, args, parsedArgs, index }"`
 * - `#completed="{ toolCall, name, result, duration, index }"`
 * - `#error="{ toolCall, name, duration, index }"`
 *
 * **Generic fallback** (used when no per-status slot matches):
 * - `#tool-call="{ toolCall, status, name, args, parsedArgs, result, duration, startedAt, completedAt, index }"`
 *
 * **Other slots:**
 * - `#empty` — rendered when the toolCalls array is empty
 *
 * @example — per-status slots (active tool call spinner)
 * ```vue
 * <AgToolCallStatus :tool-calls="activeToolCalls">
 *   <template #running="{ name, parsedArgs }">
 *     <div class="flex items-center gap-2">
 *       <span class="spinner">⚙️</span>
 *       {{ name }}
 *       <pre v-if="parsedArgs">{{ parsedArgs }}</pre>
 *     </div>
 *   </template>
 *   <template #awaiting-result="{ name }">
 *     <div>⏳ {{ name }} — waiting for result…</div>
 *   </template>
 * </AgToolCallStatus>
 * ```
 *
 * @example — generic slot (single branch point)
 * ```vue
 * <AgToolCallStatus :tool-calls="activeToolCalls">
 *   <template #tool-call="{ status, name, duration }">
 *     <div v-if="status === 'completed'">✅ {{ name }} ({{ duration }}ms)</div>
 *     <div v-else-if="status === 'error'">❌ {{ name }}</div>
 *     <div v-else>⚙️ {{ name }}…</div>
 *   </template>
 * </AgToolCallStatus>
 * ```
 */
export const AgToolCallStatus = defineComponent({
  name: 'AgToolCallStatus',
  props: {
    toolCalls: {
      type: Array as PropType<ReactiveToolCall[]>,
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => {
      const vnodes: VNode[] = []

      if (props.toolCalls.length === 0) {
        vnodes.push(...(slots.empty?.() ?? []))
      } else {
        props.toolCalls.forEach((toolCall, index) => {
          const slotProps = extractProps(toolCall, index)
          const slotName = STATUS_SLOT[toolCall.status]

          // Per-status named slot takes priority; fall back to generic #tool-call
          const rendered =
            slots[slotName]?.(slotProps) ??
            slots['tool-call']?.(slotProps) ??
            []

          vnodes.push(...rendered)
        })
      }

      return h(Fragment, vnodes)
    }
  },
})
