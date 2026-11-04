import { describe, it, expect, beforeEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup'
import { useAgent } from '../composables/useAgent'
import { useAgentEvent } from '../composables/useAgentEvent'
import { useFrontendTool } from '../composables/useFrontendTool'
import { useInterrupts } from '../composables/useInterrupts'
import { useReasoning } from '../composables/useReasoning'
import { useActivities } from '../composables/useActivities'
import { ScriptedAgent } from './helpers/scriptedAgent'
import type { Interrupt, Message } from '@ag-ui/core'
import {
  MemoryAdapter,
  LocalStorageAdapter,
  useThread,
  useThreads,
  type ThreadStorageAdapter,
  type UseThreadOptions,
  type UseThreadReturn,
  type UseThreadsOptions,
  type UseThreadsReturn,
} from '../composables/useThreads'
import type { PersistedThread, ThreadMeta } from '../composables/useThreads'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import type { MockHttpAgent as MockHttpAgentType } from './helpers/mockHttpAgent'

// useAgent creates HttpAgent internally. Mock @ag-ui/client so it constructs a
// MockHttpAgent instead. The threads layer now takes the injected useAgent
// return, so tests construct the agent exactly as a consumer would.
// Only HttpAgent is stubbed — the rest of the module (notably `randomUUID`)
// stays real.
vi.mock('@ag-ui/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ag-ui/client')>()
  const { MockHttpAgent } = await import('./helpers/mockHttpAgent')
  return { ...actual, HttpAgent: MockHttpAgent }
})

function getMock(agent: any): MockHttpAgentType {
  return agent as MockHttpAgentType
}

/** The single agent constructed for the current test (see reset in beforeEach). */
const soleAgent = () => getMock(MockHttpAgent.instances[MockHttpAgent.instances.length - 1])

beforeEach(() => {
  MockHttpAgent.instances.length = 0
})

