import { describe, it, expect, vi } from 'vitest'
import { defineComponent } from 'vue'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { useGenerativeUI } from '../composables/useGenerativeUI'
import type { GenUIRegistry } from '../composables/useGenerativeUI'
import type { UseAgentReturn } from '../composables/useAgent'

// Minimal stub Vue components for the registry
const WeatherCard = defineComponent({ name: 'WeatherCard', template: '<div />' })
const WeatherSkeleton = defineComponent({ name: 'WeatherSkeleton', template: '<div />' })
const RecipeCard = defineComponent({ name: 'RecipeCard', template: '<div />' })

function makeAgentContext(mock: MockHttpAgent): UseAgentReturn {
  return {
    agent: mock as any,
    messages: { value: [] } as any,
    isRunning: { value: false } as any,
    error: { value: null } as any,
    errorCode: { value: null } as any,
    streamingContent: { value: '' } as any,
    lastResult: { value: null } as any,
    lastOutcome: { value: null } as any,
    usage: { value: null } as any,
    messageRuns: { value: new Map() } as any,
    runForMessage: vi.fn(),
    interrupts: { value: [] } as any,
    send: vi.fn(),
    continueRun: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    setMessages: vi.fn(),
  }
}

function setup(registry: GenUIRegistry, options?: Parameters<typeof useGenerativeUI>[2]) {
  const mock = new MockHttpAgent()
  const agentCtx = makeAgentContext(mock)
  let result!: ReturnType<typeof useGenerativeUI>
  let unmount!: () => void
  ;[result, unmount] = withSetup(() => useGenerativeUI(agentCtx, registry, options))
  return { mock, agentCtx, result, unmount }
}

