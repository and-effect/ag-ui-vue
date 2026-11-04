import { describe, it, expect } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { AgMessageList, type MessageType } from '../components/AgMessageList'
import { useReasoning } from '../composables/useReasoning'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import type { Message } from '../types'

// ─── Mount helper ──────────────────────────────────────────────────────────
//
// Renders AgMessageList with a single generic #message slot that records the
// `type` (and `content`) it was handed for every message, so we can assert the
// role → MessageType mapping without any DOM assertions.

interface Seen {
  type: MessageType
  content: string | undefined
}

function renderWith(
  messages: Message[],
  slotNames: string[] = ['message'],
  streamingContent = '',
) {
  const seen: Seen[] = []
  const slotsUsed: string[] = []

  const slots: Record<string, (p: Seen & Record<string, unknown>) => unknown> = {}
  for (const name of slotNames) {
    slots[name] = (p) => {
      slotsUsed.push(name)
      if (name === 'message') seen.push({ type: p.type, content: p.content })
      return h('div')
    }
  }
  // Always wire #streaming so the dedup tests can see both sides at once.
  slots.streaming = () => h('div')

  const host = defineComponent({
    render: () => h(AgMessageList, { messages, streamingContent }, slots),
  })

  const el = document.createElement('div')
  const app = createApp(host)
  app.mount(el)
  app.unmount()

  return { seen, slotsUsed }
}

describe('AgMessageList — role → MessageType mapping', () => {
  it('maps the classic roles', () => {
    const { seen } = renderWith([
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'hello' },
      { id: '3', role: 'system', content: 'be nice' },
      { id: '4', role: 'tool', toolCallId: 'call_1', content: 'result' },
    ] as unknown as Message[])

    expect(seen.map((s) => s.type)).toEqual([
      'user',
      'assistant',
      'system',
      'tool-result',
    ])
  })

  it('maps an assistant message carrying toolCalls to assistant-tool-calls', () => {
    const { seen } = renderWith([
      {
        id: '1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } },
        ],
      },
    ] as unknown as Message[])

    expect(seen[0].type).toBe('assistant-tool-calls')
  })

  // ─── AG-UI 1.0 union arms ────────────────────────────────────────────────
  //
  // `reasoning` and `activity` joined the Message union in 1.0. Before they
  // were mapped, both fell through to 'assistant' — rendering the model's
  // private working, or an empty bubble for an object-content progress
  // message, as though it were the assistant's answer.

  it('maps a reasoning message to its own type, not assistant', () => {
    const { seen } = renderWith([
      { id: '1', role: 'reasoning', content: 'let me think…' },
    ] as unknown as Message[])

    expect(seen[0].type).toBe('reasoning')
    expect(seen[0].type).not.toBe('assistant')
  })

  it('maps an activity message to its own type and gives no string content', () => {
    const { seen } = renderWith([
      { id: '1', role: 'activity', content: { step: 'searching', progress: 0.5 } },
    ] as unknown as Message[])

    expect(seen[0].type).toBe('activity')
    // content is an object on an activity message, so the string-only slot
    // prop is undefined and consumers read msg.content instead.
    expect(seen[0].content).toBeUndefined()
  })

  it('renders nothing for reasoning when only per-type slots are given', () => {
    // A consumer wiring #user/#assistant only must not have reasoning silently
    // land in the assistant slot — it renders nothing until they opt in.
    const { slotsUsed } = renderWith(
      [{ id: '1', role: 'reasoning', content: 'private working' }] as unknown as Message[],
      ['user', 'assistant'],
    )

    expect(slotsUsed).toEqual([])
  })

  it('routes reasoning to a #reasoning slot when one is provided', () => {
    const { slotsUsed } = renderWith(
      [{ id: '1', role: 'reasoning', content: 'private working' }] as unknown as Message[],
      ['assistant', 'reasoning'],
    )

    expect(slotsUsed).toEqual(['reasoning'])
  })

  it('flattens a multimodal tool result to its text for the content prop', () => {
    // 1.0 widened ToolMessage.content to string | ContentPart[]. The string-only
    // prop used to give undefined here, so `{{ content }}` rendered nothing.
    const { seen } = renderWith([
      {
        id: '1',
        role: 'tool',
        toolCallId: 'call_1',
        content: [
          { type: 'text', text: 'Here is the chart' },
          { type: 'image', source: { type: 'url', value: 'https://example.com/c.png' } },
        ],
      },
    ] as unknown as Message[])

    expect(seen[0].type).toBe('tool-result')
    expect(seen[0].content).toBe('Here is the chart')
  })

  it('still gives undefined content for a multimodal user message', () => {
    const { seen } = renderWith([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ] as unknown as Message[])

    expect(seen[0].content).toBeUndefined()
  })

  it('maps a developer message to its own type, not assistant', () => {
    const { seen } = renderWith([
      { id: '1', role: 'developer', content: 'internal instruction' },
    ] as unknown as Message[])

    expect(seen[0].type).toBe('developer')
    expect(seen[0].type).not.toBe('assistant')
  })
})

