import { describe, it, expect } from 'vitest'
import { computed, createApp, defineComponent, effectScope, h, isProxy, nextTick, watch, type PropType } from 'vue'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { ScriptedAgent, EventType } from './helpers/scriptedAgent'
import { useReasoning, type ReasoningMessageEntry } from '../composables/useReasoning'

function setup(options?: Parameters<typeof useReasoning>[1]) {
  const mock = new MockHttpAgent()
  const [result, unmount] = withSetup(() => useReasoning(mock as any, options))
  return { mock, result, unmount }
}

const run = (runId: string) => ({ input: { runId } })

/**
 * Emit a reasoning message's start + content deltas the way the client does
 * (buffer is pre-delta), and add the message to the transcript as it would.
 */
function stream(mock: MockHttpAgent, messageId: string, deltas: string[], runId = 'r1') {
  mock.emit('onReasoningMessageStartEvent', { event: { messageId, role: 'reasoning' }, ...run(runId) })
  mock.messages.push({ id: messageId, role: 'reasoning', content: '' } as any)
  let buffer = ''
  for (const delta of deltas) {
    mock.emit('onReasoningMessageContentEvent', {
      event: { messageId, delta },
      reasoningMessageBuffer: buffer,
      ...run(runId),
    })
    buffer += delta
  }
}

