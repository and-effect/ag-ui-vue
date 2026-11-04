import { computed, defineComponent, h, Fragment, type PropType, type VNode } from 'vue'
import type { DeepReadonly } from 'vue'
import type { Message, ToolCall } from '@ag-ui/core'
import type { UseAgentReturn } from '../composables/useAgent'
import { useInterrupts, type AgentInterrupt, type UseInterruptsReturn } from '../composables/useInterrupts'

// `reason` is producer-defined, so it can collide with these; such an interrupt goes to `#default`.
const RESERVED_SLOTS = new Set(['default', 'resume'])

/** Scope of every per-interrupt slot. */
export interface AgInterruptSlotProps {
  interrupt: AgentInterrupt
  /** Arguments of the server tool call awaiting approval; `null` when not tool-bound or not JSON. */
  args: Record<string, unknown> | null
  /** Name of that tool call, when tool-bound and found in the transcript. */
  toolName: string | undefined
  /** Stage a `resolved` answer — same contract as `AgentInterrupt.resolve`. */
  resolve: (payload?: unknown) => Promise<void>
  /** Stage a `cancelled` answer — same contract as `AgentInterrupt.cancel`. */
  cancel: () => Promise<void>
}

/** Scope of the `#resume` slot: the batch-level controls of `useInterrupts`. */
export interface AgInterruptResumeSlotProps {
  /** Every open interrupt has a staged answer, no frontend call is pending, no run is in flight. */
  canResume: boolean
  /** Send every staged answer as one `resume[]` — `useInterrupts().resumeAll`. */
  resumeAll: UseInterruptsReturn['resumeAll']
  /** Stage `cancelled` for every open interrupt — `useInterrupts().cancelAll`. */
  cancelAll: UseInterruptsReturn['cancelAll']
}

/**
 * Headless interrupt list. Renders one slot per open interrupt and delegates
 * all markup to slots — no HTML output of its own.
 *
 * Slots are routed by `interrupt.reason`, falling back to `#default` for any
 * reason without a slot of its own. Every slot receives
 * {@link AgInterruptSlotProps}: `{ interrupt, args, toolName, resolve, cancel }`.
 * `args` / `toolName` come from the server tool call a `tool_call` interrupt
 * points at, read from the transcript (it is complete by the time the run
 * pauses, and survives a thread reload where live tool call events don't).
 *
 * Answers are staged, as with `useInterrupts`: an answered interrupt stays in
 * the list (its answer in `interrupt.status` / `interrupt.payload`) and can be
 * revised until the resume is sent. Sending is explicit — render the
 * `#resume="{ canResume, resumeAll, cancelAll }"` slot, shown after the list
 * while the thread is paused, so approve-with-edits forms keep a review step.
 * `default` and `resume` are reserved slot names.
 *
 * The `agent` prop is read once at setup; key the component on it to swap agents.
 *
 * @example
 * ```vue
 * <AgInterrupt :agent="agentCtx">
 *   <template #tool_call="{ interrupt, args, toolName, resolve, cancel }">
 *     <ApprovalCard :title="interrupt.message ?? toolName" :args="args" :status="interrupt.status"
 *       @approve="resolve({ approved: true })" @reject="cancel()" />
 *   </template>
 *   <template #default="{ interrupt, resolve, cancel }">
 *     <p>{{ interrupt.message }}</p>
 *     <button @click="resolve()">OK</button>
 *     <button @click="cancel()">Dismiss</button>
 *   </template>
 *   <template #resume="{ canResume, resumeAll }">
 *     <button :disabled="!canResume" @click="resumeAll()">Continue</button>
 *   </template>
 * </AgInterrupt>
 * ```
 */
export const AgInterrupt = defineComponent({
  name: 'AgInterrupt',
  props: {
    /** The `useAgent` return value (not its raw `agent`). */
    agent: {
      type: Object as PropType<UseAgentReturn>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const agentCtx = props.agent
    const { interrupts, hasPending, canResume, resumeAll, cancelAll } = useInterrupts(agentCtx)
    const toolCalls = computed(() => indexToolCalls(agentCtx.messages.value))

    return () => {
      const vnodes: VNode[] = []
      for (const interrupt of interrupts.value) {
        const call = interrupt.toolCallId ? toolCalls.value.get(interrupt.toolCallId) : undefined
        const slotProps: AgInterruptSlotProps = {
          interrupt,
          args: call ? parseArgs(call.function.arguments) : null,
          toolName: call?.function.name,
          resolve: interrupt.resolve,
          cancel: interrupt.cancel,
        }
        const slot = (RESERVED_SLOTS.has(interrupt.reason) ? undefined : slots[interrupt.reason]) ?? slots.default
        vnodes.push(h(Fragment, { key: interrupt.id }, slot?.(slotProps) ?? []))
      }
      if (hasPending.value) {
        const resumeProps: AgInterruptResumeSlotProps = { canResume: canResume.value, resumeAll, cancelAll }
        vnodes.push(h(Fragment, { key: '#resume' }, slots.resume?.(resumeProps) ?? []))
      }
      return h(Fragment, vnodes)
    }
  },
})

function indexToolCalls(messages: readonly DeepReadonly<Message>[]): Map<string, DeepReadonly<ToolCall>> {
  const index = new Map<string, DeepReadonly<ToolCall>>()
  for (const m of messages) {
    if (m.role === 'assistant') for (const tc of m.toolCalls ?? []) index.set(tc.id, tc)
  }
  return index
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
