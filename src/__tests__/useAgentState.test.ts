import { describe, it, expect } from 'vitest'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { useAgentState } from '../composables/useAgentState'

interface TestState {
  count: number
  label: string
}

function setup(
  options?: import('../composables/useAgentState').UseAgentStateOptions<TestState>,
  agentState?: any,
) {
  const mock = new MockHttpAgent()
  if (agentState !== undefined) mock.state = agentState
  let result!: ReturnType<typeof useAgentState<TestState>>
  let unmount!: () => void
  ;[result, unmount] = withSetup(() => useAgentState<TestState>(mock as any, options))
  return { mock, result, unmount }
}

describe('useAgentState', () => {
  describe('initialization', () => {
    it('uses initialState from options', () => {
      const { result, unmount } = setup({ initialState: { count: 5, label: 'hello' } })
      expect(result.state).toEqual({ count: 5, label: 'hello' })
      unmount()
    })

    it('writes initialState to the agent', () => {
      const { mock, unmount } = setup({ initialState: { count: 3, label: 'test' } })
      expect(mock.setState).toHaveBeenCalledWith({ count: 3, label: 'test' })
      unmount()
    })

    it('does not capture the caller initialState object (clones it)', () => {
      const initialState = { count: 1, label: 'orig' }
      const { result, unmount } = setup({ initialState })
      result.state.count = 99
      // mutating the reactive state must not bleed into the caller's object
      expect(initialState.count).toBe(1)
      unmount()
    })

    it('falls back to agent.state when no initialState is given', () => {
      const { result, unmount } = setup(undefined, { count: 10, label: 'existing' })
      expect(result.state).toEqual({ count: 10, label: 'existing' })
      unmount()
    })

    it('does not write to the agent when falling back to agent.state', () => {
      const { mock, unmount } = setup(undefined, { count: 10, label: 'existing' })
      expect(mock.setState).not.toHaveBeenCalled()
      unmount()
    })

    it('defaults to empty object when no initialState or agent.state exists', () => {
      const { result, unmount } = setup()
      expect(result.state).toEqual({})
      unmount()
    })
  })

  describe('outbound sync (direct mutation)', () => {
    it('syncs a top-level mutation to the agent', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })
      mock.setState.mockClear()

      result.state.count = 5

      expect(mock.setState).toHaveBeenCalledWith({ count: 5, label: '' })
      unmount()
    })

    it('syncs to agent.state synchronously, before the next run', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })

      result.state.label = 'ready'

      // No tick awaited — flush: 'sync' means agent.state is already up to date.
      expect(mock.state).toEqual({ count: 0, label: 'ready' })
      unmount()
    })

    it('syncs a deeply nested mutation', () => {
      const mock = new MockHttpAgent()
      let result!: ReturnType<typeof useAgentState<{ recipe: { ingredients: string[] } }>>
      let unmount!: () => void
      ;[result, unmount] = withSetup(() =>
        useAgentState(mock as any, { initialState: { recipe: { ingredients: [] } } }),
      )
      mock.setState.mockClear()

      result.state.recipe.ingredients.push('guanciale')

      expect(mock.setState).toHaveBeenCalledWith({ recipe: { ingredients: ['guanciale'] } })
      unmount()
    })

    it('strips Vue proxies — the agent receives a plain object', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })
      mock.setState.mockClear()

      result.state.count = 1

      const arg = mock.setState.mock.calls[0][0]
      // A reactive proxy cannot survive JSON.stringify, so this proves it was stripped.
      expect(JSON.stringify(arg)).toBe(JSON.stringify({ count: 1, label: '' }))
      expect(arg).not.toBe(result.state)
      unmount()
    })
  })

  describe('onStateSnapshotEvent (inbound)', () => {
    it('updates state from a snapshot', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onStateSnapshotEvent', {
        event: { snapshot: { count: 42, label: 'snapshot' } },
      })

      expect(result.state).toEqual({ count: 42, label: 'snapshot' })
      unmount()
    })

    it('replaces state entirely on each snapshot (removes stale keys)', () => {
      const mock = new MockHttpAgent()
      let result!: ReturnType<typeof useAgentState<Record<string, any>>>
      let unmount!: () => void
      ;[result, unmount] = withSetup(() =>
        useAgentState(mock as any, { initialState: { count: 1, label: 'old', extra: true } }),
      )

      mock.emit('onStateSnapshotEvent', {
        event: { snapshot: { count: 99, label: 'new' } },
      })

      expect(result.state).toEqual({ count: 99, label: 'new' })
      expect('extra' in result.state).toBe(false)
      unmount()
    })

    it('does not echo an inbound snapshot back to the agent', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })
      mock.setState.mockClear()

      mock.emit('onStateSnapshotEvent', {
        event: { snapshot: { count: 7, label: 'remote' } },
      })

      expect(mock.setState).not.toHaveBeenCalled()
      expect(result.state).toEqual({ count: 7, label: 'remote' })
      unmount()
    })
  })

  describe('onStateDeltaEvent (inbound)', () => {
    it('updates state from a delta', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onStateDeltaEvent', { state: { count: 7, label: 'delta' } })

      expect(result.state).toEqual({ count: 7, label: 'delta' })
      unmount()
    })

    it('does not echo an inbound delta back to the agent', () => {
      const { mock, unmount } = setup({ initialState: { count: 0, label: '' } })
      mock.setState.mockClear()

      mock.emit('onStateDeltaEvent', { state: { count: 9, label: 'delta' } })

      expect(mock.setState).not.toHaveBeenCalled()
      unmount()
    })

    it('resumes outbound sync after applying an inbound event', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })

      mock.emit('onStateDeltaEvent', { state: { count: 1, label: 'remote' } })
      mock.setState.mockClear()

      // A local mutation after the inbound event must still sync.
      result.state.count = 2

      expect(mock.setState).toHaveBeenCalledWith({ count: 2, label: 'remote' })
      unmount()
    })
  })

  describe('cleanup on unmount', () => {
    it('unsubscribes from the agent', () => {
      const { mock, unmount } = setup()
      expect(mock.subscriberCount).toBe(1)
      unmount()
      expect(mock.subscriberCount).toBe(0)
    })

    it('stops syncing after unmount', () => {
      const { mock, result, unmount } = setup({ initialState: { count: 0, label: '' } })
      unmount()
      mock.setState.mockClear()

      result.state.count = 5

      expect(mock.setState).not.toHaveBeenCalled()
    })
  })
})