/**
 * Resolve all pending microtasks (and one macrotask). A single call drains the
 * entire microtask cascade — async hydration, the run-completion watcher, and
 * the adapter's `Promise.resolve` writes — because the event loop empties the
 * microtask queue completely before running the `setTimeout(0)` macrotask.
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Mounts `useThread` against a freshly-injected `useAgent`, inside a real
// component so lifecycle hooks (final-flush on unmount) fire correctly.
function mountThread(options: UseThreadOptions): [UseThreadReturn, () => void] {
  return withSetup(() => useThread(useAgent({ url: 'http://test' }), options))
}

// Mounts `useThreads` against a freshly-injected `useAgent`.
function mountThreads(options: UseThreadsOptions = {}): [UseThreadsReturn, () => void] {
  return withSetup(() => useThreads(useAgent({ url: 'http://test' }), options))
}

// Drives a full tool-call lifecycle for the given tool name through the mock.
function emitToolCall(mock: MockHttpAgentType, name: string, id: string, args: object) {
  mock.emit('onToolCallStartEvent', { event: { toolCallId: id, toolCallName: name } })
  mock.emit('onToolCallArgsEvent', { event: { toolCallId: id, delta: JSON.stringify(args) } })
  return mock.emit('onToolCallEndEvent', { event: { toolCallId: id } })
}

// ─── MemoryAdapter ─────────────────────────────────────────────────────────

describe('MemoryAdapter', () => {
  it('starts empty', async () => {
    const adapter = new MemoryAdapter()
    expect(await adapter.listThreads()).toEqual([])
  })

  it('saves and loads a thread', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save(makePersistedThread('t1'))
    expect(await adapter.listThreads()).toHaveLength(1)
    expect((await adapter.load('t1'))?.meta.id).toBe('t1')
  })

  it('load returns null for a missing thread', async () => {
    const adapter = new MemoryAdapter()
    expect(await adapter.load('nope')).toBeNull()
  })

  it('overwrites when saving the same id', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save(makePersistedThread('t1', 'old'))
    await adapter.save(makePersistedThread('t1', 'new'))
    expect(await adapter.listThreads()).toHaveLength(1)
    expect((await adapter.load('t1'))?.meta.title).toBe('new')
  })

  it('deletes a thread', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save(makePersistedThread('t1'))
    await adapter.save(makePersistedThread('t2'))
    await adapter.delete('t1')
    const all = await adapter.listThreads()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('t2')
  })

  it('keeps real Date objects on meta across the round-trip', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save(makePersistedThread('t1'))
    const loaded = await adapter.load('t1')
    expect(loaded?.meta.createdAt).toBeInstanceOf(Date)
    expect(loaded?.meta.updatedAt).toBeInstanceOf(Date)
  })

  it('isolates stored references (mutating a load result does not mutate the store)', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save({ meta: makeMeta('t1'), messages: [], state: { count: 1 } })
    const loaded = (await adapter.load('t1'))!
    ;(loaded.state as any).count = 999
    expect(((await adapter.load('t1'))!.state as any).count).toBe(1)
  })
})

// ─── LocalStorageAdapter ───────────────────────────────────────────────────

describe('LocalStorageAdapter', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty', async () => {
    const adapter = new LocalStorageAdapter('test-ns')
    expect(await adapter.listThreads()).toEqual([])
  })

  it('saves and loads', async () => {
    const adapter = new LocalStorageAdapter('test-ns')
    await adapter.save(makePersistedThread('t1', 'Hello'))
    const all = await adapter.listThreads()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Hello')
    expect((await adapter.load('t1'))?.meta.title).toBe('Hello')
  })

  it('restores Date objects from JSON', async () => {
    const adapter = new LocalStorageAdapter('test-ns')
    await adapter.save(makePersistedThread('t1'))
    const loaded = (await adapter.load('t1'))!
    expect(loaded.meta.createdAt).toBeInstanceOf(Date)
    expect(loaded.meta.updatedAt).toBeInstanceOf(Date)
    const listed = await adapter.listThreads()
    expect(listed[0].updatedAt).toBeInstanceOf(Date)
  })

  it('overwrites on same id', async () => {
    const adapter = new LocalStorageAdapter('test-ns')
    await adapter.save(makePersistedThread('t1', 'v1'))
    await adapter.save(makePersistedThread('t1', 'v2'))
    expect(await adapter.listThreads()).toHaveLength(1)
    expect((await adapter.load('t1'))?.meta.title).toBe('v2')
  })

  it('deletes a thread', async () => {
    const adapter = new LocalStorageAdapter('test-ns')
    await adapter.save(makePersistedThread('t1'))
    await adapter.save(makePersistedThread('t2'))
    await adapter.delete('t1')
    const all = await adapter.listThreads()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('t2')
  })

  it('uses a namespace key to isolate storage', async () => {
    const a = new LocalStorageAdapter('ns-a')
    const b = new LocalStorageAdapter('ns-b')
    await a.save(makePersistedThread('t1'))
    expect(await a.listThreads()).toHaveLength(1)
    expect(await b.listThreads()).toHaveLength(0)
  })

  it('handles corrupt localStorage gracefully', async () => {
    localStorage.setItem('ag-ui-threads:threads', 'not-json')
    const adapter = new LocalStorageAdapter()
    expect(await adapter.listThreads()).toEqual([])
    expect(await adapter.load('anything')).toBeNull()
  })
})

// ─── useThread ─────────────────────────────────────────────────────────────

describe('useThread', () => {
  describe('initial state (no persisted data)', () => {
    it('starts with empty messages', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.messages.value).toEqual([])
      unmount()
    })

    it('has correct initial meta id', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'my-thread', adapter })
      await flush()
      expect(thread.meta.value!.id).toBe('my-thread')
      unmount()
    })

    it('starts with null title', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.meta.value!.title).toBeNull()
      unmount()
    })

    it('starts not running', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.isRunning.value).toBe(false)
      unmount()
    })

    it('resolves isLoading to false after hydration', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      expect(thread.isLoading.value).toBe(true)
      await flush()
      expect(thread.isLoading.value).toBe(false)
      unmount()
    })
  })

  describe('hydration from persisted data', () => {
    it('loads persisted messages', async () => {
      const adapter = new MemoryAdapter()
      const msg = { id: 'msg1', role: 'user' as const, content: 'hello' }
      await adapter.save({ meta: makeMeta('tid', 'Existing thread'), messages: [msg], state: null })

      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.messages.value).toHaveLength(1)
      expect(thread.messages.value[0].content).toBe('hello')
      unmount()
    })

    it('restores thread title from meta', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid', 'My saved title'), messages: [], state: null })

      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.meta.value!.title).toBe('My saved title')
      unmount()
    })

    it('restores persisted state', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { count: 42 } })

      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      expect(thread.state).toEqual({ count: 42 })
      unmount()
    })

    it('falls back to initialState when persisted state is null (new thread)', async () => {
      const adapter = new MemoryAdapter()
      // createThread persists state: null for new threads
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: null })

      const [thread, unmount] = mountThread({
        id: 'tid',
        adapter,
        initialState: { items: [] as string[] },
      })
      await flush()

      // The shaped default seeds the reactive state, so nested mutation works.
      expect(thread.state).toEqual({ items: [] })
      expect(() => (thread.state as any).items.push('x')).not.toThrow()
      expect(thread.state.items).toEqual(['x'])
      unmount()
    })

    it('persisted state takes precedence over initialState', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { items: ['saved'] } })

      const [thread, unmount] = mountThread({
        id: 'tid',
        adapter,
        initialState: { items: [] as string[] },
      })
      await flush()
      expect(thread.state.items).toEqual(['saved'])
      unmount()
    })

    it('fully replaces state on hydration — default keys absent from the saved state do not leak', async () => {
      const adapter = new MemoryAdapter()
      // Saved thread has `items` but no `draft` (e.g. an older shape).
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { items: ['a'] } })

      const [thread, unmount] = mountThread({
        id: 'tid',
        adapter,
        // Default carries an extra `draft` key the saved thread lacks.
        initialState: { items: [] as string[], draft: 'seed' },
      })
      await flush()

      // The loaded thread must reflect exactly what was saved — no leaked `draft`.
      expect(thread.state).toEqual({ items: ['a'] })
      expect('draft' in thread.state).toBe(false)
      unmount()
    })
  })

  describe('hydration gate', () => {
    it('does not run the agent until hydration resolves', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid')])
      adapter.delay = 40
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      const mock = getMock(thread.agent)

      const sendPromise = thread.send('hi')
      // Microtasks drain but the 40ms load is still pending — the run must wait.
      await flush()
      expect(mock.runAgent).not.toHaveBeenCalled()

      await sendPromise
      expect(mock.runAgent).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('hydrated state reaches agent.state before the first run', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { count: 7 } })

      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      const mock = getMock(thread.agent)

      await thread.send('hi')
      // useAgentState's outbound watch pushed the hydrated state during hydrate().
      expect(mock.state).toEqual({ count: 7 })
      unmount()
    })
  })

  describe('switching threads (load) on one agent', () => {
    it('persists the outgoing thread, then hydrates the incoming one', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('a'), messages: [], state: { v: 'A' } })
      await adapter.save({ meta: makeMeta('b'), messages: [], state: { v: 'B' } })

      const [thread, unmount] = mountThread({ id: 'a', adapter, saveDebounceMs: 5 })
      await flush()

      // Edit A, then switch to B.
      ;(thread.state as any).v = 'A2'
      await thread.load('b')

      // Outgoing A was flushed to disk; incoming B is now active.
      expect((await adapter.load('a'))?.state).toEqual({ v: 'A2' })
      expect(thread.state).toEqual({ v: 'B' })
      unmount()
    })

    it('shows the correct state across switch and back (no stale carry-over)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('a'), messages: [], state: { v: 'A' } })
      await adapter.save({ meta: makeMeta('b'), messages: [], state: { v: 'B' } })

      const [thread, unmount] = mountThread({ id: 'a', adapter })
      await flush()
      expect(thread.state).toEqual({ v: 'A' })

      await thread.load('b')
      expect(thread.state).toEqual({ v: 'B' })

      await thread.load('a')
      expect(thread.state).toEqual({ v: 'A' })
      unmount()
    })

    it('resets to initialState when switching to a new (null-state) thread — the #2268 failure mode', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('a'), messages: [], state: { picked: 'red' } })
      await adapter.save({ meta: makeMeta('fresh'), messages: [], state: null })

      const [thread, unmount] = mountThread({
        id: 'a',
        adapter,
        initialState: { picked: null as string | null },
      })
      await flush()
      expect(thread.state).toEqual({ picked: 'red' })

      // Switching to the fresh (null-state) thread must NOT carry 'red' over.
      await thread.load('fresh')
      expect(thread.state).toEqual({ picked: null })
      unmount()
    })

    it('swaps the message history on switch', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        meta: makeMeta('a'),
        messages: [{ id: 'ma', role: 'user' as const, content: 'from A' }],
        state: null,
      })
      await adapter.save({
        meta: makeMeta('b'),
        messages: [{ id: 'mb', role: 'user' as const, content: 'from B' }],
        state: null,
      })

      const [thread, unmount] = mountThread({ id: 'a', adapter })
      await flush()
      expect(thread.messages.value[0].content).toBe('from A')

      await thread.load('b')
      expect(thread.messages.value[0].content).toBe('from B')
      unmount()
    })

    it('does not persist the outgoing thread when persistOutgoing is false', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('a'), messages: [], state: { v: 'A' } })
      await adapter.save({ meta: makeMeta('b'), messages: [], state: { v: 'B' } })

      const [thread, unmount] = mountThread({ id: 'a', adapter })
      await flush()

      ;(thread.state as any).v = 'A-edited'
      await thread.load('b', { persistOutgoing: false })

      // A on disk is untouched — the edit was intentionally dropped.
      expect((await adapter.load('a'))?.state).toEqual({ v: 'A' })
      unmount()
    })
  })

  describe('auto-title', () => {
    it('sets title from first user message when autoTitle is true', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter, autoTitle: true })

      await thread.send('What is the weather?')
      expect(thread.meta.value!.title).toBe('What is the weather?')
      unmount()
    })

    it('does not overwrite an existing title', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid', 'Already set'), messages: [], state: null })
      const [thread, unmount] = mountThread({ id: 'tid', adapter, autoTitle: true })

      await thread.send('Some message')
      expect(thread.meta.value!.title).toBe('Already set')
      unmount()
    })

    it('skips auto-title when autoTitle is false', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter, autoTitle: false })

      await thread.send('Some message')
      expect(thread.meta.value!.title).toBeNull()
      unmount()
    })

    it('truncates long titles to 60 chars', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })

      await thread.send('A'.repeat(100))
      expect(thread.meta.value!.title!.length).toBe(60)
      unmount()
    })

    it('extracts title from first text part in InputContent[]', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })

      await thread.send([
        { type: 'text', text: 'Describe this image' },
        { type: 'image', source: { type: 'data', value: 'abc', mimeType: 'image/png' } },
      ])
      expect(thread.meta.value!.title).toBe('Describe this image')
      unmount()
    })

    it('falls back to Attachment title when InputContent[] has no text part', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })

      await thread.send([
        { type: 'image', source: { type: 'data', value: 'abc', mimeType: 'image/png' } },
      ])
      expect(thread.meta.value!.title).toBe('Attachment')
      unmount()
    })
  })

  describe('updateTitle', () => {
    it('updates meta title and saves to adapter', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await thread.updateTitle('New title')
      expect(thread.meta.value!.title).toBe('New title')
      const persisted = await adapter.load('tid')
      expect(persisted?.meta.title).toBe('New title')
      unmount()
    })

    it('calls onMetaChange callback', async () => {
      const adapter = new MemoryAdapter()
      const onMetaChange = vi.fn()
      const [thread, unmount] = mountThread({ id: 'tid', adapter, onMetaChange })
      await thread.updateTitle('Changed')
      expect(onMetaChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed' }))
      unmount()
    })
  })

  describe('updatedAt tracks activity, not visits', () => {
    const seeded = new Date('2024-01-01').getTime()

    it('does not write or re-stamp a thread that was only visited', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        meta: makeMeta('a'),
        messages: [{ id: 'm1', role: 'user' as const, content: 'hi' }],
        state: { v: 'A' },
      })
      await adapter.save(makePersistedThread('b'))
      const onMetaChange = vi.fn()
      const [thread, unmount] = mountThread({ id: 'a', adapter, onMetaChange })
      await flush()
      const saveSpy = vi.spyOn(adapter, 'save')

      await thread.load('b')
      await thread.load('a')
      unmount()
      await flush()

      expect(saveSpy).not.toHaveBeenCalled()
      expect(onMetaChange).not.toHaveBeenCalled()
      expect((await adapter.load('a'))?.meta.updatedAt.getTime()).toBe(seeded)
      expect((await adapter.load('b'))?.meta.updatedAt.getTime()).toBe(seeded)
    })

    it('re-stamps when the content changed', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('a'), messages: [], state: { v: 'A' } })
      await adapter.save(makePersistedThread('b'))
      const onMetaChange = vi.fn()
      const [thread, unmount] = mountThread({ id: 'a', adapter, onMetaChange })
      await flush()

      ;(thread.state as any).v = 'A2'
      await thread.load('b')

      expect((await adapter.load('a'))!.meta.updatedAt.getTime()).toBeGreaterThan(seeded)
      expect(onMetaChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
      unmount()
    })

    it('keeps updatedAt when the save fails', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid')])
      const onMetaChange = vi.fn()
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5, onMetaChange })
      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))

      adapter.failSave = true
      ;(thread.state as any).foo = 'bar'
      await vi.waitFor(() => expect(thread.error.value).toContain('save failed'))

      expect(thread.meta.value!.updatedAt.getTime()).toBe(seeded)
      expect(onMetaChange).not.toHaveBeenCalled()
      unmount()
    })

    it('writes a rename without re-stamping updatedAt', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('tid'))
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()

      await thread.updateTitle('Renamed')

      const persisted = await adapter.load('tid')
      expect(persisted?.meta.title).toBe('Renamed')
      expect(persisted?.meta.updatedAt.getTime()).toBe(seeded)
      expect(thread.meta.value!.updatedAt.getTime()).toBe(seeded)
      unmount()
    })
  })

  describe('adoptMeta', () => {
    it('keeps a local title whose save has not landed', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid')])
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))

      adapter.failSave = true
      await thread.updateTitle('Local')

      const adopted = thread.adoptMeta({ ...makeMeta('tid', 'Server') })
      expect(adopted?.title).toBe('Local')
      unmount()
    })

    it('ignores meta for another thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('tid'))
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()

      expect(thread.adoptMeta(makeMeta('other', 'Server'))).toBeNull()
      expect(thread.meta.value!.title).toBeNull()
      unmount()
    })
  })

  describe('persistence on run completion', () => {
    it('saves messages to adapter after a run', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })

      await thread.send('hello')
      await flush()

      const persisted = await adapter.load('tid')
      expect(persisted).toBeDefined()
      expect(persisted!.messages.some((m) => m.content === 'hello')).toBe(true)
      unmount()
    })
  })

  describe('debounced persistence of direct mutations', () => {
    it('persists a direct state edit without a run', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { description: '' } })
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })
      await flush()

      ;(thread.state as any).description = 'edited'

      await vi.waitFor(async () => {
        const persisted = await adapter.load('tid')
        expect((persisted?.state as any)?.description).toBe('edited')
      })
      unmount()
    })

    it('coalesces rapid edits into a single write (no storm)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { n: 0 } })
      const saveSpy = vi.spyOn(adapter, 'save')
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 10 })
      await flush()

      ;(thread.state as any).n = 1
      ;(thread.state as any).n = 2
      ;(thread.state as any).n = 3

      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
      expect((await adapter.load('tid'))?.state).toEqual({ n: 3 })
      unmount()
    })

    it('hydration itself does not trigger a write (baseline guard)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { count: 1 } })
      const saveSpy = vi.spyOn(adapter, 'save')
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })
      await flush()
      // Wait well past the debounce window — no save should have been scheduled.
      await new Promise((r) => setTimeout(r, 25))
      expect(saveSpy).not.toHaveBeenCalled()
      unmount()
    })

    it('does not write when an inbound STATE_DELTA matches the baseline', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { count: 1 } })
      const saveSpy = vi.spyOn(adapter, 'save')
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })
      await flush()

      // Agent re-emits the same state we already have on disk.
      getMock(thread.agent).emit('onStateDeltaEvent', { state: { count: 1 } })
      await new Promise((r) => setTimeout(r, 25))
      expect(saveSpy).not.toHaveBeenCalled()
      unmount()
    })
  })

  describe('adapter error handling', () => {
    it('surfaces a load failure as an error and stays usable on default state', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid', 'Saved')])
      adapter.failLoad = true
      const [thread, unmount] = mountThread({ id: 'tid', adapter })

      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))
      expect(thread.error.value).toContain('load failed')

      // Thread remains usable: send still runs against the default state.
      const mock = getMock(thread.agent)
      await expect(thread.send('hi')).resolves.toBeUndefined()
      expect(mock.runAgent).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('gives storage errors no errorCode, and lets a run error take precedence with its own code', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid', 'Saved')])
      adapter.failLoad = true
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))
      expect(thread.error.value).toContain('load failed')
      expect(thread.errorCode.value).toBeNull()

      const mock = getMock(thread.agent)
      mock.emit('onRunErrorEvent', { event: { message: 'Slow down', code: 'rate_limited' } })
      expect(thread.error.value).toBe('Slow down')
      expect(thread.errorCode.value).toBe('rate_limited')

      // A new run clears the run error; the storage error shows again, code-less.
      await thread.send('hi')
      expect(thread.error.value).toContain('load failed')
      expect(thread.errorCode.value).toBeNull()
      unmount()
    })

    it('does not clobber the unread thread when the initial load failed', async () => {
      // A real thread exists on disk, but the initial load rejects transiently.
      const adapter = new FakeAsyncAdapter([
        {
          meta: makeMeta('tid', 'Saved'),
          messages: [{ id: 'm1', role: 'user' as const, content: 'keep me' }],
          state: { v: 'real' },
        },
      ])
      adapter.failLoad = true
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })

      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))
      expect(thread.error.value).toContain('load failed')

      // Edit on top of the (empty) default, then unmount — neither the debounced
      // save nor the unmount flush may overwrite the thread we couldn't read.
      ;(thread.state as any).v = 'overwritten'
      unmount()
      await new Promise((r) => setTimeout(r, 20))

      // Recover the adapter and inspect disk — it must be untouched.
      adapter.failLoad = false
      const persisted = await adapter.load('tid')
      expect(persisted?.messages).toHaveLength(1)
      expect(persisted?.messages[0].content).toBe('keep me')
      expect(persisted?.state).toEqual({ v: 'real' })
      expect(persisted?.meta.title).toBe('Saved')
    })

    it('reports a save failure rather than swallowing it', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('tid')])
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })
      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))

      adapter.failSave = true
      ;(thread.state as any).foo = 'bar'

      await vi.waitFor(() => expect(thread.error.value).toContain('save failed'))
      unmount()
    })

    it('does not poison the baseline on a failed save (an identical retry still writes)', async () => {
      const adapter = new FakeAsyncAdapter([
        { meta: makeMeta('tid'), messages: [], state: { v: 'initial' } },
      ])
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 5 })
      await vi.waitFor(() => expect(thread.isLoading.value).toBe(false))

      // 1. Edit to 'A' while saving is broken → the debounced save fails.
      adapter.failSave = true
      ;(thread.state as any).v = 'A'
      await vi.waitFor(() => expect(thread.error.value).toContain('save failed'))

      // 2. Adapter recovers; a coalesced edit lands back on 'A' (B → A).
      adapter.failSave = false
      ;(thread.state as any).v = 'B'
      ;(thread.state as any).v = 'A'

      // 3. The 'A' edit must reach disk. If the failed save had advanced the
      //    baseline to 'A', this identical save would be skipped and lost.
      await vi.waitFor(async () => {
        expect((await adapter.load('tid'))?.state).toEqual({ v: 'A' })
      })
      unmount()
    })
  })

  describe('cleanup on unmount', () => {
    it('flushes a final save on unmount', async () => {
      const adapter = new MemoryAdapter()
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()
      unmount()
      await flush()
      expect(await adapter.load('tid')).not.toBeNull()
    })

    it('does not clobber the saved thread when unmounted mid-hydration', async () => {
      // Seed a thread with real messages + state.
      const adapter = new FakeAsyncAdapter([
        {
          meta: makeMeta('tid', 'Important'),
          messages: [{ id: 'm1', role: 'user' as const, content: 'keep me' }],
          state: { count: 99 },
        },
      ])
      // Block the load so the "hydration in flight" window is deterministic.
      adapter.blockLoad()
      const saveSpy = vi.spyOn(adapter, 'save')

      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      expect(thread.isLoading.value).toBe(true)

      // Unmount while load is still gated (isLoading === true).
      unmount()
      await flush()

      // The unmounted-mid-hydration thread must not have written anything — a
      // save here would clobber the real thread with empty defaults.
      expect(saveSpy).not.toHaveBeenCalled()

      // Release the gate and let the (now-orphaned) hydration settle.
      adapter.releaseLoad()
      await flush()
      expect(saveSpy).not.toHaveBeenCalled()

      // And the persisted thread is untouched.
      const persisted = await adapter.load('tid')
      expect(persisted?.messages).toHaveLength(1)
      expect(persisted?.messages[0].content).toBe('keep me')
      expect(persisted?.state).toEqual({ count: 99 })
      expect(persisted?.meta.title).toBe('Important')
    })

    it('flushes a pending debounced edit on unmount', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: { v: 'old' } })
      // Long debounce: the timer will NOT fire during the test, so only the
      // unmount flush can persist the edit.
      const [thread, unmount] = mountThread({ id: 'tid', adapter, saveDebounceMs: 100_000 })
      await flush()

      ;(thread.state as any).v = 'edited'
      unmount()
      await flush()

      expect((await adapter.load('tid'))?.state).toEqual({ v: 'edited' })
    })
  })

  describe('run provenance', () => {
    it('persists messageRuns alongside the transcript', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('tid'), messages: [], state: null })
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()

      await thread.send('hello')
      await flush()

      const persisted = await adapter.load('tid')
      const userId = persisted!.messages[0].id
      expect(persisted!.messageRuns?.[userId]).toBe(thread.runForMessage(userId))
      expect(persisted!.messageRuns?.[userId]).toBeTruthy()
      unmount()
    })

    it('restores messageRuns on hydration', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        meta: makeMeta('tid'),
        messages: [{ id: 'm1', role: 'assistant', content: 'hi' } as any],
        state: null,
        messageRuns: { m1: 'run_persisted' },
      })
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()

      expect(thread.runForMessage('m1')).toBe('run_persisted')
      unmount()
    })

    it('reports no run for a thread persisted without provenance', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        meta: makeMeta('tid'),
        messages: [{ id: 'm1', role: 'assistant', content: 'hi' } as any],
        state: null,
      })
      const [thread, unmount] = mountThread({ id: 'tid', adapter })
      await flush()

      expect(thread.runForMessage('m1')).toBeUndefined()
      unmount()
    })

    it('swaps provenance on a thread switch and does not leak across threads', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        meta: makeMeta('a'),
        messages: [{ id: 'ma', role: 'assistant', content: 'a' } as any],
        state: null,
        messageRuns: { ma: 'run_a' },
      })
      await adapter.save({
        meta: makeMeta('b'),
        messages: [{ id: 'mb', role: 'assistant', content: 'b' } as any],
        state: null,
        messageRuns: { mb: 'run_b' },
      })
      const [thread, unmount] = mountThread({ id: 'a', adapter })
      await flush()
      expect(thread.runForMessage('ma')).toBe('run_a')

      await thread.load('b')
      await flush()

      expect(thread.runForMessage('mb')).toBe('run_b')
      expect(thread.runForMessage('ma')).toBeUndefined() // thread A's map is gone
      unmount()
    })
  })

  describe('interrupts', () => {
    const approval: Interrupt = { id: 'int_1', reason: 'confirmation', message: 'Proceed?' }

    // Mounts a thread plus useInterrupts on the same injected agent.
    function mountPausable(options: UseThreadOptions) {
      const [ctx, unmount] = withSetup(() => {
        const agentCtx = useAgent({ url: 'http://test' })
        return { thread: useThread(agentCtx, options), ...useInterrupts(agentCtx) }
      })
      return { ...ctx, mock: getMock(ctx.thread.agent), unmount }
    }

    // Makes the next run end paused on `interrupts`, as the real client reports it.
    function pauseNextRun(mock: MockHttpAgentType, interrupts: Interrupt[]) {
      mock.runAgent.mockImplementationOnce(async () => {
        mock.emit('onRunFinishedEvent', { event: {}, outcome: 'interrupt', interrupts })
        return {}
      })
    }

    it('persists the open interrupts of a paused thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('tid'))
      const { thread, mock, unmount } = mountPausable({ id: 'tid', adapter })
      await flush()

      pauseNextRun(mock, [approval])
      await thread.send('do the thing')
      await flush()

      expect((await adapter.load('tid'))!.interrupts).toEqual([approval])
      unmount()
    })

    it('persists no interrupts for a thread that is not paused', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('tid'))
      const { thread, unmount } = mountPausable({ id: 'tid', adapter })
      await flush()

      await thread.send('hello')
      await flush()

      expect((await adapter.load('tid'))!).not.toHaveProperty('interrupts')
      unmount()
    })

    it('lets the next thread send after switching away from a paused one', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('a'))
      await adapter.save(makePersistedThread('b'))
      const { thread, hasPending, mock, unmount } = mountPausable({ id: 'a', adapter })
      await flush()
      pauseNextRun(mock, [approval])
      await thread.send('do the thing')
      await flush()

      await thread.load('b')
      await thread.send('unrelated question')

      expect(hasPending.value).toBe(false)
      expect(mock.pendingInterrupts).toEqual([])
      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      unmount()
    })

    it('can resume a paused thread after a reload', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({
        ...makePersistedThread('tid'),
        messages: [{ id: 'm1', role: 'user', content: 'do the thing' } as any],
        interrupts: [approval],
      })
      const { thread, interrupts, resumeAll, mock, unmount } = mountPausable({ id: 'tid', adapter })
      await flush()

      expect(mock.pendingInterrupts).toEqual([approval])
      await expect(thread.send('hello')).rejects.toMatchObject({ code: 'interrupts-pending' })
      await interrupts.value[0].resolve('yes')
      await resumeAll()

      expect(mock.runAgent.mock.calls[0][0].resume).toEqual([
        { interruptId: 'int_1', status: 'resolved', payload: 'yes' },
      ])
      unmount()
    })
  })
})

// ─── useThreads ────────────────────────────────────────────────────────────

describe('useThreads', () => {
  describe('initialization', () => {
    it('creates a new thread when adapter is empty', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.threads.value).toHaveLength(1)
      expect(result.activeThreadId.value).not.toBeNull()
      unmount()
    })

    it('resolves isLoading to false after init', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      expect(result.isLoading.value).toBe(true)
      await flush()
      expect(result.isLoading.value).toBe(false)
      unmount()
    })

    it('restores threads from adapter', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1', 'Thread 1'))
      await adapter.save(makePersistedThread('t2', 'Thread 2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.threads.value).toHaveLength(2)
      unmount()
    })

    it('activates the most-recently-updated thread by default', async () => {
      const adapter = new MemoryAdapter()
      const older = makePersistedThread('t-old')
      const newer = makePersistedThread('t-new')
      older.meta.updatedAt = new Date('2024-01-01')
      newer.meta.updatedAt = new Date('2024-06-01')
      await adapter.save(older)
      await adapter.save(newer)

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.activeThreadId.value).toBe('t-new')
      unmount()
    })

    it('activates initialThreadId when specified', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter, initialThreadId: 't2' })
      await flush()
      expect(result.activeThreadId.value).toBe('t2')
      unmount()
    })

    it('constructs exactly one agent for the whole session (stable instance)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      result.switchThread('t1')
      result.switchThread('t2')
      await flush()
      expect(MockHttpAgent.instances).toHaveLength(1)
      unmount()
    })
  })

  describe('createThread()', () => {
    it('adds a thread to the list', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const initialCount = result.threads.value.length
      await result.createThread()
      expect(result.threads.value).toHaveLength(initialCount + 1)
      unmount()
    })

    it('switches to the new thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const id = await result.createThread()
      expect(result.activeThreadId.value).toBe(id)
      unmount()
    })

    it('seeds a new thread with initialState so nested mutation works', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter, initialState: { items: [] as string[] } })
      await flush()
      await result.createThread()
      await flush()
      expect(result.state.value).toEqual({ items: [] })
      expect(() => result.state.value.items.push('x')).not.toThrow()
      unmount()
    })

    it('persists the new thread in the adapter', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const id = await result.createThread()
      expect(await adapter.load(id)).not.toBeNull()
      unmount()
    })

    it('uses an explicitly supplied id as-is', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const id = await result.createThread('my-custom-id')
      expect(id).toBe('my-custom-id')
      expect(result.activeThreadId.value).toBe('my-custom-id')
      expect(result.threads.value.some((t) => t.id === 'my-custom-id')).toBe(true)
      unmount()
    })

    it('round-trips a supplied id through switchThread/load', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      await result.createThread('uuid')
      const other = await result.createThread('other-uuid')
      expect(result.activeThreadId.value).toBe('other-uuid')
      // Switch back; the supplied id resolves via adapter.load.
      result.switchThread('uuid')
      await flush()
      expect(result.activeThreadId.value).toBe('uuid')
      expect(await adapter.load(other)).not.toBeNull()
      unmount()
    })

    it('applies idFactory to per-call creations', async () => {
      const adapter = new MemoryAdapter()
      let n = 0
      const [result, unmount] = mountThreads({ adapter, idFactory: () => `factory-${n++}` })
      await flush()
      const id = await result.createThread()
      expect(id).toBe(`factory-${n - 1}`)
      unmount()
    })

    it('lets a per-call id take precedence over idFactory', async () => {
      const adapter = new MemoryAdapter()
      const idFactory = vi.fn(() => 'from-factory')
      const [result, unmount] = mountThreads({ adapter, idFactory })
      await flush()
      idFactory.mockClear()
      const id = await result.createThread('explicit')
      expect(id).toBe('explicit')
      expect(idFactory).not.toHaveBeenCalled()
      unmount()
    })

    it('applies idFactory to the thread created during empty-store init', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter, idFactory: () => 'init-id' })
      await flush()
      expect(result.activeThreadId.value).toBe('init-id')
      unmount()
    })

    it('falls back to the built-in id scheme when neither is supplied', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const id = await result.createThread()
      expect(id).toMatch(/^thread_\d+_[a-z0-9]+$/)
      unmount()
    })
  })

  describe('switchThread()', () => {
    it('changes the active thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const first = result.activeThreadId.value!
      const other = first === 't1' ? 't2' : 't1'
      result.switchThread(other)
      expect(result.activeThreadId.value).toBe(other)
      unmount()
    })

    it('is a no-op when switching to the already-active thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const current = result.activeThreadId.value!
      result.switchThread(current)
      expect(result.activeThreadId.value).toBe(current)
      unmount()
    })

    it('shows each thread’s own state across switch and back (no stale carry-over)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save({ meta: makeMeta('t1'), messages: [], state: { v: 'one' } })
      await adapter.save({ meta: makeMeta('t2'), messages: [], state: { v: 'two' } })

      const [result, unmount] = mountThreads({ adapter, initialThreadId: 't1' })
      await flush()
      expect(result.state.value).toEqual({ v: 'one' })

      result.switchThread('t2')
      await flush()
      expect(result.state.value).toEqual({ v: 'two' })

      result.switchThread('t1')
      await flush()
      expect(result.state.value).toEqual({ v: 'one' })
      unmount()
    })

    it('keeps a subscription attached to the agent alive across a switch', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))
      const spy = vi.fn()

      const [ctx, unmount] = withSetup(() => {
        const agent = useAgent({ url: 'http://test' })
        useAgentEvent(agent.agent, { onCustomEvent: spy })
        const threads = useThreads(agent, { adapter })
        return { agent, threads }
      })
      await flush()

      const active = ctx.threads.activeThreadId.value!
      ctx.threads.switchThread(active === 't1' ? 't2' : 't1')
      await flush()

      // The subscription set up before the switch still fires afterward.
      getMock(ctx.agent.agent).emit('onCustomEvent', { event: {} })
      expect(spy).toHaveBeenCalled()
      unmount()
    })

    it('runs a frontend tool round-trip after a switch (coordinator subscription survives)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))
      const handler = vi.fn().mockResolvedValue({ ok: true })

      const [ctx, unmount] = withSetup(() => {
        const agent = useAgent({ url: 'http://test' })
        useFrontendTool(agent, {
          name: 'doThing',
          description: 'does a thing',
          parameters: { type: 'object', properties: {} },
          handler,
        })
        const threads = useThreads(agent, { adapter })
        return { agent, threads }
      })
      await flush()

      const active = ctx.threads.activeThreadId.value!
      ctx.threads.switchThread(active === 't1' ? 't2' : 't1')
      await flush()

      // A tool call arriving after the switch still reaches the handler.
      emitToolCall(getMock(ctx.agent.agent), 'doThing', 'call_1', { x: 1 })
      await flush()
      expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ toolCallId: 'call_1' }))
      unmount()
    })
  })

  describe('deleteThread()', () => {
    it('removes the thread from the list', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      await result.deleteThread('t1')
      expect(result.threads.value.some((t) => t.id === 't1')).toBe(false)
      unmount()
    })

    it('removes the thread from the adapter', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      await result.deleteThread('t1')
      expect(await adapter.load('t1')).toBeNull()
      unmount()
    })

    it('auto-switches when deleting the active thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const active = result.activeThreadId.value!
      await result.deleteThread(active)
      expect(result.activeThreadId.value).not.toBeNull()
      expect(result.activeThreadId.value).not.toBe(active)
      unmount()
    })

    it('sets activeThreadId to null when deleting the last thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.threads.value).toHaveLength(1)
      const id = result.threads.value[0].id
      await result.deleteThread(id)
      expect(result.threads.value).toHaveLength(0)
      expect(result.activeThreadId.value).toBeNull()
      unmount()
    })

    it('deletes a non-active thread without disturbing the active one', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      const active = result.activeThreadId.value!
      const inactive = active === 't1' ? 't2' : 't1'
      await result.deleteThread(inactive)
      await flush()

      // Inactive thread gone from list + adapter; active thread untouched.
      expect(result.threads.value.some((t) => t.id === inactive)).toBe(false)
      expect(await adapter.load(inactive)).toBeNull()
      expect(result.activeThreadId.value).toBe(active)
      expect(await adapter.load(active)).not.toBeNull()
      unmount()
    })

    it('does not write the deleted active thread back (no resurrection race)', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1'))
      await adapter.save(makePersistedThread('t2'))
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      const active = result.activeThreadId.value!
      const saveSpy = vi.spyOn(adapter, 'save')
      await result.deleteThread(active)
      await flush()

      // Switching away from the doomed thread must not persist it — a save here
      // would race adapter.delete and could resurrect the thread.
      expect(saveSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ id: active }) }),
      )
      expect(await adapter.load(active)).toBeNull()
      unmount()
    })
  })

  describe('updateTitle()', () => {
    it('updates the title of the active thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const id = result.activeThreadId.value!
      await result.updateTitle(id, 'My title')
      const meta = result.threads.value.find((t) => t.id === id)
      expect(meta?.title).toBe('My title')
      unmount()
    })

    it('updates the title of an inactive thread', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('t1', null))
      await adapter.save(makePersistedThread('t2', null))

      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const inactive = result.activeThreadId.value === 't1' ? 't2' : 't1'
      await result.updateTitle(inactive, 'Background title')
      const meta = result.threads.value.find((t) => t.id === inactive)
      expect(meta?.title).toBe('Background title')
      // And it reached the adapter.
      expect((await adapter.load(inactive))?.meta.title).toBe('Background title')
      unmount()
    })

    it('does not reorder the list', async () => {
      const [result, unmount] = mountThreads({ adapter: await seedOlderAndNewer() })
      await flush()

      await result.updateTitle('older', 'Renamed (inactive)')
      await result.updateTitle('newer', 'Renamed (active)')

      expect(result.threads.value.map((t) => t.id)).toEqual(['newer', 'older'])
      unmount()
    })
  })

  describe('list ordering', () => {
    it('does not move a thread to the top for a visit', async () => {
      const [result, unmount] = mountThreads({ adapter: await seedOlderAndNewer() })
      await flush()
      expect(result.activeThreadId.value).toBe('newer')

      result.switchThread('older')
      await flush()
      result.switchThread('newer')
      await flush()

      expect(result.threads.value.map((t) => t.id)).toEqual(['newer', 'older'])
      unmount()
    })

    it('moves a thread to the top when it gets new messages', async () => {
      const [result, unmount] = mountThreads({ adapter: await seedOlderAndNewer() })
      await flush()

      result.switchThread('older')
      await flush()
      await result.send('hello')
      await flush()

      expect(result.threads.value.map((t) => t.id)).toEqual(['older', 'newer'])
      unmount()
    })
  })

  describe('refresh()', () => {
    it('picks up a title the server set on an inactive thread', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      const older = (await adapter.load('older'))!
      await adapter.save({ ...older, meta: { ...older.meta, title: 'Server title' } })
      await result.refresh()

      expect(result.threads.value.find((t) => t.id === 'older')?.title).toBe('Server title')
      unmount()
    })

    it('adopts a server title on the active thread so the next save keeps it', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      await result.send('hello')
      await flush()

      const active = (await adapter.load('newer'))!
      await adapter.save({ ...active, meta: { ...active.meta, title: 'Greeting' } })
      await result.refresh()
      await result.send('again')
      await flush()

      expect((await adapter.load('newer'))?.meta.title).toBe('Greeting')
      expect(result.activeThread.value?.title).toBe('Greeting')
      unmount()
    })

    it('does not move updatedAt back on a stale list', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      result.switchThread('older')
      await flush()
      await result.send('hello')
      await flush()
      const bumped = result.threads.value.find((t) => t.id === 'older')!.updatedAt.getTime()

      // The adapter answers with the list as it was before that save.
      vi.spyOn(adapter, 'listThreads').mockResolvedValueOnce([
        makeMeta('older'),
        { ...makeMeta('newer'), updatedAt: new Date('2024-06-01') },
      ])
      await result.refresh()

      expect(result.threads.value.map((t) => t.id)).toEqual(['older', 'newer'])
      expect(result.threads.value[0].updatedAt.getTime()).toBe(bumped)
      unmount()
    })

    it('adds threads created elsewhere and drops ones deleted elsewhere', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      await adapter.delete('older')
      await adapter.save(makePersistedThread('elsewhere'))
      await result.refresh()

      expect(result.threads.value.map((t) => t.id).sort()).toEqual(['elsewhere', 'newer'])
      unmount()
    })

    it('does not re-add a thread deleted while the list was being read', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      // listThreads() answers with a list read before the delete landed.
      let answer!: (metas: ThreadMeta[]) => void
      vi.spyOn(adapter, 'listThreads').mockReturnValueOnce(
        new Promise((resolve) => (answer = resolve)),
      )
      const refreshing = result.refresh()
      await result.deleteThread('older')
      answer([makeMeta('older'), { ...makeMeta('newer'), updatedAt: new Date('2024-06-01') }])
      await refreshing

      expect(result.threads.value.map((t) => t.id)).toEqual(['newer'])
      unmount()
    })

    it('keeps the active thread listed when the adapter no longer lists it', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      await adapter.delete('newer')
      await result.refresh()

      expect(result.threads.value.map((t) => t.id)).toEqual(['newer', 'older'])
      expect(result.activeThread.value?.id).toBe('newer')
      unmount()
    })

    it('rejects and leaves the list as is when listThreads fails', async () => {
      const adapter = await seedOlderAndNewer()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      vi.spyOn(adapter, 'listThreads').mockRejectedValueOnce(new Error('offline'))
      await expect(result.refresh()).rejects.toThrow('offline')
      expect(result.threads.value.map((t) => t.id)).toEqual(['newer', 'older'])
      unmount()
    })
  })

  describe('activeThread', () => {
    it('is the open thread’s meta, independent of list order', async () => {
      const [result, unmount] = mountThreads({ adapter: await seedOlderAndNewer() })
      await flush()
      expect(result.activeThread.value?.id).toBe('newer')

      result.switchThread('older')
      expect(result.activeThread.value?.id).toBe('older')
      expect(result.threads.value[0].id).toBe('newer')
      unmount()
    })

    it('is null when no thread is active', async () => {
      const adapter = new MemoryAdapter()
      await adapter.save(makePersistedThread('only'))
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      await result.deleteThread('only')
      expect(result.activeThread.value).toBeNull()
      unmount()
    })
  })

  describe('re-exported active thread interface', () => {
    it('messages is empty on a fresh thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.messages.value).toEqual([])
      unmount()
    })

    it('isRunning is false initially', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('error is null initially', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('forwards errorCode from the active thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      soleAgent().emit('onRunErrorEvent', { event: { message: 'Context too long', code: 'context_length_exceeded' } })

      expect(result.errorCode.value).toBe('context_length_exceeded')
      unmount()
    })

    it('forwards lastOutcome and usage from the active thread', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()
      const usage = [{ provider: 'openai', model: 'gpt-x', inputTokens: 3, outputTokens: 2 }]

      const agent = soleAgent()
      agent.runAgent.mockImplementationOnce(async ({ runId }: { runId: string }) => {
        agent.emit('onRunErrorEvent', { event: { message: 'boom', code: 'internal', usage }, input: { runId } })
        return {}
      })
      await result.send('hello')

      expect(result.lastOutcome.value).toEqual({ type: 'error', code: 'internal' })
      expect(result.usage.value).toEqual(usage)
      unmount()
    })
  })

  describe('against a latency- and failure-injecting adapter (consumer contract)', () => {
    it('initializes and runs correctly through async latency', async () => {
      const adapter = new FakeAsyncAdapter([makePersistedThread('t1', 'Seeded')])
      adapter.delay = 10
      const [result, unmount] = mountThreads({ adapter })

      await vi.waitFor(() => expect(result.isLoading.value).toBe(false))
      expect(result.activeThreadId.value).toBe('t1')
      expect(result.threads.value.map((t) => t.title)).toContain('Seeded')
      unmount()
    })
  })

  describe('run provenance', () => {
    it('exposes the active thread’s provenance and round-trips it across a switch', async () => {
      const adapter = new MemoryAdapter()
      const [result, unmount] = mountThreads({ adapter })
      await flush()

      const first = result.activeThreadId.value!
      await result.send('hello')
      await flush()

      const userId = result.messages.value[0].id
      const runId = result.runForMessage(userId)
      expect(runId).toBeTruthy()
      expect(result.messageRuns.value.get(userId)).toBe(runId)

      // Switch away and back: provenance must survive the persist/hydrate cycle.
      const second = await result.createThread()
      await flush()
      expect(result.runForMessage(userId)).toBeUndefined()

      result.switchThread(first)
      await flush()

      expect(result.runForMessage(userId)).toBe(runId)
      expect(second).not.toBe(first)
      unmount()
    })
  })
})

// ─── Helpers ───────────────────────────────────────────────────────────────

// ─── Reasoning & activity messages (AG-UI 1.0) ─────────────────────────────
// The client materialises both into agent.messages, so threads persist them
// with no special handling. These tests pin that down.

describe('reasoning and activity messages in threads', () => {
  const reasoning = {
    id: 'rm1',
    role: 'reasoning',
    content: 'The permit needs a site plan.',
    encryptedValue: 'gAAAAB-opaque-provider-blob==',
  } as Message
  const activity = {
    id: 'a1',
    role: 'activity',
    activityType: 'records-search',
    content: { searched: 12, total: 12, sources: ['Land registry'] },
  } as Message

  beforeEach(() => localStorage.clear())

  it('round-trips encryptedValue and structured activity content verbatim through a save and reload', async () => {
    const adapter = new LocalStorageAdapter('reasoning-ns') // real JSON serialisation
    await adapter.save({ meta: makeMeta('t'), messages: [reasoning, activity], state: null })

    const [thread, unmount] = mountThread({ id: 't', adapter })
    await flush()
    await thread.send('next question') // forces a fresh save of the hydrated transcript
    await flush()
    unmount()

    const reloaded = await adapter.load('t')
    expect(reloaded!.messages.find((m) => m.id === 'rm1')).toEqual(reasoning)
    expect(reloaded!.messages.find((m) => m.id === 'a1')).toEqual(activity)
  })

  it('sends reasoning (with encryptedValue) back to the server on the next run, but not activities', async () => {
    // The real client decides what goes into RunAgentInput.messages.
    const agent = new ScriptedAgent()
    agent.messages = [reasoning, activity]
    await agent.runAgent({ runId: 'r1' })

    const sent = agent.inputs[0].messages
    expect(sent.find((m) => m.id === 'rm1')).toEqual(reasoning)
    expect(sent.some((m) => m.role === 'activity')).toBe(false)
  })

  it('useReasoning and useActivities follow a thread switch on the stable agent', async () => {
    const adapter = new MemoryAdapter()
    await adapter.save({ meta: makeMeta('a'), messages: [reasoning, activity], state: null })
    await adapter.save({
      meta: makeMeta('b'),
      messages: [{ id: 'b1', role: 'activity', activityType: 'records-search', content: { searched: 1 } } as Message],
      state: null,
    })

    const [ctx, unmount] = withSetup(() => {
      const agentCtx = useAgent({ url: 'http://test' })
      return {
        thread: useThread(agentCtx, { id: 'a', adapter }),
        reasoning: useReasoning(agentCtx.agent),
        activities: useActivities(agentCtx.agent),
      }
    })
    await flush()
    expect(ctx.activities.activityList.value.map((a) => a.id)).toEqual(['a1'])

    // A reasoning message streamed live in thread A…
    const mock = soleAgent()
    mock.emit('onReasoningMessageStartEvent', { event: { messageId: 'rm1', role: 'reasoning' }, input: { runId: 'r1' } })
    mock.emit('onReasoningMessageEndEvent', { event: { messageId: 'rm1' }, input: { runId: 'r1' } })
    expect(ctx.reasoning.getReasoning('rm1')).toBeDefined()

    await ctx.thread.load('b')

    // …is gone after the switch, and the activities are thread B's.
    expect(ctx.reasoning.getReasoning('rm1')).toBeUndefined()
    expect(ctx.activities.activityList.value.map((a) => a.id)).toEqual(['b1'])

    // Subscriptions survived the switch: B's activity updates still arrive.
    mock.messages = [{ ...mock.messages[0], content: { searched: 2 } } as Message]
    mock.emit('onMessagesChanged', {})
    expect(ctx.activities.getActivity('b1')!.content).toEqual({ searched: 2 })
    unmount()
  })
})

function makeMeta(id: string, title: string | null = null): ThreadMeta {
  return {
    id,
    title,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }
}

function makePersistedThread(id: string, title: string | null = null): PersistedThread {
  return {
    meta: makeMeta(id, title),
    messages: [],
    state: null,
  }
}

/** Two threads, `newer` (2024-06) ahead of `older` (2024-01) by `updatedAt`. */
async function seedOlderAndNewer(): Promise<MemoryAdapter> {
  const adapter = new MemoryAdapter()
  for (const [id, updatedAt] of [
    ['older', '2024-01-01'],
    ['newer', '2024-06-01'],
  ]) {
    const thread = makePersistedThread(id)
    thread.meta.updatedAt = new Date(updatedAt)
    await adapter.save(thread)
  }
  return adapter
}

