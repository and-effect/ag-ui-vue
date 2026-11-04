import { shallowRef, shallowReadonly, triggerRef, computed, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import type { HttpAgent, AgentSubscriber } from '@ag-ui/client'

export type ReasoningMessageStatus = 'streaming' | 'complete' | 'error'

/**
 * A reasoning message as `useReasoning` tracks it. A plain object, not a
 * reactive one: a change replaces the entry, so pass it as a prop and compare
 * by identity.
 */
export interface ReasoningMessageEntry {
  /** The reasoning message's id, the same as its `messageId` in `agent.messages`. */
  id: string
  /** Reasoning text accumulated so far (streamed via REASONING_MESSAGE_CONTENT). */
  content: string
  /**
   * `streaming` until REASONING_MESSAGE_END. `error` when its run ended first
   * (failed, aborted, or superseded by the next run).
   */
  status: ReasoningMessageStatus
  /** The subagent invocation that produced it. Absent means the parent agent. Opaque: not grouped. */
  subagentRunId?: string
  /**
   * The provider's opaque reasoning artefact (REASONING_ENCRYPTED_VALUE), when
   * one arrived for this message. The client stores the same value on the
   * message in `agent.messages`, which is the copy that gets persisted and sent back.
   */
  encryptedValue?: string
  /** When REASONING_MESSAGE_START arrived. */
  startedAt: Date
  /** When the message ended (complete or error), or null while streaming. */
  completedAt: Date | null
  /** Duration in milliseconds, or null while streaming. */
  duration: number | null
}

export interface ReasoningSpan {
  /** The span's id (`messageId` on REASONING_START). A separate namespace from reasoning message ids. */
  id: string
  /** The subagent invocation that opened it. Absent means the parent agent. Opaque: not grouped. */
  subagentRunId?: string
  /** When REASONING_START arrived. */
  startedAt: Date
}

export interface UseReasoningOptions {
  /**
   * Whether to drop the previous run's reasoning messages when a new run
   * starts. Defaults to true. The settled messages stay in `agent.messages`
   * either way. Open spans never carry over a run boundary, whatever this is set to.
   */
  autoClear?: boolean
}

export interface UseReasoningReturn {
  /** Reasoning messages seen in this run (or across runs with `autoClear: false`), keyed by message id. */
  reasoningMessages: Readonly<Ref<ReadonlyMap<string, ReasoningMessageEntry>>>
  /** Reasoning spans currently open (REASONING_START without its REASONING_END yet), keyed by span id. */
  openSpans: Readonly<Ref<ReadonlyMap<string, ReasoningSpan>>>
  /** Reasoning messages still streaming. */
  streamingMessages: ComputedRef<ReasoningMessageEntry[]>
  /** True while a span is open or a reasoning message is streaming. Drives a "thinking…" indicator. */
  isReasoning: ComputedRef<boolean>
  /** Look up a reasoning message by id, e.g. from `AgMessageList`'s `#reasoning` slot. */
  getReasoning: (messageId: string) => ReasoningMessageEntry | undefined
  /** Drop all tracked reasoning messages and spans. */
  clear: () => void
}

/**
 * Live view of an agent's reasoning (AG-UI 1.0 `REASONING_*` events).
 *
 * The protocol has two namespaces, tracked separately: **spans**
 * (`REASONING_START`/`END`, "the agent is thinking") and **reasoning messages**
 * (`REASONING_MESSAGE_START`/`CONTENT`/`END`, the text). A reasoning message
 * need not sit inside a span, and a span id is not a message id, so neither is
 * modelled as the other's parent.
 *
 * **Render reasoning text in one place.** The client streams reasoning *into*
 * the message in `agent.messages`, so `AgMessageList`'s `#reasoning` slot is
 * already live. The recommended pattern renders there and uses
 * `getReasoning(msg.id)` for status and timing. Render the text from
 * `reasoningMessages` instead only if you leave out the `#reasoning` slot,
 * otherwise it shows twice while it streams.
 *
 * Entries are an index into the current conversation: a settled reasoning
 * message whose message leaves `agent.messages` (a thread switch, `reset()`,
 * or a `MESSAGES_SNAPSHOT` that drops it) is dropped too.
 *
 * @param agent - The HttpAgent instance from useAgent
 * @param options - Optional configuration
 *
 * @example
 * ```vue
 * <script setup>
 * const { agent, messages } = useAgent({ url: '/api/agent' })
 * const { isReasoning, getReasoning } = useReasoning(agent)
 * </script>
 *
 * <template>
 *   <AgMessageList :messages="messages">
 *     <template #reasoning="{ msg, content }">
 *       <details :open="getReasoning(msg.id)?.status === 'streaming'">
 *         <summary>{{ getReasoning(msg.id)?.status === 'streaming' ? 'Thinking…' : 'Reasoning' }}</summary>
 *         {{ content }}
 *       </details>
 *     </template>
 *   </AgMessageList>
 *   <p v-if="isReasoning">Thinking…</p>
 * </template>
 * ```
 */
export function useReasoning(agent: HttpAgent, options: UseReasoningOptions = {}): UseReasoningReturn {
  const { autoClear = true } = options
  // shallowRef + plain Maps, mutated in place and signalled once per handler
  // via triggerRef — no per-token deep proxy and no per-token Map clone. An
  // entry itself is never mutated: a change sets a fresh object (see update()),
  // so a component handed an entry as a prop sees the change. The entries are
  // not reactive, so an in-place `msg.status = …` would be invisible to it.
  const reasoningMessages: Ref<Map<string, ReasoningMessageEntry>> = shallowRef(new Map())
  const openSpans: Ref<Map<string, ReasoningSpan>> = shallowRef(new Map())

  // The run each entry belongs to, so a run's end (or a late RUN_ERROR from an
  // aborted run) closes only that run's entries. Kept off the public entry: run
  // provenance is `useAgent().runForMessage`, not a second source here.
  const runOf = new WeakMap<object, string | undefined>()

  /** Replace an entry with an updated copy (no triggerRef — callers signal once). */
  function update(msg: ReasoningMessageEntry, changes: Partial<ReasoningMessageEntry>) {
    const next = { ...msg, ...changes }
    runOf.set(next, runOf.get(msg))
    reasoningMessages.value.set(msg.id, next)
  }

  function end(msg: ReasoningMessageEntry, status: 'complete' | 'error') {
    const completedAt = new Date()
    update(msg, { status, completedAt, duration: completedAt.getTime() - msg.startedAt.getTime() })
  }

  /**
   * Close what a run left open. `except` keeps one run's entries (the run that
   * is starting). An entry whose message has already left the transcript is
   * dropped rather than closed: reset() or a thread switch mid-stream skips it
   * in onMessagesChanged (still streaming then), and the aborted run's late
   * RUN_ERROR would otherwise leave it behind in the fresh conversation.
   */
  function closeRun(runId: string | undefined, { except = false } = {}) {
    const belongs = (entry: object) =>
      runId === undefined || (except ? runOf.get(entry) !== runId : runOf.get(entry) === runId)
    let changed = false
    let ids: Set<string> | undefined
    for (const msg of reasoningMessages.value.values()) {
      if (msg.status === 'streaming' && belongs(msg)) {
        ids ??= new Set(agent.messages.map((m) => m.id))
        if (ids.has(msg.id)) end(msg, 'error')
        else reasoningMessages.value.delete(msg.id)
        changed = true
      }
    }
    if (changed) triggerRef(reasoningMessages)
    let spansChanged = false
    for (const span of openSpans.value.values()) {
      if (belongs(span)) {
        openSpans.value.delete(span.id)
        spansChanged = true
      }
    }
    if (spansChanged) triggerRef(openSpans)
  }

  const subscriber: AgentSubscriber = {
    onRunStartedEvent({ input }) {
      // Runs are sequential, so whatever an earlier run left open is over.
      closeRun(input?.runId, { except: true })
      if (autoClear && reasoningMessages.value.size) reasoningMessages.value = new Map()
    },

    onReasoningStartEvent({ event, input }) {
      const span: ReasoningSpan = {
        id: event.messageId,
        ...(event.subagentRunId != null && { subagentRunId: event.subagentRunId }),
        startedAt: new Date(),
      }
      runOf.set(span, input?.runId)
      openSpans.value.set(span.id, span)
      triggerRef(openSpans)
    },

    onReasoningEndEvent({ event }) {
      if (openSpans.value.delete(event.messageId)) triggerRef(openSpans)
    },

    onReasoningMessageStartEvent({ event, input }) {
      const msg: ReasoningMessageEntry = {
        id: event.messageId,
        content: '',
        status: 'streaming',
        ...(event.subagentRunId != null && { subagentRunId: event.subagentRunId }),
        startedAt: new Date(),
        completedAt: null,
        duration: null,
      }
      runOf.set(msg, input?.runId)
      reasoningMessages.value.set(msg.id, msg)
      triggerRef(reasoningMessages)
    },

    onReasoningMessageContentEvent({ event, reasoningMessageBuffer }) {
      const msg = reasoningMessages.value.get(event.messageId)
      if (!msg) return
      // The client hands subscribers the buffer *before* it appends this delta.
      // Taking it (rather than appending to our own copy) keeps us in lockstep
      // with the message in agent.messages.
      update(msg, { content: reasoningMessageBuffer + event.delta })
      triggerRef(reasoningMessages)
    },

    onReasoningMessageEndEvent({ event }) {
      const msg = reasoningMessages.value.get(event.messageId)
      if (!msg || msg.status !== 'streaming') return
      end(msg, 'complete')
      triggerRef(reasoningMessages)
    },

    onReasoningEncryptedValueEvent({ event }) {
      if (event.subtype !== 'message') return
      const msg = reasoningMessages.value.get(event.entityId)
      if (!msg) return
      update(msg, { encryptedValue: event.encryptedValue })
      triggerRef(reasoningMessages)
    },

    onRunErrorEvent({ input }) {
      closeRun(input?.runId)
    },

    onRunFailed({ input }) {
      closeRun(input?.runId)
    },

    onRunFinalized({ input }) {
      closeRun(input?.runId)
    },

    onMessagesChanged() {
      // Drop settled entries whose message has left the transcript (thread
      // switch, reset, a snapshot that dropped it). A streaming entry is exempt:
      // the client adds its message just after REASONING_MESSAGE_START.
      if (!reasoningMessages.value.size) return
      const ids = new Set(agent.messages.map((m) => m.id))
      let changed = false
      for (const [id, msg] of reasoningMessages.value) {
        if (msg.status !== 'streaming' && !ids.has(id)) {
          reasoningMessages.value.delete(id)
          changed = true
        }
      }
      if (changed) triggerRef(reasoningMessages)
    },
  }

  const subscription = agent.subscribe(subscriber)

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  function getReasoning(messageId: string): ReasoningMessageEntry | undefined {
    return reasoningMessages.value.get(messageId)
  }

  function clear() {
    reasoningMessages.value = new Map()
    openSpans.value = new Map()
  }

  const streamingMessages = computed(() =>
    [...reasoningMessages.value.values()].filter((m) => m.status === 'streaming'),
  )

  const isReasoning = computed(() => openSpans.value.size > 0 || streamingMessages.value.length > 0)

  return {
    // shallowReadonly, not readonly(): it keeps the ref's shallow flag, so a
    // consumer's plain watch() fires on triggerRef (readonly() drops the flag,
    // and the same-identity Map then looks unchanged to watch).
    reasoningMessages: shallowReadonly(reasoningMessages),
    openSpans: shallowReadonly(openSpans),
    streamingMessages,
    isReasoning,
    getReasoning,
    clear,
  }
}
