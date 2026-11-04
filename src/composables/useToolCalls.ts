import { shallowRef, triggerRef, computed, readonly, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import type { HttpAgent, AgentSubscriber } from '@ag-ui/client'
import { contentToText } from '@ag-ui/core'
import type { ContentPart, Message } from '@ag-ui/core'
import type {
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
} from '@ag-ui/core'

export type ToolCallStatus = 'running' | 'awaiting_result' | 'completed' | 'error'

export interface ReactiveToolCall {
  /** Tool call ID from the AG-UI event. */
  id: string
  /** Name of the tool being called. */
  name: string
  /** Accumulated arguments (streamed via TOOL_CALL_ARGS). */
  args: string
  /** Parsed arguments object, or null if args aren't valid JSON (yet). */
  parsedArgs: Record<string, unknown> | null
  /**
   * Tool call result as text, available after TOOL_CALL_RESULT.
   *
   * Since AG-UI 1.0 a tool result may be multimodal (`ContentPart[]`), so this
   * is the flattened text (`contentToText`) and drops any media parts. Read
   * `resultContent` for the unflattened value.
   */
  result: string | null
  /**
   * Raw tool call result content, available after TOOL_CALL_RESULT — a string,
   * or the `ContentPart[]` array when the tool returned multimodal content.
   */
  resultContent: string | readonly ContentPart[] | null
  /** Current lifecycle status. */
  status: ToolCallStatus
  /** Timestamp when the tool call started. */
  startedAt: Date
  /** Timestamp when the tool call completed, or null. */
  completedAt: Date | null
  /** Duration in milliseconds, or null if not yet completed. */
  duration: number | null
}

export interface UseToolCallsOptions {
  /**
   * Whether to automatically clear tool calls when a new run starts.
   * Defaults to true. Set to false if you want to keep tool call history
   * across multiple agent runs.
   */
  autoClear?: boolean
}

export interface UseToolCallsReturn {
  /** All tracked tool calls as a reactive Map. */
  toolCalls: Readonly<Ref<ReadonlyMap<string, ReactiveToolCall>>>
  /** Tool calls currently in progress (running or awaiting result). */
  activeToolCalls: ComputedRef<ReactiveToolCall[]>
  /** Tool calls that have completed (with result or error). */
  completedToolCalls: ComputedRef<ReactiveToolCall[]>
  /** Clear all tracked tool calls manually. */
  clear: () => void
  /** Get a specific tool call by ID. */
  getToolCall: (id: string) => ReactiveToolCall | undefined
  /** Find the message result for a given tool call ID. */
  getToolResult: (toolCallId: string, messages: Message[]) => Message | undefined
  /** Mark a tool call as completed (useful for frontend-executed tools). */
  markCompleted: (toolCallId: string, result?: string) => void
}

/**
 * Reactive tracking of tool call lifecycle with real-time updates.
 *
 * **Purpose:** This composable tracks tool calls as they stream in via AG-UI events,
 * providing real-time visibility of tool execution. It's designed for showing live
 * progress indicators (spinners, streaming args) while tools are running.
 *
 * **Important:** Completed tool calls are also available in the message history
 * via `useAgent().messages`. Use this composable for **active tool calls** only,
 * and display completed tool calls from messages for the permanent conversation record.
 *
 * **Pattern:**
 * - Active tool calls → `useToolCalls` (show spinner, live args)
 * - Completed tool calls → `messages` array (embedded in assistant messages)
 *
 * @param agent - The HttpAgent instance from useAgent
 * @param options - Optional configuration
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAgent, useToolCalls } from 'ag-ui-vue'
 *
 * const { agent, messages } = useAgent({ url: '/api/agent' })
 * const { activeToolCalls, getToolResult } = useToolCalls(agent)
 * </script>
 *
 * <template>
 *   <!-- Show in-progress tool calls -->
 *   <div v-for="tc in activeToolCalls" :key="tc.id">
 *     <span class="spinner">⚙️</span>
 *     {{ tc.name }} is running...
 *     <span v-if="tc.duration">{{ tc.duration }}ms</span>
 *     <pre v-if="tc.parsedArgs">{{ tc.parsedArgs }}</pre>
 *   </div>
 *
 *   <!-- Display completed tool calls from messages -->
 *   <div v-for="msg in messages" :key="msg.id">
 *     <div v-if="msg.role === 'assistant' && msg.toolCalls?.length">
 *       <div v-for="tc in msg.toolCalls" :key="tc.id">
 *         🔧 Called {{ tc.function.name }}
 *         <div v-if="getToolResult(tc.id, messages)">
 *           Result: {{ getToolResult(tc.id, messages).content }}
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 * </template>
 * ```
 */
export function useToolCalls(
  agent: HttpAgent,
  options: UseToolCallsOptions = {},
): UseToolCallsReturn {
  const { autoClear = true } = options
  // shallowRef + a plain Map: the tool-call objects are never deep-proxied (Vue
  // only tracks `.value` reassignment), so we mutate entries in place and signal
  // reactivity once per handler via triggerRef — no per-mutation Map clone.
  const toolCalls: Ref<Map<string, ReactiveToolCall>> = shallowRef(new Map())

  function getOrCreate(id: string, name?: string): ReactiveToolCall {
    const existing = toolCalls.value.get(id)
    if (existing) return existing

    const tc: ReactiveToolCall = {
      id,
      name: name ?? 'unknown',
      args: '',
      parsedArgs: null,
      result: null,
      resultContent: null,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      duration: null,
    }
    toolCalls.value.set(id, tc)
    triggerRef(toolCalls)
    return tc
  }

  function update(id: string, updater: (tc: ReactiveToolCall) => void) {
    const tc = toolCalls.value.get(id)
    if (!tc) return
    updater(tc)
    triggerRef(toolCalls)
  }

  function tryParseArgs(args: string): Record<string, unknown> | null {
    try {
      return JSON.parse(args)
    } catch {
      return null
    }
  }

  function calculateDuration(startedAt: Date, completedAt: Date): number {
    return completedAt.getTime() - startedAt.getTime()
  }

  const subscriber: AgentSubscriber = {
    onRunStartedEvent() {
      // Auto-clear tool calls when a new run starts
      if (autoClear) {
        toolCalls.value = new Map()
      }
    },

    onToolCallStartEvent({ event }) {
      const e = event as ToolCallStartEvent
      getOrCreate(e.toolCallId, e.toolCallName)
    },

    onToolCallArgsEvent({ event }) {
      const e = event as ToolCallArgsEvent
      update(e.toolCallId, (tc) => {
        tc.args += e.delta
        tc.parsedArgs = tryParseArgs(tc.args)
      })
    },

    onToolCallEndEvent({ event }) {
      const e = event as ToolCallEndEvent
      update(e.toolCallId, (tc) => {
        tc.status = 'awaiting_result'
        tc.parsedArgs = tryParseArgs(tc.args)
      })
    },

    onToolCallResultEvent({ event }) {
      const e = event as ToolCallResultEvent
      update(e.toolCallId, (tc) => {
        tc.resultContent = e.content
        tc.result = contentToText(e.content)
        tc.status = 'completed'
        tc.completedAt = new Date()
        tc.duration = calculateDuration(tc.startedAt, tc.completedAt)
      })
    },

    onRunErrorEvent() {
      // Mark any non-completed tool calls as errored, then trigger once.
      for (const tc of toolCalls.value.values()) {
        if (tc.status === 'running' || tc.status === 'awaiting_result') {
          tc.status = 'error'
          tc.completedAt = new Date()
          tc.duration = calculateDuration(tc.startedAt, tc.completedAt)
        }
      }
      triggerRef(toolCalls)
    },
  }

  const subscription = agent.subscribe(subscriber)

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  /**
   * Clear all tracked tool calls manually.
   * Useful when resetting a conversation or clearing history.
   */
  function clear() {
    toolCalls.value = new Map()
  }

  /**
   * Get a specific tool call by ID.
   * @param id - The tool call ID
   * @returns The ReactiveToolCall or undefined if not found
   */
  function getToolCall(id: string): ReactiveToolCall | undefined {
    return toolCalls.value.get(id)
  }

  /**
   * Find the tool result message for a given tool call ID.
   * Tool results appear as separate messages with role "tool" and
   * a toolCallId field that matches the tool call's id.
   *
   * @param toolCallId - The tool call ID to find the result for
   * @param messages - The messages array from useAgent
   * @returns The tool message containing the result, or undefined
   *
   * @example
   * ```ts
   * const result = getToolResult('call_123', messages.value)
   * if (result) {
   *   console.log('Tool result:', result.content)
   * }
   * ```
   */
  function getToolResult(toolCallId: string, messages: Message[]): Message | undefined {
    return messages.find((msg) => msg.role === 'tool' && (msg as any).toolCallId === toolCallId)
  }

  /**
   * Manually mark a tool call as completed.
   * This is useful for frontend-executed tools where no TOOL_CALL_RESULT event is emitted.
   *
   * @param toolCallId - The tool call ID to mark as completed
   * @param result - Optional result content to store
   *
   * @example
   * ```ts
   * // After executing a frontend tool and submitting the result
   * markCompleted('call_123', JSON.stringify({ success: true }))
   * ```
   */
  function markCompleted(toolCallId: string, result?: string): void {
    update(toolCallId, (tc) => {
      tc.status = 'completed'
      tc.completedAt = new Date()
      tc.duration = calculateDuration(tc.startedAt, tc.completedAt)
      if (result !== undefined) {
        tc.result = result
        tc.resultContent = result
      }
    })
  }

  const activeToolCalls = computed(() =>
    [...toolCalls.value.values()].filter(
      (tc) => tc.status === 'running' || tc.status === 'awaiting_result',
    ),
  )

  const completedToolCalls = computed(() =>
    [...toolCalls.value.values()].filter(
      (tc) => tc.status === 'completed' || tc.status === 'error',
    ),
  )

  return {
    toolCalls: readonly(toolCalls),
    activeToolCalls,
    completedToolCalls,
    clear,
    getToolCall,
    getToolResult,
    markCompleted,
  }
}