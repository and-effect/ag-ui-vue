import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ref, computed, reactive, watch, nextTick, isProxy } from 'vue'
import { withSetup } from './helpers/withSetup'
import { useAgent } from '../composables/useAgent'
import { getToolRegistry } from '../composables/toolRegistry'
import type { MockHttpAgent as MockHttpAgentType } from './helpers/mockHttpAgent'

/** Drain the microtask cascade (plus one macrotask). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Only HttpAgent is stubbed — the rest of the module (notably `randomUUID`,
// which useAgent uses to mint run/message ids) stays real.
vi.mock('@ag-ui/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ag-ui/client')>()
  const { MockHttpAgent } = await import('./helpers/mockHttpAgent')
  return { ...actual, HttpAgent: MockHttpAgent }
})

// Convenience: get the mock instance from a useAgent result
function getMock(agent: any): MockHttpAgentType {
  return agent as MockHttpAgentType
}

describe('useAgent', () => {
  describe('initial state', () => {
    it('starts with empty messages', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.messages.value).toEqual([])
      unmount()
    })

    it('starts not running', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('starts with no error', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('starts with empty streaming content', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.streamingContent.value).toBe('')
      unmount()
    })

    it('starts with no last result', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.lastResult.value).toBeNull()
      unmount()
    })
  })

  describe('send()', () => {
    it('throws for empty message', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await expect(result.send('')).rejects.toThrow('Cannot send empty message')
      await expect(result.send('   ')).rejects.toThrow('Cannot send empty message')
      unmount()
    })

    it('throws for empty InputContent array', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await expect(result.send([])).rejects.toThrow('Cannot send empty message')
      unmount()
    })

    it('pushes user message with InputContent[] content unchanged', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const content = [{ type: 'text' as const, text: 'hello' }]
      await result.send(content)
      expect(result.messages.value[0]).toMatchObject({ role: 'user', content })
      unmount()
    })

    it('does not trim text inside InputContent[] items', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const content = [{ type: 'text' as const, text: '  hello  ' }]
      await result.send(content)
      expect(result.messages.value[0].content).toEqual(content)
      unmount()
    })

    it('sends mixed text + image InputContent[]', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const content = [
        { type: 'text' as const, text: 'What is in this image?' },
        {
          type: 'image' as const,
          source: { type: 'data' as const, value: 'abc123', mimeType: 'image/png' },
        },
      ]
      await result.send(content)
      expect(result.messages.value[0]).toMatchObject({ role: 'user', content })
      unmount()
    })

    it('throws when already running', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockReturnValueOnce(new Promise(() => {}))

      result.send('hello') // intentionally not awaited
      await expect(result.send('world')).rejects.toThrow('Agent is already running')
      unmount()
    })

    it('pushes user message immediately', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await result.send('hello world')
      expect(result.messages.value).toHaveLength(1)
      expect(result.messages.value[0]).toMatchObject({ role: 'user', content: 'hello world' })
      unmount()
    })

    it('trims whitespace from the message content', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await result.send('  hello  ')
      expect(result.messages.value[0]).toMatchObject({ role: 'user', content: 'hello' })
      unmount()
    })

    it('calls agent.runAgent with tools and context', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const tools = [{ name: 'search' }]
      const context = [{ description: 'ctx', value: '1' }]

      await result.send('hello', { tools, context })

      expect(mock.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ tools, context }),
        undefined,
      )
      unmount()
    })

    it('defaults tools, context and forwardedProps to empty', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ tools: [], context: [], forwardedProps: {} }),
        undefined,
      )
      unmount()
    })

    it('sets isRunning to false after completion', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await result.send('hello')
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('stores lastResult after a successful run', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const fakeResult = { runId: 'run_123' }
      mock.runAgent.mockResolvedValueOnce(fakeResult)

      await result.send('hello')

      expect(result.lastResult.value).toEqual(fakeResult)
      unmount()
    })

    it('sets error for unexpected errors from runAgent', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(new Error('Network error'))

      await result.send('hello')

      expect(result.error.value).toBe('Network error')
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('sets error to "Request aborted" and errorCode to "abort" for an AbortError it did not trigger', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      mock.runAgent.mockRejectedValueOnce(abortError)

      await result.send('hello')

      expect(result.error.value).toBe('Request aborted')
      expect(result.errorCode.value).toBe('abort')
      unmount()
    })

    it('leaves errorCode null for a thrown error without a code', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(new Error('Network error'))

      await result.send('hello')

      expect(result.error.value).toBe('Network error')
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('clears error before a new run', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(new Error('First error'))
      await result.send('first')
      expect(result.error.value).toBe('First error')

      await result.send('second')
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('clears errorCode before a new run', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.emit('onRunErrorEvent', { event: { message: 'Slow down', code: 'rate_limited' } })
      expect(result.errorCode.value).toBe('rate_limited')

      await result.send('again')

      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('clears streamingContent after completion', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockImplementationOnce(() => {
        mock.emit('onTextMessageContentEvent', { textMessageBuffer: 'partial...' })
        return Promise.resolve({})
      })

      await result.send('hello')
      expect(result.streamingContent.value).toBe('')
      unmount()
    })
  })

  describe('event handling', () => {
    it('onMessagesChanged syncs agent.messages into the ref', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.messages = [
        { id: '1', role: 'user', content: 'hi' } as any,
        { id: '2', role: 'assistant', content: 'hello' } as any,
      ]

      mock.emit('onMessagesChanged')

      expect(result.messages.value).toHaveLength(2)
      expect(result.messages.value[0]).toMatchObject({ role: 'user' })
      expect(result.messages.value[1]).toMatchObject({ role: 'assistant' })
      unmount()
    })

    it('onTextMessageContentEvent updates streamingContent', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.emit('onTextMessageContentEvent', { textMessageBuffer: 'Hello world' })

      expect(result.streamingContent.value).toBe('Hello world')
      unmount()
    })

    it('onTextMessageEndEvent clears streamingContent', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.emit('onTextMessageContentEvent', { textMessageBuffer: 'Some text' })
      mock.emit('onTextMessageEndEvent')

      expect(result.streamingContent.value).toBe('')
      unmount()
    })

    it('onRunErrorEvent sets error from event.message', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.emit('onRunErrorEvent', { event: { message: 'Something went wrong' } })

      expect(result.error.value).toBe('Something went wrong')
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('onRunErrorEvent sets errorCode from event.code', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.emit('onRunErrorEvent', { event: { message: 'Context too long', code: 'context_length_exceeded' } })

      expect(result.error.value).toBe('Context too long')
      expect(result.errorCode.value).toBe('context_length_exceeded')
      unmount()
    })

    it('reports errorCode "abort" for a raw agent.abortRun() of its own run', async () => {
      // Aborting on the raw agent bypasses useAgent.abort(), so the run isn't
      // abandoned and the client's RUN_ERROR { code: 'abort' } surfaces.
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles
      result.send('hello') // intentionally not awaited — stays in-flight
      await nextTick()
      const runId = mock.runAgent.mock.calls[0][0].runId

      result.agent.abortRun()
      mock.emit('onRunErrorEvent', { event: { message: 'The operation was aborted.', code: 'abort' }, input: { runId } })

      expect(result.errorCode.value).toBe('abort')
      unmount()
    })

    it('onRunErrorEvent uses fallback when message is absent', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.emit('onRunErrorEvent', { event: {} })

      expect(result.error.value).toBe('An error occurred during the run')
      unmount()
    })

    it('onRunErrorEvent still surfaces the active run’s own error', async () => {
      // Guards against the fix over-suppressing: a run's own id is never in
      // abandonedRunIds unless useAgent itself aborted/reset it.
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles
      result.send('hello') // intentionally not awaited — stays in-flight
      await nextTick()
      const runId = mock.runAgent.mock.calls[0][0].runId

      mock.emit('onRunErrorEvent', { event: { message: 'boom' }, input: { runId } })

      expect(result.error.value).toBe('boom')
      unmount()
    })
  })

  describe('abort()', () => {
    it('calls agent.abortRun', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      result.abort()

      expect(mock.abortRun).toHaveBeenCalledOnce()
      unmount()
    })

    it('sets isRunning to false', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockReturnValueOnce(new Promise(() => {}))

      result.send('hello') // don't await
      result.abort()

      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('leaves error and errorCode null on Stop, whichever route the abort takes', async () => {
      // Pressing Stop is not an error: neither the late RUN_ERROR
      // { code: 'abort' } nor a late AbortError rejection may surface.
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      let rejectRun!: (e: unknown) => void
      mock.runAgent.mockReturnValueOnce(new Promise((_, reject) => { rejectRun = reject }))
      const run = result.send('hello')
      await nextTick()
      const runId = mock.runAgent.mock.calls[0][0].runId

      result.abort()
      mock.emit('onRunErrorEvent', { event: { message: 'The operation was aborted.', code: 'abort' }, input: { runId } })
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      rejectRun(abortError)
      await run

      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('clears streamingContent', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.emit('onTextMessageContentEvent', { textMessageBuffer: 'partial...' })

      result.abort()

      expect(result.streamingContent.value).toBe('')
      unmount()
    })
  })

  describe('reset()', () => {
    it('clears messages', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await result.send('hello')

      result.reset()

      expect(result.messages.value).toEqual([])
      unmount()
    })

    it('clears error, streamingContent, isRunning, and lastResult', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockResolvedValueOnce({ runId: 'r1' })
      await result.send('hello')
      mock.emit('onRunErrorEvent', { event: { message: 'oops', code: 'internal' } })
      mock.emit('onTextMessageContentEvent', { textMessageBuffer: 'streaming...' })

      result.reset()

      expect(result.isRunning.value).toBe(false)
      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      expect(result.streamingContent.value).toBe('')
      expect(result.lastResult.value).toBeNull()
      unmount()
    })

    it('calls agent.abortRun', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      result.reset()

      expect(mock.abortRun).toHaveBeenCalledOnce()
      unmount()
    })

    it('does not abandon an already-completed run’s id, so a later event for it still surfaces', async () => {
      // reset() fires on every thread switch (see useThreads), most with
      // nothing in flight. It must not blacklist an already-finished run's
      // id, or a custom runIdFactory that reuses ids could swallow a real
      // future error.
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello') // resolves normally — nothing to abort
      const finishedRunId = mock.runAgent.mock.calls[0][0].runId

      result.reset()

      mock.emit('onRunErrorEvent', { event: { message: 'oops' }, input: { runId: finishedRunId } })

      expect(result.error.value).toBe('oops')
      unmount()
    })

    it('clears the client’s pending interrupts so the fresh conversation can send', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.pendingInterrupts = [{ id: 'int_1', reason: 'confirmation' }]

      result.reset()

      expect(mock.pendingInterrupts).toEqual([])
      unmount()
    })
  })

  describe('setMessages()', () => {
    it('clears the previous conversation’s pending interrupts', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.pendingInterrupts = [{ id: 'int_1', reason: 'confirmation' }]

      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }])

      expect(mock.pendingInterrupts).toEqual([])
      unmount()
    })
  })

  // send/setMessages/reset write agent.messages in place, which the client never
  // reports. Other subscribers on the agent (useActivities, useReasoning, the
  // consumer's own) must still hear about it, or they miss a thread switch.
  describe('notifying other subscribers of direct message writes', () => {
    function setupWithSpy() {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const seen: string[][] = []
      mock.subscribe({ onMessagesChanged: ({ messages }) => void seen.push(messages.map((m) => m.id)) })
      return { result, mock, seen, unmount }
    }

    it('setMessages() notifies synchronously with the new transcript', () => {
      const { result, seen, unmount } = setupWithSpy()
      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }])
      expect(seen).toEqual([['m1']])
      unmount()
    })

    it('reset() notifies with the emptied transcript', () => {
      const { result, seen, unmount } = setupWithSpy()
      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }])
      result.reset()
      expect(seen.at(-1)).toEqual([])
      unmount()
    })

    it('send() notifies with the user message before the run', async () => {
      const { result, mock, seen, unmount } = setupWithSpy()
      // Recorded rather than asserted inside the mock: send() catches a throw
      // from runAgent into `error`, so an expect() there could never fail the test.
      let seenAtRun: string[][] | undefined
      mock.runAgent.mockImplementation(async () => {
        seenAtRun = seen.map((ids) => [...ids])
        return {}
      })
      await result.send('hello')
      expect(result.error.value).toBeNull()
      expect(seenAtRun).toHaveLength(1)
      expect(seenAtRun![0]).toEqual([result.messages.value[0].id])
      unmount()
    })

    // A listener reading useAgent's own state must see the conversation it is
    // being told about, not the previous one.
    it('setMessages() notifies after the swapped-in runs and interrupts are in place', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      let seen: { run?: string; interrupts?: string[] } = {}
      mock.subscribe({
        onMessagesChanged: () => {
          seen = { run: result.runForMessage('m1'), interrupts: result.interrupts.value.map((i) => i.id) }
        },
      })
      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }], { m1: 'run_a' }, [
        { id: 'int_1', reason: 'confirmation' },
      ])
      expect(seen).toEqual({ run: 'run_a', interrupts: ['int_1'] })
      unmount()
    })

    it('reset() notifies after runs, interrupts and isRunning are cleared', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }], { m1: 'run_a' }, [
        { id: 'int_1', reason: 'confirmation' },
      ])
      let seen: { run?: string; interrupts?: number; running?: boolean } = {}
      mock.subscribe({
        onMessagesChanged: () => {
          seen = {
            run: result.runForMessage('m1'),
            interrupts: result.interrupts.value.length,
            running: result.isRunning.value,
          }
        },
      })
      result.reset()
      expect(seen).toEqual({ run: undefined, interrupts: 0, running: false })
      unmount()
    })

    it("send() notifies after the user message is stamped with the run", async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      mock.runAgent.mockResolvedValue({})
      let run: string | undefined
      mock.subscribe({
        onMessagesChanged: ({ messages }) => {
          run ??= result.runForMessage(messages[0].id)
        },
      })
      await result.send('hello')
      expect(run).toBeDefined()
      expect(run).toBe(result.runForMessage(result.messages.value[0].id))
      unmount()
    })

    it('a throwing listener is logged and send() still runs and settles', async () => {
      const { result, mock, seen, unmount } = setupWithSpy()
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const boom = new Error('listener bug')
      mock.subscribe({
        onMessagesChanged: () => {
          throw boom
        },
      })
      // Registered after the throwing one: later listeners are still told.
      const after: string[][] = []
      mock.subscribe({ onMessagesChanged: ({ messages }) => void after.push(messages.map((m) => m.id)) })
      mock.runAgent.mockResolvedValue({})

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(result.isRunning.value).toBe(false)
      expect(result.error.value).toBeNull()
      expect(seen).toHaveLength(1)
      expect(after).toHaveLength(1)
      expect(logged).toHaveBeenCalledWith('Subscriber error:', boom)
      logged.mockRestore()
      unmount()
    })

    it('a rejecting async listener is logged, not left unhandled', async () => {
      const { result, mock, unmount } = setupWithSpy()
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const boom = new Error('async listener bug')
      mock.subscribe({ onMessagesChanged: async () => Promise.reject(boom) })

      result.setMessages([{ id: 'm1', role: 'user', content: 'hi' }])
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('Subscriber error:', boom))
      logged.mockRestore()
      unmount()
    })
  })

  describe('reactive options', () => {
    it('resolves a static url and headers onto the agent at construction', () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://static', headers: { Authorization: 'Bearer a' } }),
      )
      const mock = getMock(result.agent)
      expect(mock.url).toBe('http://static')
      expect(mock.headers).toEqual({ Authorization: 'Bearer a' })
      unmount()
    })

    it('resolves a headers getter fresh on every send', async () => {
      const token = ref('a')
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', headers: () => ({ Authorization: `Bearer ${token.value}` }) }),
      )
      const mock = getMock(result.agent)

      await result.send('one')
      expect(mock.headers).toEqual({ Authorization: 'Bearer a' })

      token.value = 'b'
      await result.send('two')
      expect(mock.headers).toEqual({ Authorization: 'Bearer b' })
      unmount()
    })

    it('resolves a url ref fresh on every send', async () => {
      const url = ref('http://one')
      const [result, unmount] = withSetup(() => useAgent({ url }))
      const mock = getMock(result.agent)

      await result.send('hello')
      expect(mock.url).toBe('http://one')

      url.value = 'http://two'
      await result.send('again')
      expect(mock.url).toBe('http://two')
      unmount()
    })

    it('defaults missing headers to an empty object on each request', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      await result.send('hello')
      expect(mock.headers).toEqual({})
      unmount()
    })

    it('reconnects to a new url when a url ref changes', async () => {
      const url = ref('http://one')
      const [result, unmount] = withSetup(() => useAgent({ url }))
      const mock = getMock(result.agent)

      url.value = 'http://two'
      await nextTick()

      expect(mock.url).toBe('http://two')
      unmount()
    })

    it('resets and reconnects when a threadId ref changes', async () => {
      const threadId = ref('thread_a')
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test', threadId }))
      const mock = getMock(result.agent)
      expect(mock.threadId).toBe('thread_a')

      await result.send('hello')
      expect(result.messages.value).toHaveLength(1)

      threadId.value = 'thread_b'
      await nextTick()

      expect(mock.threadId).toBe('thread_b')
      expect(result.messages.value).toEqual([])
      expect(mock.abortRun).toHaveBeenCalled()
      unmount()
    })

    it('aborts an in-flight run and does not leak its outcome when threadId changes mid-run', async () => {
      const threadId = ref('thread_a')
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test', threadId }))
      const mock = getMock(result.agent)

      // Hold the run open so we can switch threads while it is still active.
      let rejectRun!: (e: Error) => void
      mock.runAgent.mockReturnValueOnce(
        new Promise<never>((_, reject) => {
          rejectRun = reject
        }),
      )

      result.send('hello') // intentionally not awaited — stays in-flight
      await nextTick()
      expect(result.isRunning.value).toBe(true)
      expect(result.messages.value).toHaveLength(1)

      // Switch threads mid-run.
      threadId.value = 'thread_b'
      await nextTick()

      expect(mock.abortRun).toHaveBeenCalled()
      expect(mock.threadId).toBe('thread_b')
      expect(result.messages.value).toEqual([])
      expect(result.isRunning.value).toBe(false)

      // The aborted run rejects late (as the real HttpAgent does on abort).
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      rejectRun(abortError)
      await nextTick()
      await Promise.resolve()

      // It must NOT leak 'Request aborted' / isRunning onto the fresh thread.
      expect(result.error.value).toBeNull()
      expect(result.isRunning.value).toBe(false)
      expect(result.messages.value).toEqual([])
      unmount()
    })

    it('ignores a stale RUN_ERROR event from a run superseded mid-flight', async () => {
      // The real HttpAgent does not reject runAgent() on abort — it turns the
      // aborted fetch into a RUN_ERROR event instead, which bypasses the
      // token check in runWithRetry's catch block and reaches the subscriber
      // directly. Regression test for that path (the rejection-based test
      // above only covers the mock's own, less faithful, abort behavior).
      const threadId = ref('thread_a')
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test', threadId }))
      const mock = getMock(result.agent)

      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles
      result.send('hello') // intentionally not awaited — stays in-flight
      await nextTick()
      expect(result.isRunning.value).toBe(true)
      const staleRunId = mock.runAgent.mock.calls[0][0].runId

      threadId.value = 'thread_b' // switch threads mid-run: aborts and bumps runToken
      await nextTick()
      expect(result.isRunning.value).toBe(false)

      // The old run's aborted fetch reports its RUN_ERROR late, after the switch.
      mock.emit('onRunErrorEvent', {
        event: { message: 'Request aborted', code: 'abort' },
        input: { runId: staleRunId },
      })

      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('ignores a stale RUN_ERROR event from an abandoned run even after a new run has started', async () => {
      // A token-based guard only knows "has a run started since the last
      // abort" — it stops suppressing the moment a new run starts, so the old
      // run's late RUN_ERROR would leak onto the new run's state. Guarding on
      // the event's own input.runId instead survives that ordering.
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles
      result.send('a') // intentionally not awaited — stays in-flight
      await nextTick()
      const staleRunId = mock.runAgent.mock.calls[0][0].runId

      result.abort()
      await nextTick()
      expect(result.isRunning.value).toBe(false)

      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles either
      result.send('b') // a new run starts before the old one's error arrives
      await nextTick()
      expect(result.isRunning.value).toBe(true)

      // Run 'a's aborted fetch reports its RUN_ERROR late, after 'b' started.
      mock.emit('onRunErrorEvent', {
        event: { message: 'Request aborted', code: 'abort' },
        input: { runId: staleRunId },
      })

      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    it('does not reset for a static threadId', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', threadId: 'thread_static' }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')
      await nextTick()

      expect(result.messages.value).toHaveLength(1)
      expect(mock.threadId).toBe('thread_static')
      unmount()
    })
  })

  describe('cleanup on unmount', () => {
    it('unsubscribes from the agent', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      // The event bridge plus the tool and interrupt coordinators each subscribe.
      expect(mock.subscriberCount).toBe(3)

      unmount()

      expect(mock.subscriberCount).toBe(0)
    })

    it('calls agent.abortRun', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      unmount()

      expect(mock.abortRun).toHaveBeenCalledOnce()
    })
  })

  describe('onError hook', () => {
    it('is invoked with the failed request error', async () => {
      const onError = vi.fn()
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      const err = Object.assign(new Error('HTTP 401: Unauthorized'), { status: 401 })
      mock.runAgent.mockRejectedValueOnce(err)

      await result.send('hello')

      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0][0]).toBe(err)
      expect(onError.mock.calls[0][0].status).toBe(401)
      unmount()
    })

    it('retries once and re-resolves headers when the hook returns { retry: true }', async () => {
      const token = ref('expired')
      const onError = vi.fn(async () => {
        token.value = 'fresh' // simulate a token refresh
        return { retry: true }
      })
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          headers: () => ({ Authorization: `Bearer ${token.value}` }),
          onError,
        }),
      )
      const mock = getMock(result.agent)
      // First attempt fails with 401, retry succeeds.
      mock.runAgent
        .mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
        .mockResolvedValueOnce({ ok: true })

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      // The retry re-resolved headers with the refreshed token.
      expect(mock.headers).toEqual({ Authorization: 'Bearer fresh' })
      expect(result.error.value).toBeNull()
      expect(result.lastResult.value).toEqual({ ok: true })
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('does not retry when the hook returns nothing', async () => {
      const onError = vi.fn(async () => {})
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(new Error('Network error'))

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(result.error.value).toBe('Network error')
      unmount()
    })

    it('retries at most once, then surfaces the error', async () => {
      const onError = vi.fn(async () => ({ retry: true }))
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      // Always fails — the hook keeps asking to retry but must only fire once.
      mock.runAgent.mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }))

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledTimes(2) // original + one retry
      expect(onError).toHaveBeenCalledOnce()
      expect(result.error.value).toBe('HTTP 401')
      expect(result.isRunning.value).toBe(false)
      unmount()
    })

    it('is not invoked for user-initiated aborts', async () => {
      const onError = vi.fn()
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      mock.runAgent.mockRejectedValueOnce(abortError)

      await result.send('hello')

      expect(onError).not.toHaveBeenCalled()
      expect(result.error.value).toBe('Request aborted')
      unmount()
    })

    it('fires for internally-issued continueRun requests', async () => {
      const onError = vi.fn(async () => ({ retry: true }))
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      mock.runAgent
        .mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
        .mockResolvedValueOnce({ ok: true })

      await result.continueRun()

      expect(onError).toHaveBeenCalledOnce()
      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('does not fire the retry when abort() is called during the onError handler', async () => {
      // The handler suspends (e.g. awaiting a token refresh); the user aborts in
      // that window. The queued retry must not issue a fresh request.
      let releaseHandler: () => void
      const handlerStarted = new Promise<void>((resolve) => {
        releaseHandler = resolve
      })
      let resolveGate: () => void
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve
      })
      const onError = vi.fn(async () => {
        releaseHandler() // signal the handler is now awaiting
        await gate // suspend until the test lets it resume
        return { retry: true }
      })

      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))

      const sendPromise = result.send('hello')
      await handlerStarted // first attempt failed, handler is suspended

      result.abort() // user cancels while the token refresh is in flight
      resolveGate!() // handler resumes and returns { retry: true }
      await sendPromise

      // The first attempt is the only runAgent call — no retry fired post-abort.
      expect(mock.runAgent).toHaveBeenCalledTimes(1)
      expect(result.isRunning.value).toBe(false)
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('does not surface an error or leak state when the hook resets mid-flight', async () => {
      let agentRef: any
      const onError = vi.fn(async () => {
        agentRef.reset() // bumps runToken while the hook awaits
      })
      const [result, unmount] = withSetup(() => {
        const r = useAgent({ url: 'http://test', onError })
        agentRef = r
        return r
      })
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(new Error('HTTP 401'))

      await result.send('hello')

      // reset() already cleared error; the superseded run must not write it back.
      expect(result.error.value).toBeNull()
      unmount()
    })
  })

  describe('run outcome and usage', () => {
    const usageA = [{ provider: 'openai', model: 'gpt-x', inputTokens: 10, outputTokens: 5 }]

    // Start a run that stays in flight; returns its run id.
    async function startRun(result: ReturnType<typeof useAgent>) {
      const mock = getMock(result.agent)
      mock.runAgent.mockReturnValueOnce(new Promise(() => {}))
      result.send('hello')
      await nextTick()
      return mock.runAgent.mock.calls.at(-1)![0].runId as string
    }

    it('starts null', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      expect(result.lastOutcome.value).toBeNull()
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it.each([
      { type: 'success' as const },
      { type: 'cancelled' as const },
      { type: 'interrupt' as const, interrupts: [{ id: 'i1', reason: 'approval' }] },
    ])('reflects a RUN_FINISHED $type outcome and its usage', async (outcome) => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      mock.emit('onRunFinishedEvent', {
        event: { type: 'RUN_FINISHED', outcome, usage: usageA },
        outcome: outcome.type,
        interrupts: (outcome as any).interrupts ?? [],
        input: { runId },
      })

      expect(result.lastOutcome.value).toEqual(outcome)
      expect(result.usage.value).toEqual(usageA)
      unmount()
    })

    it('treats a RUN_FINISHED without an outcome as success, with null usage', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED' }, outcome: 'success', input: { runId } })

      expect(result.lastOutcome.value).toEqual({ type: 'success' })
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it('ignores RUN_FINISHED from a run it did not start', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      await startRun(result)

      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageA }, outcome: 'success', input: { runId: 'someone-else' } })

      expect(result.lastOutcome.value).toBeNull()
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it('reports RUN_ERROR as an error outcome sharing errorCode, with its usage', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      mock.emit('onRunErrorEvent', { event: { message: 'Slow down', code: 'rate_limited', usage: usageA }, input: { runId } })

      expect(result.lastOutcome.value).toEqual({ type: 'error', code: 'rate_limited' })
      expect(result.errorCode.value).toBe('rate_limited')
      expect(result.usage.value).toEqual(usageA)
      unmount()
    })

    it('sets error but not outcome or usage for a RUN_ERROR from a run it did not start', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      await startRun(result)

      mock.emit('onRunErrorEvent', { event: { message: 'boom', code: 'internal', usage: usageA }, input: { runId: 'someone-else' } })

      expect(result.error.value).toBe('boom')
      expect(result.lastOutcome.value).toBeNull()
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it('reports a failed request as an error outcome with a null code', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      getMock(result.agent).runAgent.mockRejectedValueOnce(new Error('Network error'))

      await result.send('hello')

      expect(result.lastOutcome.value).toEqual({ type: 'error', code: null })
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it('reports aborted on Stop, ignores the late abort RUN_ERROR, and keeps error null', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      result.abort()
      mock.emit('onRunErrorEvent', { event: { message: 'The operation was aborted.', code: 'abort', usage: usageA }, input: { runId } })

      expect(result.lastOutcome.value).toEqual({ type: 'aborted' })
      expect(result.usage.value).toBeNull()
      expect(result.error.value).toBeNull()
      expect(result.errorCode.value).toBeNull()
      unmount()
    })

    // The client still delivers a RUN_FINISHED it had already parsed when Stop
    // was pressed, followed by the synthetic abort RUN_ERROR.
    it.each(['abort', 'reset'] as const)('ignores a late RUN_FINISHED after %s()', async (method) => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      result[method]()
      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageA }, outcome: 'success', input: { runId } })
      mock.emit('onRunErrorEvent', { event: { message: 'The operation was aborted.', code: 'abort' }, input: { runId } })

      expect(result.lastOutcome.value).toEqual(method === 'abort' ? { type: 'aborted' } : null)
      expect(result.usage.value).toBeNull()
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('keeps the interrupt outcome when a queued run is refused by the interrupt gate', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const interrupts = [{ id: 'i1', reason: 'confirmation' }]
      mock.runAgent.mockImplementationOnce(async ({ runId }: { runId: string }) => {
        void result.continueRun() // queued: a run is in flight
        mock.emit('onRunFinishedEvent', {
          event: { type: 'RUN_FINISHED', outcome: { type: 'interrupt', interrupts }, usage: usageA },
          outcome: 'interrupt',
          interrupts,
          input: { runId },
        })
        return {}
      })

      await result.send('go')
      await Promise.resolve()

      expect(result.errorCode.value).toBe('interrupts-pending')
      expect(result.lastOutcome.value).toEqual({ type: 'interrupt', interrupts })
      expect(result.usage.value).toEqual(usageA)
      unmount()
    })

    it('keeps the last outcome on an idle abort', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      getMock(result.agent).runAgent.mockRejectedValueOnce(new Error('Network error'))
      await result.send('hello')

      result.abort()

      expect(result.lastOutcome.value).toEqual({ type: 'error', code: null })
      unmount()
    })

    it('clears both at the next run start, so usage is never stale', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)
      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageA }, outcome: 'success', input: { runId } })
      result.abort() // settle the never-resolving run

      await startRun(result)

      expect(result.lastOutcome.value).toBeNull()
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it.each(['reset', 'setMessages'] as const)('%s() clears both', async (method) => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)
      mock.emit('onRunErrorEvent', { event: { message: 'boom', usage: usageA }, input: { runId } })

      if (method === 'reset') result.reset()
      else result.setMessages([])

      expect(result.lastOutcome.value).toBeNull()
      expect(result.usage.value).toBeNull()
      unmount()
    })

    it('reports the retried request under the same run id', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', onError: async () => ({ retry: true }) }),
      )
      const mock = getMock(result.agent)
      const usageB = [{ provider: 'openai', model: 'gpt-x', inputTokens: 1, outputTokens: 1 }]
      // As the client does it: an HTTP failure rejects runAgent with no RUN_ERROR
      // event (a streamed RUN_ERROR resolves it instead, so it is never retried).
      mock.runAgent
        .mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
        .mockImplementationOnce(async ({ runId }: { runId: string }) => {
          mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageB }, outcome: 'success', input: { runId } })
          return {}
        })

      await result.send('hello')

      const [first, second] = mock.runAgent.mock.calls.map((c) => c[0].runId)
      expect(second).toBe(first)
      expect(result.lastOutcome.value).toEqual({ type: 'success' })
      expect(result.usage.value).toEqual(usageB)
      expect(result.error.value).toBeNull()
      unmount()
    })

    it('assigns fresh values, so a plain watch() fires', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const seen: unknown[] = []
      watch(result.usage, (u) => seen.push(u))
      const runId = await startRun(result)

      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageA }, outcome: 'success', input: { runId } })
      await nextTick()

      expect(seen).toEqual([usageA])
      expect(result.usage.value).not.toBe(usageA)
      unmount()
    })

    it('returns plain values that survive structuredClone', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)
      const runId = await startRun(result)

      mock.emit('onRunFinishedEvent', { event: { type: 'RUN_FINISHED', usage: usageA }, outcome: 'success', input: { runId } })

      expect(isProxy(result.usage.value)).toBe(false)
      expect(isProxy(result.lastOutcome.value)).toBe(false)
      expect(() => structuredClone(result.usage.value)).not.toThrow()
      expect(() => structuredClone(result.lastOutcome.value)).not.toThrow()
      unmount()
    })
  })

  describe('run identity', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    /** The runId of the nth (0-based) runAgent call. */
    function runIdOf(mock: MockHttpAgentType, call = 0): string {
      return (mock.runAgent.mock.calls[call][0] as any).runId
    }

    it('passes a client-minted uuid runId to runAgent', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(runIdOf(mock)).toMatch(UUID_RE)
      unmount()
    })

    it('uses runIdFactory when provided', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(runIdOf(mock)).toBe('run_1')
      unmount()
    })

    it('reuses the same runId across the onError retry', async () => {
      const onError = vi.fn(async () => ({ retry: true }))
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test', onError }))
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      // A retry is the same logical run — the id must not change under it.
      expect(runIdOf(mock, 1)).toBe(runIdOf(mock, 0))
      unmount()
    })

    it('mints a fresh runId per send', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('one')
      await result.send('two')

      expect(runIdOf(mock, 1)).not.toBe(runIdOf(mock, 0))
      unmount()
    })

    it('mints a fresh runId for a continuation (a continuation is a new run)', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello')
      await result.continueRun()

      expect(runIdOf(mock, 1)).not.toBe(runIdOf(mock, 0))
      unmount()
    })

    it('gives user messages uuid ids that never collide within a millisecond', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))

      await result.send('one')
      await result.send('two')
      await result.send('three')

      const ids = result.messages.value.map((m) => m.id)
      for (const id of ids) expect(id).toMatch(UUID_RE)
      expect(new Set(ids).size).toBe(3)
      unmount()
    })
  })

  describe('message run provenance', () => {
    it('stamps messages produced during a turn with that turn’s runId', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => 'run_1' }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockImplementation(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_1', role: 'assistant', content: 'hi' } as any)
          mock.emit('onMessagesChanged')
        }),
      )

      await result.send('hello')

      const userId = result.messages.value[0].id
      expect(result.runForMessage(userId)).toBe('run_1')
      expect(result.runForMessage('asst_1')).toBe('run_1')
      unmount()
    })

    it('stamps a tool-result continuation with the continuation’s own runId', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)

      // Model the real continuation path: the coordinator fires continueRun
      // while the run is still in flight, so it rides pendingContinueRun.
      mock.runAgent
        .mockImplementationOnce(async () => {
          result.continueRun()
          return {}
        })
        .mockImplementationOnce(async () =>
          mock.stream(() => {
            mock.messages.push({ id: 'asst_after_tool', role: 'assistant', content: 'done' } as any)
            mock.emit('onMessagesChanged')
          }),
        )

      await result.send('hello')
      await nextTick()

      // The continuation is its own run, and its output is attributed to it.
      // Grouping run_1 + run_2 into one exchange is the consumer's business.
      expect((mock.runAgent.mock.calls[1][0] as any).runId).toBe('run_2')
      expect(result.runForMessage('asst_after_tool')).toBe('run_2')
      expect(result.runForMessage(result.messages.value[0].id)).toBe('run_1')
      unmount()
    })

    it('attributes a reply after a HITL pause to the resuming run', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)
      const registry = getToolRegistry(result.agent)!
      // A HITL tool: onEnd does not submit — the user answers later.
      registry.register({ tool: { name: 'confirm' } as any, isEnabled: () => true })

      mock.runAgent.mockImplementationOnce(async () => {
        mock.emit('onToolCallStartEvent', {
          event: { toolCallId: 'call_1', toolCallName: 'confirm' },
        })
        mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
        mock.emit('onRunFinishedEvent', {})
        return {}
      })
      await result.send('hello')
      expect(result.isRunning.value).toBe(false)

      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_after_hitl', role: 'assistant', content: 'ok' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      await flush()

      expect((mock.runAgent.mock.calls[1][0] as any).runId).toBe('run_2')
      expect(result.runForMessage('asst_after_hitl')).toBe('run_2')
      unmount()
    })

    it('does not stamp messages added between runs', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => 'run_1' }),
      )
      const mock = getMock(result.agent)
      await result.send('hello')

      // No run in flight: a locally-added message has no producing run.
      mock.addMessage({ id: 'local', role: 'tool', content: '{}' } as any)
      mock.emit('onMessagesChanged')
      await flush()

      expect(result.runForMessage('local')).toBeUndefined()
      unmount()
    })

    // Regression: provenance is derived from what a run *reports having
    // produced* (RunAgentResult.newMessages), never from scanning the messages
    // array for ids that are not in the map yet. The three cases below are the
    // ones a scan gets wrong: it cannot tell "never seen" from "seen, and
    // knowingly unattributed", so the next run to stream anything sweeps up
    // every previously-unstamped message.
    it('does not back-stamp a message added between runs when the next run streams', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)
      await result.send('hello')

      // HITL: the user approves later, and the tool result is pushed while no
      // run is in flight.
      mock.addMessage({ id: 'toolres', role: 'tool', content: '{}' } as any)
      mock.emit('onMessagesChanged')
      await flush()
      expect(result.runForMessage('toolres')).toBeUndefined()

      // The continuation streams a reply. `toolres` must stay unattributed —
      // run_2 did not produce it.
      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_2', role: 'assistant', content: 'ok' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      await result.continueRun()
      await flush()

      expect(result.runForMessage('toolres')).toBeUndefined()
      expect(result.runForMessage('asst_2')).toBe('run_2')
      unmount()
    })

    it('does not back-stamp a thread hydrated without provenance', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)
      // A thread persisted before provenance tracking existed: messages, no runs.
      result.setMessages([
        { id: 'old_user', role: 'user', content: 'yesterday' } as any,
        { id: 'old_asst', role: 'assistant', content: 'reply' } as any,
      ])

      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_new', role: 'assistant', content: 'hi' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      await result.send('today')

      // The whole reloaded transcript must keep reporting no run — attributing
      // it to whichever run fired next would be worse than reporting nothing.
      expect(result.runForMessage('old_user')).toBeUndefined()
      expect(result.runForMessage('old_asst')).toBeUndefined()
      expect(result.runForMessage('asst_new')).toBe('run_1')
      unmount()
    })

    it('does not back-stamp initialMessages', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          runIdFactory: () => 'run_1',
          initialMessages: [{ id: 'init_1', role: 'assistant', content: 'hi' } as any],
        }),
      )

      await result.send('today')

      expect(result.runForMessage('init_1')).toBeUndefined()
      unmount()
    })

    it('leaves a message from an errored run unattributed', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => 'run_1' }),
      )
      const mock = getMock(result.agent)
      // A run that streams a partial message and then fails never reports its
      // newMessages, so the partial bubble has no provenance. Documented
      // trade-off of deriving from the run result.
      mock.runAgent.mockImplementationOnce(async () => {
        mock.messages.push({ id: 'partial', role: 'assistant', content: 'half' } as any)
        mock.emit('onMessagesChanged')
        throw new Error('Network error')
      })

      await result.send('hello')

      expect(result.error.value).toBe('Network error')
      expect(result.runForMessage('partial')).toBeUndefined()
      // The user's own message still is attributed — it is what the run carried.
      expect(result.runForMessage(result.messages.value[0].id)).toBe('run_1')
      unmount()
    })

    // A MESSAGES_SNAPSHOT replaces the transcript with the server's
    // authoritative view and drops local messages absent from it. Provenance for
    // a message that is no longer there must not linger: useThread persists the
    // whole map on every save, so a stale key would round-trip to storage
    // forever.
    it('drops provenance for messages no longer in the transcript', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_1', role: 'assistant', content: 'hi' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      await result.send('hello')
      const userId = result.messages.value[0].id
      expect(result.runForMessage('asst_1')).toBe('run_1')

      // The snapshot keeps the user message and discards the assistant one.
      mock.messages = mock.messages.filter((m) => m.id !== 'asst_1')
      mock.emit('onMessagesChanged')

      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_2', role: 'assistant', content: 'ok' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      await result.continueRun()

      expect(result.runForMessage('asst_1')).toBeUndefined()
      expect(result.messageRuns.value.has('asst_1')).toBe(false)
      // Messages that survived keep theirs — the prune drops, never re-attributes.
      expect(result.runForMessage(userId)).toBe('run_1')
      expect(result.runForMessage('asst_2')).toBe('run_2')
      unmount()
    })

    it('stamps each send with its own runId', async () => {
      let n = 0
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => `run_${++n}` }),
      )

      await result.send('one')
      await result.send('two')

      const [first, second] = result.messages.value
      expect(result.runForMessage(first.id)).toBe('run_1')
      expect(result.runForMessage(second.id)).toBe('run_2')
      unmount()
    })

    it('does not stamp messages adopted outside a turn', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))

      result.setMessages([{ id: 'm1', role: 'assistant', content: 'old' } as any])

      expect(result.runForMessage('m1')).toBeUndefined()
      unmount()
    })

    it('does not carry provenance across a setMessages() conversation swap', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', runIdFactory: () => 'run_1' }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockImplementationOnce(async () =>
        mock.stream(() => {
          mock.messages.push({ id: 'asst_1', role: 'assistant', content: 'hi' } as any)
          mock.emit('onMessagesChanged')
        }),
      )
      await result.send('hello')
      const userId = result.messages.value[0].id
      expect(result.runForMessage('asst_1')).toBe('run_1')

      // Swap in a different conversation with no stored provenance. Omitting
      // `runs` means "these have no known runs" — not "keep the last lot".
      result.setMessages([{ id: 'other_1', role: 'assistant', content: 'elsewhere' } as any])

      expect(result.messageRuns.value.size).toBe(0)
      expect(result.runForMessage('asst_1')).toBeUndefined()
      expect(result.runForMessage(userId)).toBeUndefined()
      expect(result.runForMessage('other_1')).toBeUndefined()
      unmount()
    })

    it('replaces rather than merges provenance on a hydrated swap', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))

      result.setMessages([{ id: 'a1', role: 'assistant', content: 'A' } as any], {
        a1: 'run_a',
      })
      result.setMessages([{ id: 'b1', role: 'assistant', content: 'B' } as any], {
        b1: 'run_b',
      })

      expect(result.runForMessage('b1')).toBe('run_b')
      expect(result.runForMessage('a1')).toBeUndefined() // thread A's map is gone
      unmount()
    })

    it('restores provenance from a hydrated map', () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))

      result.setMessages([{ id: 'm1', role: 'assistant', content: 'old' } as any], {
        m1: 'run_persisted',
      })

      expect(result.runForMessage('m1')).toBe('run_persisted')
      expect(result.messageRuns.value.get('m1')).toBe('run_persisted')
      unmount()
    })

    it('clears provenance on reset()', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      await result.send('hello')
      const userId = result.messages.value[0].id
      expect(result.runForMessage(userId)).toBeDefined()

      result.reset()

      expect(result.messageRuns.value.size).toBe(0)
      unmount()
    })

    it('is reactive', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const seen: number[] = []
      watch(result.messageRuns, (m) => seen.push(m.size), { flush: 'sync' })

      await result.send('hello')

      expect(seen).toContain(1)
      unmount()
    })
  })

  describe('forwardedProps', () => {
    it('sends composable-level forwardedProps on every run', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', forwardedProps: { tenant: 'acme' } }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(mock.runAgent.mock.calls[0][0]).toMatchObject({
        forwardedProps: { tenant: 'acme' },
      })
      unmount()
    })

    it('resolves a getter fresh per request', async () => {
      const model = ref('fast')
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', forwardedProps: () => ({ model: model.value }) }),
      )
      const mock = getMock(result.agent)

      await result.send('one')
      model.value = 'smart'
      await result.send('two')

      expect((mock.runAgent.mock.calls[0][0] as any).forwardedProps).toEqual({ model: 'fast' })
      expect((mock.runAgent.mock.calls[1][0] as any).forwardedProps).toEqual({ model: 'smart' })
      unmount()
    })

    it('shallow-merges per-run keys over the composable-level default', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', forwardedProps: { tenant: 'acme', model: 'fast' } }),
      )
      const mock = getMock(result.agent)

      await result.send('hello', { forwardedProps: { model: 'smart' } })

      expect((mock.runAgent.mock.calls[0][0] as any).forwardedProps).toEqual({
        tenant: 'acme',
        model: 'smart',
      })
      unmount()
    })

    // The client structuredClones RunAgentInput.forwardedProps, and
    // structuredClone throws DataCloneError on a Vue reactive proxy — including a
    // *nested* one, which a shallow merge (or toRaw) would leave in place. So the
    // assertion that matters is that the sent payload survives structuredClone,
    // not merely that it compares equal.
    it('strips reactive proxies from composable-level forwardedProps', async () => {
      const settings = reactive({ retrieval: { topK: 5 } })
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', forwardedProps: () => ({ config: settings }) }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      const sent = (mock.runAgent.mock.calls[0][0] as any).forwardedProps
      expect(() => structuredClone(sent)).not.toThrow()
      expect(sent).toEqual({ config: { retrieval: { topK: 5 } } })
      unmount()
    })

    it('strips reactive proxies from per-run forwardedProps', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello', { forwardedProps: { command: reactive({ resume: { ok: true } }) } })

      const sent = (mock.runAgent.mock.calls[0][0] as any).forwardedProps
      expect(() => structuredClone(sent)).not.toThrow()
      expect(sent).toEqual({ command: { resume: { ok: true } } })
      unmount()
    })

    it('re-resolves a reactive getter, stripped, on each run', async () => {
      const settings = reactive({ model: 'fast' })
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', forwardedProps: () => ({ ...settings }) }),
      )
      const mock = getMock(result.agent)

      await result.send('one')
      settings.model = 'smart'
      await result.send('two')

      expect((mock.runAgent.mock.calls[0][0] as any).forwardedProps).toEqual({ model: 'fast' })
      expect((mock.runAgent.mock.calls[1][0] as any).forwardedProps).toEqual({ model: 'smart' })
      unmount()
    })
  })

  describe('context', () => {
    const contextOf = (mock: MockHttpAgentType, call: number) =>
      (mock.runAgent.mock.calls[call][0] as any).context

    it('sends an empty list when none is configured', async () => {
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test' }))
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(contextOf(mock, 0)).toEqual([])
      unmount()
    })

    it('sends composable-level context on send()', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', context: [{ description: 'Page', value: 'orders' }] }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(contextOf(mock, 0)).toEqual([{ description: 'Page', value: 'orders' }])
      unmount()
    })

    it('re-resolves a getter per request', async () => {
      const order = ref('4711')
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', context: () => [{ description: 'Order', value: order.value }] }),
      )
      const mock = getMock(result.agent)

      await result.send('one')
      order.value = '4800'
      await result.send('two')

      expect(contextOf(mock, 0)).toEqual([{ description: 'Order', value: '4711' }])
      expect(contextOf(mock, 1)).toEqual([{ description: 'Order', value: '4800' }])
      unmount()
    })

    it('carries context on the coordinator-issued continuation, picking up a change in between', async () => {
      const order = ref('4711')
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', context: () => [{ description: 'Order', value: order.value }] }),
      )
      const mock = getMock(result.agent)
      const registry = getToolRegistry(result.agent)!
      // A HITL tool: the result is submitted after the run, which fires continueRun.
      registry.register({ tool: { name: 'confirm' } as any, isEnabled: () => true })

      mock.runAgent.mockImplementationOnce(async () => {
        mock.emit('onToolCallStartEvent', { event: { toolCallId: 'call_1', toolCallName: 'confirm' } })
        mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
        mock.emit('onRunFinishedEvent', {})
        return {}
      })
      await result.send('why is this delayed?')

      order.value = '4800'
      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      await flush()

      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      expect(contextOf(mock, 0)).toEqual([{ description: 'Order', value: '4711' }])
      expect(contextOf(mock, 1)).toEqual([{ description: 'Order', value: '4800' }])
      unmount()
    })

    it('carries context on the onError retry, re-resolved', async () => {
      const order = ref('4711')
      const onError = vi.fn(async () => {
        order.value = '4800'
        return { retry: true }
      })
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          onError,
          context: () => [{ description: 'Order', value: order.value }],
        }),
      )
      const mock = getMock(result.agent)
      mock.runAgent.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))

      await result.send('hello')

      expect(mock.runAgent).toHaveBeenCalledTimes(2)
      expect(contextOf(mock, 0)).toEqual([{ description: 'Order', value: '4711' }])
      expect(contextOf(mock, 1)).toEqual([{ description: 'Order', value: '4800' }])
      unmount()
    })

    it('appends per-run context after the composable-level entries, for that request only', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', context: [{ description: 'Page', value: 'orders' }] }),
      )
      const mock = getMock(result.agent)

      await result.send('one', { context: [{ description: 'Selection', value: 'row 3' }] })
      await result.continueRun()

      expect(contextOf(mock, 0)).toEqual([
        { description: 'Page', value: 'orders' },
        { description: 'Selection', value: 'row 3' },
      ])
      expect(contextOf(mock, 1)).toEqual([{ description: 'Page', value: 'orders' }])
      unmount()
    })

    it('JSON-serialises non-string values and drops undefined ones', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          context: [
            { description: 'Order', value: { id: '4711', status: 'customs' } },
            { description: 'Count', value: 3 },
            { description: 'Nothing selected', value: null },
            { description: 'Selection', value: undefined },
          ],
        }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(contextOf(mock, 0)).toEqual([
        { description: 'Order', value: '{"id":"4711","status":"customs"}' },
        { description: 'Count', value: '3' },
        { description: 'Nothing selected', value: 'null' },
      ])
      unmount()
    })

    it('accepts a ref or computed as the whole context option', async () => {
      const entries = ref([{ description: 'Order', value: '4711' }])
      const page = ref('orders')
      const [result, unmount] = withSetup(() => useAgent({ url: 'http://test', context: entries }))
      const [computedResult, unmountComputed] = withSetup(() =>
        useAgent({ url: 'http://test', context: computed(() => [{ description: 'Page', value: page.value }]) }),
      )
      const mock = getMock(result.agent)
      const computedMock = getMock(computedResult.agent)

      await result.send('one')
      entries.value = [{ description: 'Order', value: '4800' }]
      await result.send('two')
      await computedResult.send('one')
      page.value = 'settings'
      await computedResult.send('two')

      expect(contextOf(mock, 0)).toEqual([{ description: 'Order', value: '4711' }])
      expect(contextOf(mock, 1)).toEqual([{ description: 'Order', value: '4800' }])
      expect(contextOf(computedMock, 0)).toEqual([{ description: 'Page', value: 'orders' }])
      expect(contextOf(computedMock, 1)).toEqual([{ description: 'Page', value: 'settings' }])
      unmount()
      unmountComputed()
    })

    // The storeToRefs() case: without unwrapping, a ref is sent as Vue
    // internals and a computed throws on its circular structure.
    it('unwraps ref, computed and getter entry values per request', async () => {
      const order = ref<{ id: string } | undefined>({ id: '4711' })
      const page = ref('orders')
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          context: [
            { description: 'Order', value: order },
            { description: 'Page', value: computed(() => `page:${page.value}`) },
            { description: 'Count', value: () => 3 },
          ],
        }),
      )
      const mock = getMock(result.agent)

      await result.send('one')
      order.value = undefined
      page.value = 'settings'
      await result.send('two')

      expect(contextOf(mock, 0)).toEqual([
        { description: 'Order', value: '{"id":"4711"}' },
        { description: 'Page', value: 'page:orders' },
        { description: 'Count', value: '3' },
      ])
      expect(contextOf(mock, 1)).toEqual([
        { description: 'Page', value: 'page:settings' },
        { description: 'Count', value: '3' },
      ])
      unmount()
    })

    it('drops entries whose value JSON cannot represent', async () => {
      const [result, unmount] = withSetup(() =>
        useAgent({
          url: 'http://test',
          context: [
            { description: 'Symbol', value: Symbol('x') },
            { description: 'Getter to a function', value: () => () => 'x' },
            { description: 'Page', value: 'orders' },
          ],
        }),
      )
      const mock = getMock(result.agent)

      await result.send('hello')

      expect(contextOf(mock, 0)).toEqual([{ description: 'Page', value: 'orders' }])
      unmount()
    })

    // Same failure mode as forwardedProps: the client structuredClones
    // RunAgentInput.context, which throws on a reactive proxy at any depth.
    it('strips reactive proxies from store-backed context', async () => {
      const store = reactive({
        entries: [{ description: 'Order', value: { id: '4711', lines: [{ sku: 'A' }] } }],
      })
      const [result, unmount] = withSetup(() =>
        useAgent({ url: 'http://test', context: () => store.entries }),
      )
      const mock = getMock(result.agent)

      await result.send('hello', { context: [reactive({ description: 'Filter', value: 'open' })] })

      const sent = contextOf(mock, 0)
      expect(() => structuredClone(sent)).not.toThrow()
      expect(sent).toEqual([
        { description: 'Order', value: '{"id":"4711","lines":[{"sku":"A"}]}' },
        { description: 'Filter', value: 'open' },
      ])
      unmount()
    })
  })
})
