import { describe, it, expect } from 'vitest'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { useToolCalls } from '../composables/useToolCalls'
import type { Message } from '@ag-ui/core'

function setup(options?: Parameters<typeof useToolCalls>[1]) {
  const mock = new MockHttpAgent()
  let result!: ReturnType<typeof useToolCalls>
  let unmount!: () => void
  ;[result, unmount] = withSetup(() => useToolCalls(mock as any, options))
  return { mock, result, unmount }
}

describe('useToolCalls', () => {
  describe('initial state', () => {
    it('starts with an empty tool call map', () => {
      const { result, unmount } = setup()
      expect(result.toolCalls.value.size).toBe(0)
      unmount()
    })

    it('activeToolCalls starts empty', () => {
      const { result, unmount } = setup()
      expect(result.activeToolCalls.value).toEqual([])
      unmount()
    })

    it('completedToolCalls starts empty', () => {
      const { result, unmount } = setup()
      expect(result.completedToolCalls.value).toEqual([])
      unmount()
    })
  })

  describe('tool call lifecycle', () => {
    it('onToolCallStartEvent creates a running tool call', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })

      const tc = result.getToolCall('call_1')
      expect(tc).toBeDefined()
      expect(tc!.id).toBe('call_1')
      expect(tc!.name).toBe('search')
      expect(tc!.status).toBe('running')
      expect(tc!.args).toBe('')
      expect(tc!.parsedArgs).toBeNull()
      expect(tc!.startedAt).toBeInstanceOf(Date)
      unmount()
    })

    it('onToolCallArgsEvent accumulates args and parses JSON progressively', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })

      // Partial JSON — not parseable yet
      mock.emit('onToolCallArgsEvent', { event: { toolCallId: 'call_1', delta: '{"query"' } })
      expect(result.getToolCall('call_1')!.parsedArgs).toBeNull()

      // Complete JSON — now parseable
      mock.emit('onToolCallArgsEvent', {
        event: { toolCallId: 'call_1', delta: ': "vue testing"}' },
      })
      expect(result.getToolCall('call_1')!.args).toBe('{"query": "vue testing"}')
      expect(result.getToolCall('call_1')!.parsedArgs).toEqual({ query: 'vue testing' })
      unmount()
    })

    it('onToolCallEndEvent transitions status to awaiting_result', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_1' } })

      expect(result.getToolCall('call_1')!.status).toBe('awaiting_result')
      unmount()
    })

    it('onToolCallResultEvent transitions status to completed with result', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: '[{"title":"Vue docs"}]' },
      })

      const tc = result.getToolCall('call_1')!
      expect(tc.status).toBe('completed')
      expect(tc.result).toBe('[{"title":"Vue docs"}]')
      expect(tc.completedAt).toBeInstanceOf(Date)
      expect(tc.duration).toBeGreaterThanOrEqual(0)
      unmount()
    })

    it('keeps the full ContentPart[] in resultContent and flattens result to text', () => {
      const { mock, result, unmount } = setup()
      const content = [
        { type: 'text', text: 'Here is the chart' },
        { type: 'image', source: { type: 'url', value: 'https://example.com/c.png' } },
      ]

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'chart' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content },
      })

      const tc = result.getToolCall('call_1')!
      expect(tc.resultContent).toEqual(content)
      expect(tc.result).toBe('Here is the chart')
      unmount()
    })
  })

  describe('computed properties', () => {
    it('activeToolCalls includes running and awaiting_result', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'lookup' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_2' } })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: 'done' },
      })

      // call_1 completed, call_2 awaiting_result
      expect(result.activeToolCalls.value.map((tc) => tc.id)).toEqual(['call_2'])
      unmount()
    })

    it('completedToolCalls includes completed and error status', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'b' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: 'ok' },
      })
      mock.emit('onRunErrorEvent')

      expect(result.completedToolCalls.value.map((tc) => tc.id)).toContain('call_1')
      expect(result.completedToolCalls.value.map((tc) => tc.id)).toContain('call_2')
      unmount()
    })
  })

  describe('onRunErrorEvent', () => {
    it('marks all running and awaiting_result tool calls as errored', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'b' },
      })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'call_2' } })

      mock.emit('onRunErrorEvent')

      expect(result.getToolCall('call_1')!.status).toBe('error')
      expect(result.getToolCall('call_2')!.status).toBe('error')
      unmount()
    })

    it('does not overwrite already completed tool calls on error', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      mock.emit('onToolCallResultEvent', {
        event: { toolCallId: 'call_1', content: 'done' },
      })

      mock.emit('onRunErrorEvent')

      expect(result.getToolCall('call_1')!.status).toBe('completed')
      unmount()
    })
  })

  describe('onRunStartedEvent', () => {
    it('clears existing tool calls when autoClear is true (default)', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      expect(result.toolCalls.value.size).toBe(1)

      mock.emit('onRunStartedEvent')

      expect(result.toolCalls.value.size).toBe(0)
      unmount()
    })

    it('keeps existing tool calls when autoClear is false', () => {
      const { mock, result, unmount } = setup({ autoClear: false })

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      expect(result.toolCalls.value.size).toBe(1)

      mock.emit('onRunStartedEvent')

      expect(result.toolCalls.value.size).toBe(1)
      unmount()
    })
  })

  describe('clear()', () => {
    it('empties the tool call map', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'a' },
      })
      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_2', toolCallName: 'b' },
      })
      expect(result.toolCalls.value.size).toBe(2)

      result.clear()

      expect(result.toolCalls.value.size).toBe(0)
      unmount()
    })
  })

  describe('getToolCall()', () => {
    it('returns the tool call for a known id', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })

      expect(result.getToolCall('call_1')).toBeDefined()
      unmount()
    })

    it('returns undefined for an unknown id', () => {
      const { result, unmount } = setup()
      expect(result.getToolCall('nonexistent')).toBeUndefined()
      unmount()
    })
  })

  describe('getToolResult()', () => {
    it('finds the tool result message by toolCallId', () => {
      const { result, unmount } = setup()
      const messages: Message[] = [
        { id: 'msg_1', role: 'user', content: 'hi' } as any,
        { id: 'msg_2', role: 'tool', content: '{"ok":true}', toolCallId: 'call_1' } as any,
      ]

      const found = result.getToolResult('call_1', messages)
      expect(found).toBeDefined()
      expect((found as any).content).toBe('{"ok":true}')
      unmount()
    })

    it('returns undefined when no matching result exists', () => {
      const { result, unmount } = setup()
      const messages: Message[] = [
        { id: 'msg_1', role: 'user', content: 'hi' } as any,
      ]

      expect(result.getToolResult('call_99', messages)).toBeUndefined()
      unmount()
    })
  })

  describe('markCompleted()', () => {
    it('marks a tool call as completed with result', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })
      result.markCompleted('call_1', 'result data')

      const tc = result.getToolCall('call_1')!
      expect(tc.status).toBe('completed')
      expect(tc.result).toBe('result data')
      expect(tc.resultContent).toBe('result data')
      expect(tc.completedAt).toBeInstanceOf(Date)
      expect(tc.duration).toBeGreaterThanOrEqual(0)
      unmount()
    })

    it('marks as completed without a result', () => {
      const { mock, result, unmount } = setup()

      mock.emit('onToolCallStartEvent', {
        event: { toolCallId: 'call_1', toolCallName: 'search' },
      })
      result.markCompleted('call_1')

      expect(result.getToolCall('call_1')!.status).toBe('completed')
      expect(result.getToolCall('call_1')!.result).toBeNull()
      expect(result.getToolCall('call_1')!.resultContent).toBeNull()
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
  })
})