/**
 * Test-only async adapter that injects latency and rejection — stands in for a
 * real consumer database to exercise the thread layer against the async
 * `ThreadStorageAdapter` contract (Date revival, latency window, rejections).
 */
class FakeAsyncAdapter implements ThreadStorageAdapter {
  private store = new Map<string, PersistedThread>()
  delay = 0
  failList = false
  failLoad = false
  failSave = false

  // Manual load gate: when armed, load() blocks until releaseLoad() is called,
  // making the "hydration in flight" window deterministic (no wall-clock races).
  private loadGate: Promise<void> | null = null
  private releaseLoadGate: (() => void) | null = null

  constructor(seed: PersistedThread[] = []) {
    for (const t of seed) this.store.set(t.meta.id, structuredClone(t))
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delay))
  }

  /** Arm the load gate so the next load() blocks until releaseLoad() is called. */
  blockLoad(): void {
    this.loadGate = new Promise((resolve) => {
      this.releaseLoadGate = resolve
    })
  }

  /** Release a previously-armed load gate, letting blocked load() calls proceed. */
  releaseLoad(): void {
    this.releaseLoadGate?.()
    this.loadGate = null
    this.releaseLoadGate = null
  }

  async listThreads(): Promise<ThreadMeta[]> {
    await this.wait()
    if (this.failList) throw new Error('list failed')
    return Array.from(this.store.values()).map((t) => structuredClone(t.meta))
  }

  async load(threadId: string): Promise<PersistedThread | null> {
    if (this.loadGate) await this.loadGate
    await this.wait()
    if (this.failLoad) throw new Error('load failed')
    const t = this.store.get(threadId)
    return t ? structuredClone(t) : null
  }

  async save(thread: PersistedThread): Promise<void> {
    await this.wait()
    if (this.failSave) throw new Error('save failed')
    this.store.set(thread.meta.id, structuredClone(thread))
  }

  async delete(threadId: string): Promise<void> {
    await this.wait()
    this.store.delete(threadId)
  }
}
