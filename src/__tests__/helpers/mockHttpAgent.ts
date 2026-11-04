import { vi } from 'vitest'
import type { AgentSubscriber } from '@ag-ui/client'
import type { Interrupt, Message, State } from '@ag-ui/core'

/**
 * Minimal mock of HttpAgent for use in composable tests.
 * Tracks subscribers and lets tests emit events directly.
 */
export class MockHttpAgent {
  messages: Message[] = []
  state: State = {}
  /** Mirrors `AbstractAgent.pendingInterrupts`: the open interrupts the client gates runs on. */
  pendingInterrupts: Interrupt[] = []

  // Request config — mirrors the real HttpAgent's documented mutable-config
  // behavior: url/headers/threadId are public fields read fresh when each fetch
  // is built (see HttpAgent.requestInit). Tests assert what a run *would* use by
  // reading them back. Load-bearing assumption: if HttpAgent ever snapshots
  // config at construction instead, these tests would pass while production
  // breaks — so the "reads fresh per request" fact must stay verified upstream.
  url: string
  headers: Record<string, string>
  threadId: string

  private _subscribers: AgentSubscriber[] = []

  /**
   * Every constructed instance, in creation order. Lets a test reach an agent
   * created internally by a composable that does not expose it (e.g. the active
   * thread's agent inside `useThreads`). Call `MockHttpAgent.instances.length = 0`
   * in a `beforeEach` to reset between tests.
   */
  static instances: MockHttpAgent[] = []

  constructor(config: { url?: string; headers?: Record<string, string>; threadId?: string } = {}) {
    this.url = config.url ?? ''
    this.headers = config.headers ?? {}
    this.threadId = config.threadId ?? ''
    MockHttpAgent.instances.push(this)
  }

  runAgent = vi.fn().mockResolvedValue({})
  abortRun = vi.fn()
  setState = vi.fn().mockImplementation((newState: State) => {
    this.state = newState
  })
  addMessage = vi.fn().mockImplementation((msg: Message) => {
    this.messages.push(msg)
  })

  /**
   * Run a fake stream and return a faithful `RunAgentResult`.
   *
   * Mirrors what `AbstractAgent.runAgent` really does: snapshot the message ids
   * present *before* the stream, then report everything added during it as
   * `newMessages`. Load-bearing for the provenance tests — `useAgent` derives
   * message→run attribution from that diff, not from scanning the messages
   * array, so a `runAgent` stub that omits `newMessages` produces no provenance
   * at all (which is also why the plain `mockResolvedValue({})` default is fine
   * for tests that don't assert on it).
   */
  stream(body: () => void): { result: undefined; newMessages: Message[] } {
    const before = new Set(this.messages.map((m) => m.id))
    body()
    return { result: undefined, newMessages: this.messages.filter((m) => !before.has(m.id)) }
  }

  subscribe(subscriber: AgentSubscriber) {
    this._subscribers.push(subscriber)
    return {
      unsubscribe: () => {
        const idx = this._subscribers.indexOf(subscriber)
        if (idx >= 0) this._subscribers.splice(idx, 1)
      },
    }
  }

  /** Trigger a subscriber event on all registered subscribers. */
  emit<K extends keyof AgentSubscriber>(eventName: K, arg?: any): void {
    for (const sub of this._subscribers) {
      const handler = sub[eventName]
      if (typeof handler === 'function') {
        ;(handler as (arg: any) => void)(arg)
      }
    }
  }

  /** Mirrors `AbstractAgent.subscribers` (public on the real client). */
  get subscribers(): AgentSubscriber[] {
    return this._subscribers
  }

  get subscriberCount(): number {
    return this._subscribers.length
  }
}
