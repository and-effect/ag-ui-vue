import { defineComponent, computed, h, Fragment, type PropType, type VNode } from 'vue'
import type { DeepReadonly } from 'vue'
import { contentToText } from '@ag-ui/core'
import type { ContentPart, Message, ToolCall } from '../types'

export type MessageType =
  | 'user'
  | 'assistant'
  | 'assistant-tool-calls'
  | 'tool-result'
  | 'system'
  | 'developer'
  | 'reasoning'
  | 'activity'

// Accept both mutable and deeply-readonly messages (useAgent/useThreads return
// deeply-readonly refs via Vue's readonly(), so the prop type must match).
type AnyMessage = Message | DeepReadonly<Message>

function resolveMessageType(msg: AnyMessage): MessageType {
  switch (msg.role) {
    case 'user':
      return 'user'
    case 'system':
      return 'system'
    case 'developer':
      return 'developer'
    case 'tool':
      return 'tool-result'
    case 'reasoning':
      return 'reasoning'
    case 'activity':
      return 'activity'
    case 'assistant':
      return msg.toolCalls?.length ? 'assistant-tool-calls' : 'assistant'
    default: {
      // Exhaustiveness guard: a role added to @ag-ui/core fails typecheck here
      // instead of silently falling through to 'assistant'.
      const unknownRole: never = msg
      throw new Error(`Unknown message role: ${(unknownRole as { role: string }).role}`)
    }
  }
}

function extractProps(msg: AnyMessage, type: MessageType, index: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = msg as any
  return {
    msg,
    type,
    index,
    // content — string content only. An `activity` message's content is a
    // structured object, and a user message's may be a ContentPart[]; both
    // give `undefined` here and are read off `msg` instead. A tool result may
    // also be a ContentPart[] since 1.0 — flattened to its text (as
    // useToolCalls' `result` is), so `{{ content }}` keeps working; media
    // parts are still on `msg.content`.
    content:
      typeof m.content === 'string'
        ? (m.content as string)
        : type === 'tool-result' && Array.isArray(m.content)
          ? contentToText(m.content as ContentPart[])
          : undefined,
    // toolCalls — only on assistant-tool-calls messages
    toolCalls:
      type === 'assistant-tool-calls'
        ? (m.toolCalls as readonly ToolCall[])
        : undefined,
    // toolCallId — only on tool-result messages
    toolCallId: type === 'tool-result' ? (m.toolCallId as string) : undefined,
  }
}

/**
 * Headless message list. Iterates messages and delegates rendering entirely to
 * named slots — no HTML output of its own.
 *
 * **Per-type slots** (preferred — no v-if branching needed):
 * - `#user="{ msg, content, index }"`
 * - `#assistant="{ msg, content, index }"`
 * - `#assistant-tool-calls="{ msg, toolCalls, index }"`
 * - `#tool-result="{ msg, content, toolCallId, index }"` — `content` is the
 *   result as text; for a multimodal (`ContentPart[]`) result it is the
 *   flattened text, and the media parts are on `msg.content`.
 * - `#system="{ msg, content, index }"`
 * - `#developer="{ msg, content, index }"` — developer instructions. Like
 *   `#system`, renders nothing unless you provide this slot (or `#message`).
 * - `#reasoning="{ msg, content, index }"` — the model's own working (AG-UI 1.0).
 *   Nothing renders unless you provide this slot (or `#message`), so reasoning is
 *   never mistaken for the assistant's answer.
 * - `#activity="{ msg, index }"` — structured progress (AG-UI 1.0). Its content is
 *   an object, so read `msg.content`, not the `content` slot prop.
 *
 * **Generic fallback** (used when no per-type slot matches):
 * - `#message="{ msg, type, content, toolCalls, toolCallId, index }"`
 *
 * **Other slots:**
 * - `#streaming="{ content }"` — rendered when streamingContent is non-empty
 * - `#empty` — rendered when messages is empty and there is no streaming content
 *
 * @example — per-type slots (no casting, no branching)
 * <AgMessageList :messages="messages" :streaming-content="streamingContent">
 *   <template #user="{ content }">
 *     <div class="text-right">{{ content }}</div>
 *   </template>
 *   <template #assistant="{ content }">
 *     <div>{{ content }}</div>
 *   </template>
 *   <template #assistant-tool-calls="{ toolCalls }">
 *     <div v-for="tc in toolCalls" :key="tc.id">
 *       🔧 {{ tc.function.name }}
 *     </div>
 *   </template>
 *   <template #tool-result="{ content }">✅ {{ content }}</template>
 *   <template #streaming="{ content }">{{ content }}<span class="cursor" /></template>
 *   <template #empty>Start a conversation…</template>
 * </AgMessageList>
 *
 * @example — generic slot (single branch point, all props available)
 * <AgMessageList :messages="messages" :streaming-content="streamingContent">
 *   <template #message="{ type, content, toolCalls }">
 *     <div v-if="type === 'user'">{{ content }}</div>
 *     <div v-else-if="type === 'assistant-tool-calls'">
 *       <div v-for="tc in toolCalls" :key="tc.id">🔧 {{ tc.function.name }}</div>
 *     </div>
 *     <div v-else>{{ content }}</div>
 *   </template>
 * </AgMessageList>
 */
export const AgMessageList = defineComponent({
  name: 'AgMessageList',
  props: {
    messages: {
      type: Array as PropType<readonly AnyMessage[]>,
      required: true,
    },
    streamingContent: {
      type: String,
      default: '',
    },
  },
  setup(props, { slots }) {
    const showEmpty = computed(
      () => props.messages.length === 0 && !props.streamingContent,
    )

    return () => {
      const vnodes: VNode[] = []

      if (showEmpty.value) {
        vnodes.push(...(slots.empty?.() ?? []))
      } else {
        // While streaming, HttpAgent has already pushed the in-progress assistant
        // message into agent.messages and mutates its content on every chunk. The
        // #streaming slot is rendering the same message, so skip it here to avoid
        // the duplicate-bubble flash at TEXT_MESSAGE_END.
        //
        // It is not always the *last* message: AG-UI 1.0 can append an
        // `activity` (or `reasoning`) message while the text message is still
        // open, which would leave the partial bubble rendered twice. Walk back
        // over those to find the message the #streaming slot is showing.
        let streamIndex = props.messages.length - 1
        while (
          streamIndex >= 0 &&
          ['activity', 'reasoning'].includes(
            resolveMessageType(props.messages[streamIndex]),
          )
        ) {
          streamIndex--
        }
        const skipStreaming =
          !!props.streamingContent &&
          streamIndex >= 0 &&
          resolveMessageType(props.messages[streamIndex]) === 'assistant'

        props.messages.forEach((msg, index) => {
          if (skipStreaming && index === streamIndex) return

          const type = resolveMessageType(msg)
          const slotProps = extractProps(msg, type, index)

          // Per-type named slot takes priority; fall back to generic #message
          const rendered =
            slots[type]?.(slotProps) ??
            slots.message?.(slotProps) ??
            []

          vnodes.push(...rendered)
        })

        if (props.streamingContent) {
          vnodes.push(...(slots.streaming?.({ content: props.streamingContent }) ?? []))
        }
      }

      return h(Fragment, vnodes)
    }
  },
})