describe('useGenerativeUI', () => {
  describe('initial state', () => {
    it('starts with empty activeComponents', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.activeComponents.value).toEqual([])
      unmount()
    })

    it('starts with empty allComponents', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.allComponents.value).toEqual([])
      unmount()
    })

    it('builds tools array from bare component registry entries', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('show_weather')
      expect(result.tools[0].description).toBe('Render show_weather component')
      expect(result.tools[0].parameters).toEqual({ type: 'object', properties: {} })
      unmount()
    })

    it('uses description and parameters from GenUIEntry', () => {
      const { result, unmount } = setup({
        show_weather: {
          component: WeatherCard,
          description: 'Show current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      })
      expect(result.tools[0].description).toBe('Show current weather')
      expect(result.tools[0].parameters.properties).toEqual({ city: { type: 'string' } })
      unmount()
    })

    it('builds tools for multiple registry entries', () => {
      const { result, unmount } = setup({
        show_weather: WeatherCard,
        show_recipe: RecipeCard,
      })
      expect(result.tools).toHaveLength(2)
      expect(result.tools.map((t) => t.name)).toEqual(['show_weather', 'show_recipe'])
      unmount()
    })
  })

  describe('activeComponents', () => {
    it('shows a registered tool call once it starts', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })

      expect(result.activeComponents.value).toHaveLength(1)
      expect(result.activeComponents.value[0].id).toBe('call_1')
      expect(result.activeComponents.value[0].name).toBe('show_weather')
      expect(result.activeComponents.value[0].component).toBe(WeatherCard)
      unmount()
    })

    it('does not include unregistered tool calls', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'some_other_tool' },
      })

      expect(result.activeComponents.value).toHaveLength(0)
      unmount()
    })

    it('reflects streaming args as props once parseable', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallArgsEvent', {
        event: { toolCallId: 'call_1', delta: '{"city":"Berlin"}' },
      })

      expect(result.activeComponents.value[0].props).toEqual({ city: 'Berlin' })
      unmount()
    })

    it('sets isStreaming true while status is running', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })

      expect(result.activeComponents.value[0].isStreaming).toBe(true)
      unmount()
    })

    it('sets isStreaming false once args have ended (awaiting_result)', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })

      expect(result.activeComponents.value[0].isStreaming).toBe(false)
      unmount()
    })

    it('removes item from activeComponents once tool call completes', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '{"temp":22}' },
      })

      expect(result.activeComponents.value).toHaveLength(0)
      unmount()
    })

    it('tracks multiple active tool calls', () => {
      const { mock, result, unmount } = setup({
        show_weather: WeatherCard,
        show_recipe: RecipeCard,
      })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'show_recipe' },
      })

      expect(result.activeComponents.value).toHaveLength(2)
      unmount()
    })
  })

  describe('allComponents', () => {
    it('includes completed tool calls', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '{"temp":22}' },
      })

      expect(result.allComponents.value).toHaveLength(1)
      expect(result.allComponents.value[0].status).toBe('completed')
      unmount()
    })

    it('includes both active and completed tool calls', () => {
      const { mock, result, unmount } = setup({
        show_weather: WeatherCard,
        show_recipe: RecipeCard,
      })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '{}' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'show_recipe' },
      })

      expect(result.allComponents.value).toHaveLength(2)
      expect(result.activeComponents.value).toHaveLength(1)
      unmount()
    })

    it('does not include unregistered tool calls', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'unregistered_tool' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '{}' },
      })

      expect(result.allComponents.value).toHaveLength(0)
      unmount()
    })
  })

  describe('loading component', () => {
    it('shows loading component while streaming when configured', () => {
      const { mock, result, unmount } = setup({
        show_weather: {
          component: WeatherCard,
          loading: WeatherSkeleton,
        },
      })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })

      expect(result.activeComponents.value[0].component).toBe(WeatherSkeleton)
      expect(result.activeComponents.value[0].isStreaming).toBe(true)
      unmount()
    })

    it('switches from loading to main component once args end', () => {
      const { mock, result, unmount } = setup({
        show_weather: {
          component: WeatherCard,
          loading: WeatherSkeleton,
        },
      })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })

      expect(result.allComponents.value[0].component).toBe(WeatherCard)
      unmount()
    })

    it('uses main component even during streaming when no loading component configured', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })

      expect(result.activeComponents.value[0].component).toBe(WeatherCard)
      unmount()
    })
  })

  describe('resolve()', () => {
    it('returns the component for a registered tool name', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.resolve('show_weather')).toBe(WeatherCard)
      unmount()
    })

    it('returns the component from a GenUIEntry', () => {
      const { result, unmount } = setup({
        show_weather: { component: WeatherCard, loading: WeatherSkeleton },
      })
      expect(result.resolve('show_weather')).toBe(WeatherCard)
      unmount()
    })

    it('returns null for an unregistered tool name', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.resolve('unknown_tool')).toBeNull()
      unmount()
    })
  })

  describe('getProps()', () => {
    it('returns parsed args as props', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      const mockTc = { parsedArgs: { city: 'Tokyo', unit: 'celsius' } } as any
      expect(result.getProps(mockTc)).toEqual({ city: 'Tokyo', unit: 'celsius' })
      unmount()
    })

    it('returns empty object when parsedArgs is null', () => {
      const { result, unmount } = setup({ show_weather: WeatherCard })
      expect(result.getProps({ parsedArgs: null } as any)).toEqual({})
      unmount()
    })
  })

  describe('clear()', () => {
    it('removes all tracked components', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      expect(result.allComponents.value).toHaveLength(1)

      result.clear()

      expect(result.allComponents.value).toHaveLength(0)
      expect(result.activeComponents.value).toHaveLength(0)
      unmount()
    })
  })

  describe('autoClear option', () => {
    it('does not clear on new run start by default (autoClear: false)', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '{}' },
      })
      expect(result.allComponents.value).toHaveLength(1)

      mock.emit('onRunStartedEvent')

      expect(result.allComponents.value).toHaveLength(1)
      unmount()
    })

    it('clears on new run start when autoClear: true', () => {
      const { mock, result, unmount } = setup({ show_weather: WeatherCard }, { autoClear: true })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      expect(result.allComponents.value).toHaveLength(1)

      mock.emit('onRunStartedEvent')

      expect(result.allComponents.value).toHaveLength(0)
      unmount()
    })
  })

  describe('auto-submit tool results', () => {
    it('calls agent.addMessage with a tool result on RUN_FINISHED for a registered tool', () => {
      const { mock, agentCtx, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.agent.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call_1',
          content: JSON.stringify({ rendered: true }),
        }),
      )
      unmount()
    })

    it('calls continueRun after submitting the tool result on RUN_FINISHED', () => {
      const { mock, agentCtx, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.continueRun).toHaveBeenCalled()
      unmount()
    })

    it('does not submit a result for an unregistered tool', () => {
      const { mock, agentCtx, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'some_other_tool' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.agent.addMessage).not.toHaveBeenCalled()
      expect(agentCtx.continueRun).not.toHaveBeenCalled()
      unmount()
    })

    it('passes the tools array to continueRun', () => {
      const { mock, agentCtx, result, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.continueRun).toHaveBeenCalledWith(
        expect.objectContaining({ tools: result.tools }),
      )
      unmount()
    })

    it('submits results for all registered tools called in one turn', () => {
      const { mock, agentCtx, unmount } = setup({
        show_weather: WeatherCard,
        show_recipe: RecipeCard,
      })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'show_weather' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'show_recipe' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_2' } })
      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.agent.addMessage).toHaveBeenCalledTimes(2)
      expect(agentCtx.continueRun).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('does not call continueRun when no registered tools were called', () => {
      const { mock, agentCtx, unmount } = setup({ show_weather: WeatherCard })

      mock.emit('onRunFinishedEvent', {})

      expect(agentCtx.continueRun).not.toHaveBeenCalled()
      unmount()
    })
  })

  describe('cleanup on unmount', () => {
    it('unsubscribes from the agent', () => {
      const { mock, unmount } = setup({ show_weather: WeatherCard })
      // useToolCalls + useAgentEvent each add one subscriber
      expect(mock.subscriberCount).toBe(2)
      unmount()
      expect(mock.subscriberCount).toBe(0)
    })
  })
})
