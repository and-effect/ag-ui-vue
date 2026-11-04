import { describe, it, expect, vi } from 'vitest'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { useAgentEvent } from '../composables/useAgentEvent'

describe('useAgentEvent', () => {
  it('subscribes to the agent on mount', () => {
    const mock = new MockHttpAgent()
    expect(mock.subscriberCount).toBe(0)

    const subscriber = { onMessagesChanged: vi.fn() }
    const [, unmount] = withSetup(() => useAgentEvent(mock as any, subscriber))

    expect(mock.subscriberCount).toBe(1)
    unmount()
  })

  it('unsubscribes from the agent on unmount', () => {
    const mock = new MockHttpAgent()
    const subscriber = { onMessagesChanged: vi.fn() }
    const [, unmount] = withSetup(() => useAgentEvent(mock as any, subscriber))

    expect(mock.subscriberCount).toBe(1)
    unmount()
    expect(mock.subscriberCount).toBe(0)
  })

  it('the subscribed handler is called when the event fires', () => {
    const mock = new MockHttpAgent()
    const handler = vi.fn()
    const subscriber = { onMessagesChanged: handler }

    const [, unmount] = withSetup(() => useAgentEvent(mock as any, subscriber))
    mock.emit('onMessagesChanged')

    expect(handler).toHaveBeenCalledOnce()
    unmount()
  })

  it('does not call the handler after unmount', () => {
    const mock = new MockHttpAgent()
    const handler = vi.fn()
    const subscriber = { onMessagesChanged: handler }

    const [, unmount] = withSetup(() => useAgentEvent(mock as any, subscriber))
    unmount()
    mock.emit('onMessagesChanged')

    expect(handler).not.toHaveBeenCalled()
  })
})