// ─── Streaming de-duplication ──────────────────────────────────────────────
//
// While a text message streams, HttpAgent has already pushed the partial
// assistant message into agent.messages, and #streaming renders the same text
// — so the list must skip that one message. AG-UI 1.0 can append an `activity`
// or `reasoning` message after it mid-stream, which used to defeat the guard
// (it only checked the very last message) and render the bubble twice.

describe('AgMessageList — streaming de-duplication', () => {
  const partial = { id: 'a1', role: 'assistant', content: 'partial ans' }

  function assistantBubbles(messages: Message[], streaming: string) {
    const { seen } = renderWith(messages, ['message'], streaming)
    return seen.filter((s) => s.type === 'assistant').map((s) => s.content)
  }

  it('skips the partial assistant message while streaming', () => {
    expect(
      assistantBubbles(
        [{ id: 'u1', role: 'user', content: 'hi' }, partial] as unknown as Message[],
        'partial ans',
      ),
    ).toEqual([])
  })

  it('still skips it when an activity message is appended mid-stream', () => {
    expect(
      assistantBubbles(
        [
          { id: 'u1', role: 'user', content: 'hi' },
          partial,
          { id: 'act1', role: 'activity', content: { step: 'searching' } },
        ] as unknown as Message[],
        'partial ans',
      ),
    ).toEqual([])
  })

  it('still skips it when a reasoning message is appended mid-stream', () => {
    expect(
      assistantBubbles(
        [partial, { id: 'r1', role: 'reasoning', content: 'thinking' }] as unknown as Message[],
        'partial ans',
      ),
    ).toEqual([])
  })

  it('renders every message when not streaming', () => {
    expect(
      assistantBubbles(
        [{ id: 'u1', role: 'user', content: 'hi' }, partial] as unknown as Message[],
        '',
      ),
    ).toEqual(['partial ans'])
  })

  it('does not hide an earlier assistant message when the turn has no partial yet', () => {
    // streamingContent is set but the new assistant message is not in the list
    // yet — walking back must not reach past the current turn and hide the
    // previous answer.
    expect(
      assistantBubbles(
        [
          { id: 'a0', role: 'assistant', content: 'previous answer' },
          { id: 'u1', role: 'user', content: 'next question' },
        ] as unknown as Message[],
        'first tokens',
      ),
    ).toEqual(['previous answer'])
  })
})

// ─── Live reasoning (useReasoning) ─────────────────────────────────────────
//
// Unlike assistant text there is no separate streaming slot for reasoning: the
// client streams it into the message in agent.messages, so #reasoning is
// itself the live surface and useReasoning supplies status by id. The text
// therefore renders once while streaming and once settled, never twice.

describe('AgMessageList — live reasoning renders once', () => {
  it('shows the streaming reasoning text once, live, then once settled', async () => {
    const agent = new MockHttpAgent()
    const messages = shallowRef<Message[]>([])
    agent.subscribe({ onMessagesChanged: () => void (messages.value = [...agent.messages]) })

    const host = defineComponent({
      setup() {
        const { getReasoning } = useReasoning(agent as any)
        return () =>
          h(AgMessageList, { messages: messages.value }, {
            reasoning: ({ msg, content }: { msg: Message; content: string }) =>
              h('p', `[${getReasoning(msg.id)?.status}] ${content}`),
          })
      },
    })
    const el = document.createElement('div')
    const app = createApp(host)
    app.mount(el)

    // What the client does for REASONING_MESSAGE_START / CONTENT / END:
    // subscribers first, then it mutates agent.messages and reports the change.
    const input = { runId: 'r1' }
    agent.emit('onReasoningMessageStartEvent', { event: { messageId: 'rm1', role: 'reasoning' }, input })
    const msg = { id: 'rm1', role: 'reasoning', content: '' } as Message & { content: string }
    agent.messages.push(msg)
    agent.emit('onMessagesChanged', {})
    for (const delta of ['Check ', 'zoning']) {
      agent.emit('onReasoningMessageContentEvent', { event: { messageId: 'rm1', delta }, reasoningMessageBuffer: msg.content, input })
      msg.content += delta
      agent.emit('onMessagesChanged', {})
    }
    await nextTick()
    expect(el.textContent).toBe('[streaming] Check zoning')

    agent.emit('onReasoningMessageEndEvent', { event: { messageId: 'rm1' }, input })
    agent.emit('onMessagesChanged', {})
    await nextTick()
    expect(el.textContent).toBe('[complete] Check zoning')
    app.unmount()
  })
})
