import { describe, it, expect } from 'vitest'
import { effectScope, isProxy, watch } from 'vue'
import type { Message } from '@ag-ui/core'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { ScriptedAgent, EventType } from './helpers/scriptedAgent'
import { useActivities } from '../composables/useActivities'

const snapshot = (messageId: string, content: object, extra: object = {}) => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId,
  activityType: 'records-search',
  content,
  ...extra,
})

const delta = (messageId: string, patch: object[]) => ({
  type: EventType.ACTIVITY_DELTA,
  messageId,
  activityType: 'records-search',
  patch,
})

/** Run a scripted stream through the real client, observing it with useActivities. */
async function runScripted(events: object[]) {
  const agent = new ScriptedAgent(events)
  const [result, unmount] = withSetup(() => useActivities(agent as any))
  await agent.runAgent({ runId: 'r1' })
  return { agent, result, unmount }
}

describe('useActivities', () => {
  describe('with the real client', () => {
    it('shows the snapshot with deltas applied, keyed by messageId, with activityType', async () => {
      const { result, unmount } = await runScripted([
        snapshot('a1', { searched: 0, total: 12, sources: [] }),
        delta('a1', [
          { op: 'replace', path: '/searched', value: 3 },
          { op: 'add', path: '/sources/-', value: 'Land registry' },
        ]),
      ])

      const activity = result.getActivity('a1')!
      expect(activity.activityType).toBe('records-search')
      expect(activity.content).toEqual({ searched: 3, total: 12, sources: ['Land registry'] })
      unmount()
    })

    it('updates live, before the run ends', async () => {
      const agent = new ScriptedAgent([
        snapshot('a1', { searched: 0 }),
        delta('a1', [{ op: 'replace', path: '/searched', value: 1 }]),
        delta('a1', [{ op: 'replace', path: '/searched', value: 2 }]),
      ])
      const [result, unmount] = withSetup(() => useActivities(agent as any))
      const seen: unknown[] = []
      watch(result.activities, (map) => seen.push(map.get('a1')?.content.searched), { flush: 'sync' })

      await agent.runAgent({ runId: 'r1' })

      expect(seen).toEqual([0, 1, 2])
      unmount()
    })

    it('replaces rather than merges on a snapshot for an existing messageId', async () => {
      const { result, unmount } = await runScripted([
        snapshot('a1', { searched: 3, stale: true }),
        snapshot('a1', { phase: 'summarising' }, { replace: true }),
      ])
      expect(result.getActivity('a1')!.content).toEqual({ phase: 'summarising' })
      unmount()
    })

    it('replaces by default, when replace is omitted', async () => {
      const { result, unmount } = await runScripted([
        snapshot('a1', { searched: 3 }),
        snapshot('a1', { phase: 'done' }),
      ])
      expect(result.getActivity('a1')!.content).toEqual({ phase: 'done' })
      unmount()
    })

    it('keeps existing content on replace: false', async () => {
      const { result, unmount } = await runScripted([
        snapshot('a1', { searched: 3 }),
        snapshot('a1', { phase: 'ignored' }, { replace: false }),
      ])
      expect(result.getActivity('a1')!.content).toEqual({ searched: 3 })
      unmount()
    })

    it('keeps the content a structured object', async () => {
      const { result, unmount } = await runScripted([snapshot('a1', { nested: { step: 2, of: 5 } })])
      const content = result.getActivity('a1')!.content
      expect(typeof content).toBe('object')
      expect(content.nested).toEqual({ step: 2, of: 5 })
      unmount()
    })

    // The client clones every message on every update, so an activity's object
    // changes on each text token even though the activity did not.
    it('does not signal when a text token streams while an activity is in the transcript', async () => {
      const agent = new ScriptedAgent([
        snapshot('a1', { searched: 3 }),
        { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Found ' },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'three' },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      ])
      const [result, unmount] = withSetup(() => useActivities(agent as any))
      let fired = 0
      watch(result.activities, () => fired++, { flush: 'sync' })

      await agent.runAgent({ runId: 'r1' })

      expect(fired).toBe(1) // the snapshot, nothing after it
      expect(result.getActivity('a1')!.content).toEqual({ searched: 3 })
      expect(result.activityList.value[0]).toBe(result.getActivity('a1'))
      unmount()
    })

    it('exposes subagentRunId as an opaque field, without grouping', async () => {
      const { result, unmount } = await runScripted([
        snapshot('a1', {}, { subagentRunId: 'sub_1' }),
        snapshot('a2', {}),
      ])
      expect(result.getActivity('a1')!.subagentRunId).toBe('sub_1')
      expect(result.getActivity('a2')).not.toHaveProperty('subagentRunId')
      expect(result.activityList.value.map((a) => a.id)).toEqual(['a1', 'a2'])
      unmount()
    })
  })

  describe('following the transcript', () => {
    function setup(initial: Message[] = []) {
      const mock = new MockHttpAgent()
      mock.messages = initial
      const [result, unmount] = withSetup(() => useActivities(mock as any))
      return { mock, result, unmount }
    }
    const activity = (id: string, content: object = {}) =>
      ({ id, role: 'activity', activityType: 'records-search', content }) as Message

    it('picks up activities already in the transcript', () => {
      const { result, unmount } = setup([{ id: 'u1', role: 'user', content: 'hi' }, activity('a1')])
      expect(result.activityList.value.map((a) => a.id)).toEqual(['a1'])
      unmount()
    })

    it('drops activities that leave the transcript and adds the new ones (thread switch)', () => {
      const { mock, result, unmount } = setup([activity('a1')])
      mock.messages = [activity('b1'), activity('b2')]
      mock.emit('onMessagesChanged', {})
      expect(result.activityList.value.map((a) => a.id)).toEqual(['b1', 'b2'])
      expect(result.getActivity('a1')).toBeUndefined()
      unmount()
    })

    it('lists activities in transcript order', () => {
      const { mock, result, unmount } = setup([activity('a2')])
      mock.messages = [activity('a1'), activity('a2')]
      mock.emit('onMessagesChanged', {})
      expect(result.activityList.value.map((a) => a.id)).toEqual(['a1', 'a2'])
      unmount()
    })

    // The real-client case is above ("…while an activity is in the transcript");
    // this one pins the comparison: a fresh but equal object is not a change.
    it('does not signal for an equal copy of an activity, and keeps the entry it has', () => {
      const { mock, result, unmount } = setup([activity('a1', { step: 1 })])
      const before = result.getActivity('a1')
      let fired = 0
      watch(result.activities, () => fired++, { flush: 'sync' })

      mock.messages = [activity('a1', { step: 1 }), { id: 'm1', role: 'assistant', content: 'tok' }]
      mock.emit('onMessagesChanged', {})
      expect(fired).toBe(0)
      expect(result.getActivity('a1')).toBe(before)

      mock.messages = [activity('a1', { step: 2 }), ...mock.messages.slice(1)]
      mock.emit('onMessagesChanged', {})
      expect(fired).toBe(1)
      expect(result.getActivity('a1')!.content).toEqual({ step: 2 })
      unmount()
    })

    it('holds the client’s objects without deep-proxying them', () => {
      const { result, unmount } = setup([activity('a1', { step: 1 })])
      expect(isProxy(result.activities.value)).toBe(false)
      expect(isProxy(result.getActivity('a1'))).toBe(false)
      unmount()
    })
  })

  describe('lifecycle', () => {
    it('unsubscribes on unmount', () => {
      const mock = new MockHttpAgent()
      const [, unmount] = withSetup(() => useActivities(mock as any))
      expect(mock.subscriberCount).toBe(1)
      unmount()
      expect(mock.subscriberCount).toBe(0)
    })

    it('works inside a detached effectScope and cleans up on stop()', () => {
      const mock = new MockHttpAgent()
      const scope = effectScope(true)
      const result = scope.run(() => useActivities(mock as any))!
      mock.messages = [{ id: 'a1', role: 'activity', activityType: 't', content: {} }]
      mock.emit('onMessagesChanged', {})
      expect(result.getActivity('a1')).toBeDefined()

      scope.stop()
      expect(mock.subscriberCount).toBe(0)
    })
  })
})