describe('useReasoning', () => {
  it('starts empty and not reasoning', () => {
    const { result, unmount } = setup()
    expect(result.reasoningMessages.value.size).toBe(0)
    expect(result.openSpans.value.size).toBe(0)
    expect(result.isReasoning.value).toBe(false)
    unmount()
  })

  describe('reasoning messages', () => {
    it('accumulates text live, keyed by messageId, before the message ends', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', ['Weigh', 'ing the', ' options'])

      const entry = result.getReasoning('rm1')!
      expect(entry.content).toBe('Weighing the options')
      expect(entry.status).toBe('streaming')
      expect(result.streamingMessages.value.map((m) => m.id)).toEqual(['rm1'])
      expect(result.isReasoning.value).toBe(true)
      unmount()
    })

    it('completes on REASONING_MESSAGE_END with timing', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', ['done'])
      mock.emit('onReasoningMessageEndEvent', { event: { messageId: 'rm1' }, ...run('r1') })

      const entry = result.getReasoning('rm1')!
      expect(entry.status).toBe('complete')
      expect(entry.completedAt).toBeInstanceOf(Date)
      expect(entry.duration).toBeGreaterThanOrEqual(0)
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })

    it('reports a reasoning message that arrives outside any span', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', ['no span here'])

      expect(result.openSpans.value.size).toBe(0)
      expect(result.getReasoning('rm1')?.content).toBe('no span here')
      expect(result.isReasoning.value).toBe(true)
      unmount()
    })

    it('exposes subagentRunId as an opaque field, without grouping', () => {
      const { mock, result, unmount } = setup()
      mock.emit('onReasoningMessageStartEvent', {
        event: { messageId: 'rm1', role: 'reasoning', subagentRunId: 'sub_1' },
        ...run('r1'),
      })
      mock.emit('onReasoningMessageStartEvent', { event: { messageId: 'rm2', role: 'reasoning' }, ...run('r1') })

      expect(result.getReasoning('rm1')?.subagentRunId).toBe('sub_1')
      expect(result.getReasoning('rm2')).not.toHaveProperty('subagentRunId')
      // Flat: both entries sit side by side in one map.
      expect([...result.reasoningMessages.value.keys()]).toEqual(['rm1', 'rm2'])
      unmount()
    })

    it('records an encrypted value for a reasoning message, not for a tool call', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', [])
      mock.emit('onReasoningEncryptedValueEvent', {
        event: { subtype: 'tool-call', entityId: 'rm1', encryptedValue: 'TOOL' },
      })
      expect(result.getReasoning('rm1')?.encryptedValue).toBeUndefined()

      mock.emit('onReasoningEncryptedValueEvent', {
        event: { subtype: 'message', entityId: 'rm1', encryptedValue: 'ENC' },
      })
      expect(result.getReasoning('rm1')?.encryptedValue).toBe('ENC')
      unmount()
    })
  })

  describe('spans', () => {
    it('tracks an open span until REASONING_END', () => {
      const { mock, result, unmount } = setup()
      mock.emit('onReasoningStartEvent', { event: { messageId: 's1', subagentRunId: 'sub_1' }, ...run('r1') })

      expect(result.openSpans.value.get('s1')).toMatchObject({ id: 's1', subagentRunId: 'sub_1' })
      expect(result.isReasoning.value).toBe(true)

      mock.emit('onReasoningEndEvent', { event: { messageId: 's1' }, ...run('r1') })
      expect(result.openSpans.value.size).toBe(0)
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })

    it('keeps spans and messages in separate namespaces, even under the same id', () => {
      const { mock, result, unmount } = setup()
      mock.emit('onReasoningStartEvent', { event: { messageId: 'x' }, ...run('r1') })
      stream(mock, 'x', ['text'])
      mock.emit('onReasoningEndEvent', { event: { messageId: 'x' }, ...run('r1') })

      // Closing the span does not end the message.
      expect(result.openSpans.value.size).toBe(0)
      expect(result.getReasoning('x')?.status).toBe('streaming')
      expect(result.isReasoning.value).toBe(true)
      unmount()
    })
  })

  describe('run boundaries', () => {
    it('closes what a failed run left open, as error', () => {
      const { mock, result, unmount } = setup()
      mock.emit('onReasoningStartEvent', { event: { messageId: 's1' }, ...run('r1') })
      stream(mock, 'rm1', ['partial'])
      mock.emit('onRunErrorEvent', { event: { message: 'boom' }, ...run('r1') })

      expect(result.openSpans.value.size).toBe(0)
      expect(result.getReasoning('rm1')).toMatchObject({ status: 'error', content: 'partial' })
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })

    it('closes on onRunFailed and onRunFinalized too (no stuck indicator)', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', ['a'], 'r1')
      mock.emit('onRunFailed', { error: new Error('x'), ...run('r1') })
      expect(result.getReasoning('rm1')?.status).toBe('error')

      mock.emit('onRunStartedEvent', run('r2'))
      mock.emit('onReasoningStartEvent', { event: { messageId: 's2' }, ...run('r2') })
      mock.emit('onRunFinalized', run('r2'))
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })

    it('a late RUN_ERROR from an aborted run does not close the next run', () => {
      const { mock, result, unmount } = setup({ autoClear: false })
      stream(mock, 'old', ['a'], 'r1')
      mock.emit('onRunStartedEvent', run('r2'))
      stream(mock, 'new', ['b'], 'r2')

      // HttpAgent emits a synthetic RUN_ERROR for the aborted run, possibly late.
      mock.emit('onRunErrorEvent', { event: { message: 'aborted', code: 'abort' }, ...run('r1') })

      expect(result.getReasoning('new')?.status).toBe('streaming')
      unmount()
    })

    it('a new run closes what an earlier run left open and clears its messages', () => {
      const { mock, result, unmount } = setup()
      mock.emit('onReasoningStartEvent', { event: { messageId: 's1' }, ...run('r1') })
      stream(mock, 'rm1', ['a'], 'r1')

      mock.emit('onRunStartedEvent', run('r2'))
      expect(result.openSpans.value.size).toBe(0)
      expect(result.reasoningMessages.value.size).toBe(0)
      unmount()
    })

    it('keeps earlier runs’ messages with autoClear: false, closed', () => {
      const { mock, result, unmount } = setup({ autoClear: false })
      stream(mock, 'rm1', ['a'], 'r1')
      mock.emit('onRunStartedEvent', run('r2'))

      expect(result.getReasoning('rm1')?.status).toBe('error')
      unmount()
    })
  })

  describe('following the transcript', () => {
    it('drops a settled entry whose message left agent.messages, keeps a streaming one', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'settled', ['a'])
      mock.emit('onReasoningMessageEndEvent', { event: { messageId: 'settled' }, ...run('r1') })
      stream(mock, 'live', ['b'])

      mock.messages = [] // e.g. a thread switch
      mock.emit('onMessagesChanged', {})

      expect(result.getReasoning('settled')).toBeUndefined()
      expect(result.getReasoning('live')).toBeDefined()
      unmount()
    })

    // reset() mid-thought: the prune above skips the still-streaming entry, then
    // the aborted run's late RUN_ERROR arrives. It must not leave an errored
    // entry from the old conversation in the fresh one.
    it('a run ending after its message left the transcript drops the entry instead of erroring it', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'old', ['thinking'], 'r1')

      mock.messages = [] // reset()
      mock.emit('onMessagesChanged', {})
      expect(result.getReasoning('old')?.status).toBe('streaming')

      mock.emit('onRunErrorEvent', { event: { message: 'aborted', code: 'abort' }, ...run('r1') })
      expect(result.reasoningMessages.value.size).toBe(0)
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })
  })

  describe('reactivity', () => {
    it('entries are plain objects, not deep proxies', () => {
      const { mock, result, unmount } = setup()
      stream(mock, 'rm1', ['a'])
      expect(isProxy(result.reasoningMessages.value)).toBe(false)
      expect(isProxy(result.getReasoning('rm1'))).toBe(false)
      unmount()
    })

    it('a plain watch() fires once per streamed delta (in-place mutation, no Map clone)', async () => {
      const { mock, result, unmount } = setup()
      const mapBefore = result.reasoningMessages.value
      let fired = 0
      const stop = watch(result.reasoningMessages, () => fired++, { flush: 'sync' })

      stream(mock, 'rm1', ['a', 'b', 'c'])
      await nextTick()

      expect(fired).toBe(4) // start + 3 deltas
      expect(result.reasoningMessages.value).toBe(mapBefore)
      stop()
      unmount()
    })
  })

  describe('entries passed to child components', () => {
    // Entries are plain objects, so an in-place `status = 'complete'` would never
    // reach a child holding the entry as a prop: same identity, untracked field.
    // The demo's thinking spinner kept spinning after the answer had arrived.
    it('a child receiving an entry as a prop sees it complete', async () => {
      const mock = new MockHttpAgent()
      const Child = defineComponent({
        props: { live: { type: Object as PropType<ReasoningMessageEntry>, required: true } },
        setup(props) {
          const label = computed(() => (props.live.status === 'streaming' ? 'Thinking…' : 'Done'))
          return () => h('span', `${label.value} ${props.live.content}`)
        },
      })
      const el = document.createElement('div')
      const app = createApp(
        defineComponent({
          setup() {
            const { getReasoning } = useReasoning(mock as any)
            return () => {
              const live = getReasoning('rm1')
              return live ? h(Child, { live }) : null
            }
          },
        }),
      )
      app.mount(el)

      stream(mock, 'rm1', ['Check ', 'zoning'])
      await nextTick()
      expect(el.textContent).toBe('Thinking… Check zoning')

      mock.emit('onReasoningMessageEndEvent', { event: { messageId: 'rm1' }, ...run('r1') })
      await nextTick()
      expect(el.textContent).toBe('Done Check zoning')
      app.unmount()
    })
  })

  describe('lifecycle', () => {
    it('unsubscribes on unmount', () => {
      const { mock, unmount } = setup()
      expect(mock.subscriberCount).toBe(1)
      unmount()
      expect(mock.subscriberCount).toBe(0)
    })

    it('works inside a detached effectScope and cleans up on stop()', () => {
      const mock = new MockHttpAgent()
      const scope = effectScope(true)
      const result = scope.run(() => useReasoning(mock as any))!
      stream(mock, 'rm1', ['a'])
      expect(result.getReasoning('rm1')?.content).toBe('a')

      scope.stop()
      expect(mock.subscriberCount).toBe(0)
    })
  })

  // Against the real client: the live entry matches the message the client
  // materialises, at every step, including a REASONING_MESSAGE_CHUNK the client
  // expands outside any span.
  describe('with the real client', () => {
    it('stays in lockstep with agent.messages and settles complete', async () => {
      const agent = new ScriptedAgent([
        { type: EventType.REASONING_START, messageId: 's1' },
        { type: EventType.REASONING_MESSAGE_START, messageId: 'rm1', role: 'reasoning' },
        { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm1', delta: 'Check ' },
        { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm1', delta: 'the permit' },
        { type: EventType.REASONING_MESSAGE_END, messageId: 'rm1' },
        { type: EventType.REASONING_END, messageId: 's1' },
        { type: EventType.REASONING_MESSAGE_CHUNK, messageId: 'rm2', delta: 'outside a span' },
      ])
      const [result, unmount] = withSetup(() => useReasoning(agent as any, { autoClear: false }))

      const mismatches: string[] = []
      agent.subscribe({
        onMessagesChanged: () => {
          for (const m of agent.messages) {
            const live = result.getReasoning(m.id)
            if (m.role === 'reasoning' && live?.content !== m.content) mismatches.push(`${m.id}: ${live?.content} ≠ ${m.content}`)
          }
        },
      })
      await agent.runAgent({ runId: 'r1' })

      expect(mismatches).toEqual([])
      expect(result.getReasoning('rm1')).toMatchObject({ content: 'Check the permit', status: 'complete' })
      expect(result.getReasoning('rm2')).toMatchObject({ content: 'outside a span', status: 'complete' })
      expect(result.isReasoning.value).toBe(false)
      unmount()
    })
  })
})
