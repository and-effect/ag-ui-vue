import { describe, it, expect, vi } from 'vitest'
import { effectScope } from 'vue'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { createToolRegistry, getToolRegistry } from '../composables/toolRegistry'
import type { RegisteredTool } from '../composables/toolRegistry'
import type { Tool } from '@ag-ui/core'

function makeTool(name: string): Tool {
  return { name, description: name, parameters: { type: 'object', properties: {} } } as Tool
}

// createToolRegistry calls onScopeDispose, so it needs an active effect scope.
function withRegistry(continueRun = vi.fn()) {
  const mock = new MockHttpAgent()
  const scope = effectScope()
  let registry!: ReturnType<typeof createToolRegistry>
  scope.run(() => {
    registry = createToolRegistry(mock as any, { continueRun })
  })
  return { mock, registry, continueRun, stop: () => scope.stop() }
}

// Register a tool whose onEnd submits a result, modelling an automatic tool.
function registerAuto(
  registry: ReturnType<typeof createToolRegistry>,
  name: string,
  extra: Partial<RegisteredTool> = {},
) {
  return registry.register({
    tool: makeTool(name),
    isEnabled: () => true,
    onEnd(id) {
      registry.submitResult(id, JSON.stringify({ ok: true }))
    },
    ...extra,
  })
}

function emitCall(mock: MockHttpAgent, name: string, id: string, args: object = {}) {
  mock.emit('onToolCallStartEvent', { event: { toolCallId: id, toolCallName: name } })
  mock.emit('onToolCallArgsEvent', { event: { toolCallId: id, delta: JSON.stringify(args) } })
  mock.emit('onToolCallEndEvent', { event: { toolCallId: id } })
}

describe('toolRegistry coordinator', () => {
  it('binds to the agent and is discoverable via getToolRegistry', () => {
    const { mock, registry, stop } = withRegistry()
    expect(getToolRegistry(mock as any)).toBe(registry)
    stop()
    expect(getToolRegistry(mock as any)).toBeUndefined()
  })

  describe('enabledTools / mergeTools', () => {
    it('includes enabled tools and excludes disabled ones', () => {
      const { registry, stop } = withRegistry()
      registry.register({ tool: makeTool('a'), isEnabled: () => true })
      registry.register({ tool: makeTool('b'), isEnabled: () => false })
      expect(registry.enabledTools().map((t) => t.name)).toEqual(['a'])
      stop()
    })

    it('reflects enabled toggling reactively (read fresh)', () => {
      const { registry, stop } = withRegistry()
      let on = false
      registry.register({ tool: makeTool('a'), isEnabled: () => on })
      expect(registry.enabledTools()).toHaveLength(0)
      on = true
      expect(registry.enabledTools().map((t) => t.name)).toEqual(['a'])
      stop()
    })

    it('merges registered with explicit tools, explicit overriding by name', () => {
      const { registry, stop } = withRegistry()
      registry.register({ tool: makeTool('a'), isEnabled: () => true })
      const explicitA = { ...makeTool('a'), description: 'override' }
      const merged = registry.mergeTools([explicitA, makeTool('c')])
      expect(merged.map((t) => t.name).sort()).toEqual(['a', 'c'])
      expect(merged.find((t) => t.name === 'a')!.description).toBe('override')
      stop()
    })
  })

  describe('single batched continueRun gate', () => {
    it('fires exactly one continueRun once the run finishes and all results are in', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')

      emitCall(mock, 'a', 'call_1')
      expect(continueRun).not.toHaveBeenCalled() // run not finished yet

      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1)
      expect(continueRun).toHaveBeenCalledWith(
        expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: 'a' })]) }),
      )
      stop()
    })

    it('produces exactly one continueRun for two tools called in one turn', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')
      registerAuto(registry, 'b')

      emitCall(mock, 'a', 'call_1')
      emitCall(mock, 'b', 'call_2')
      mock.emit('onRunFinishedEvent', {})

      expect(mock.addMessage).toHaveBeenCalledTimes(2)
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })

    it('waits for a deferred (HITL-style) result before continuing', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      // onEnd intentionally does NOT submit — models a pending HITL call.
      registry.register({ tool: makeTool('a'), isEnabled: () => true })

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).not.toHaveBeenCalled() // still waiting on the human

      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })

    it('does not continue when no registered tool was called', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('ignores calls to unregistered tools', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')
      emitCall(mock, 'other', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('does not dispatch onEnd or continue when a result already exists', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      const onEnd = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onEnd })
      // Backend already produced a result for this id.
      mock.messages.push({ id: 'm', role: 'tool', content: 'x', toolCallId: 'call_1' } as any)

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', {})

      expect(onEnd).not.toHaveBeenCalled()
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('resets and does not continue on run error', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')
      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunErrorEvent', {})
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })
  })

  describe('unregister', () => {
    it('removes the tool from what is advertised', () => {
      const { registry, stop } = withRegistry()
      const unregister = registry.register({ tool: makeTool('a'), isEnabled: () => true })
      expect(registry.enabledTools().map((t) => t.name)).toEqual(['a'])
      unregister()
      expect(registry.enabledTools()).toHaveLength(0)
      stop()
    })

    it('submits an error result for unresolved calls and advances the gate (#3)', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      // 'a' stays pending (onEnd does not submit); 'b' resolves automatically.
      const unregisterA = registry.register({ tool: makeTool('a'), isEnabled: () => true, onEnd() {} })
      registerAuto(registry, 'b')

      emitCall(mock, 'a', 'call_1')
      emitCall(mock, 'b', 'call_2')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).not.toHaveBeenCalled() // 'a' still pending

      unregisterA()
      expect(mock.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'call_1', error: 'Tool unregistered' }),
      )
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })
  })

  describe('turn abandonment and superseding (#1, #2, #4)', () => {
    it('abandonTurn terminates unresolved calls and drops a later submitResult (#1)', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      const onTerminate = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate, onEnd() {} })
      emitCall(mock, 'a', 'call_1')

      registry.abandonTurn() // what useAgent.reset()/abort() call
      expect(onTerminate).toHaveBeenCalledWith('call_1')

      // A slow handler resolving after the reset must not inject into the discarded turn.
      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('run error terminates unresolved calls and drops their late results (#2)', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      const onTerminate = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate, onEnd() {} })
      emitCall(mock, 'a', 'call_1')

      mock.emit('onRunErrorEvent', {})
      expect(onTerminate).toHaveBeenCalledWith('call_1')

      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('a new run starting while a call is unresolved terminates it and drops its late result (#1)', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      const onTerminate = vi.fn()
      // HITL-style tool: onEnd does NOT submit a result, so the call stays unresolved.
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate, onEnd() {} })
      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', {}) // run ends with the call still pending

      // User sends a fresh message instead of answering — the new run begins.
      mock.emit('onRunStartedEvent', {})
      expect(onTerminate).toHaveBeenCalledWith('call_1')

      // A late HITL response must not inject into the now-superseded turn.
      registry.submitResult('call_1', JSON.stringify({ ok: true }))
      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('a clean turn boundary does not spuriously terminate resolved calls', () => {
      const { mock, registry, stop } = withRegistry()
      const onTerminate = vi.fn()
      registerAuto(registry, 'a', { onTerminate })
      emitCall(mock, 'a', 'call_1') // auto tool resolves synchronously in onEnd
      mock.emit('onRunFinishedEvent', {})

      mock.emit('onRunStartedEvent', {}) // next turn boundary
      expect(onTerminate).not.toHaveBeenCalled()
      stop()
    })

    it('dispatches onTerminate when a result already exists (dedup, #4)', () => {
      const { mock, registry, stop } = withRegistry()
      const onTerminate = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate })
      mock.messages.push({ id: 'm', role: 'tool', content: 'x', toolCallId: 'call_1' } as any)

      emitCall(mock, 'a', 'call_1')
      expect(onTerminate).toHaveBeenCalledWith('call_1')
      stop()
    })
  })

  describe('run outcome gate', () => {
    it.each(['interrupt', 'cancelled'])(
      'never continues after an %s outcome, even with every result in',
      (outcome) => {
        const { mock, registry, continueRun, stop } = withRegistry()
        registerAuto(registry, 'a')

        emitCall(mock, 'a', 'call_1')
        mock.emit('onRunFinishedEvent', { outcome, interrupts: [] })

        expect(continueRun).not.toHaveBeenCalled()
        stop()
      },
    )

    it('keeps a pending HITL call answerable across an interrupt outcome, without continuing', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      const onTerminate = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate })

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', { outcome: 'interrupt', interrupts: [] })
      expect(onTerminate).not.toHaveBeenCalled()
      expect(registry.hasUnresolvedCalls()).toBe(true)

      // The answer lands in the transcript for the resume run to carry…
      registry.submitResult('call_1', '"approved"')
      expect(mock.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'tool', toolCallId: 'call_1', content: '"approved"' }),
      )
      expect(registry.hasUnresolvedCalls()).toBe(false)
      // …but a plain continuation would be refused while interrupts are open.
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('starts the resume run with a fresh turn', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', { outcome: 'interrupt', interrupts: [] })
      mock.emit('onRunStartedEvent', {})
      mock.emit('onRunFinishedEvent', { outcome: 'success' })

      // The resume run already carried call_1's result: nothing to continue.
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('terminates a pending HITL call on a cancelled outcome', () => {
      const { mock, registry, stop } = withRegistry()
      const onTerminate = vi.fn()
      registry.register({ tool: makeTool('a'), isEnabled: () => true, onTerminate })

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', { outcome: 'cancelled' })
      registry.submitResult('call_1', '"late"') // the stale closure is now dead

      expect(onTerminate).toHaveBeenCalledWith('call_1')
      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(registry.hasUnresolvedCalls()).toBe(false)
      stop()
    })

    it('continues after an explicit success outcome', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a')

      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', { outcome: 'success', pendingToolCallIds: ['call_1'] })

      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })
  })

  describe('followUp gate', () => {
    it('fires continueRun when followUp defaults to true', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registerAuto(registry, 'a') // followUp not set → defaults to true
      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })

    it('does NOT fire continueRun when followUp: false', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registry.register({
        tool: makeTool('sideEffect'),
        isEnabled: () => true,
        followUp: false,
        onEnd(id) {
          registry.submitResult(id, JSON.stringify({ ok: true }))
        },
      })
      emitCall(mock, 'sideEffect', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).not.toHaveBeenCalled()
      stop()
    })

    it('fires continueRun when mixed turn has at least one followUp: true', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registry.register({
        tool: makeTool('sideEffect'),
        isEnabled: () => true,
        followUp: false,
        onEnd(id) { registry.submitResult(id, JSON.stringify({ ok: true })) },
      })
      registerAuto(registry, 'withFollowUp') // followUp: true (default)
      emitCall(mock, 'sideEffect', 'call_1')
      emitCall(mock, 'withFollowUp', 'call_2')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })

    it('fires continueRun for followUp:false tool when forceFollowUp is set (validation error)', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      registry.register({
        tool: makeTool('sideEffect'),
        isEnabled: () => true,
        followUp: false,
        onEnd(id) {
          // Simulate a validation error — forceFollowUp overrides followUp:false
          registry.submitResult(
            id,
            JSON.stringify({ error: 'input-error', message: 'bad args' }),
            'bad args',
            { forceFollowUp: true },
          )
        },
      })
      emitCall(mock, 'sideEffect', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1)
      stop()
    })

    it('resets needsFollowUp between turns so a prior followUp:true does not bleed into the next', () => {
      const { mock, registry, continueRun, stop } = withRegistry()
      // Turn 1: followUp:true — fires continueRun
      registerAuto(registry, 'a')
      emitCall(mock, 'a', 'call_1')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1)

      // Turn 2: followUp:false only — should NOT fire continueRun again
      registry.register({
        tool: makeTool('sideEffect'),
        isEnabled: () => true,
        followUp: false,
        onEnd(id) { registry.submitResult(id, JSON.stringify({ ok: true })) },
      })
      mock.emit('onRunStartedEvent', {})
      emitCall(mock, 'sideEffect', 'call_2')
      mock.emit('onRunFinishedEvent', {})
      expect(continueRun).toHaveBeenCalledTimes(1) // still 1 — not called a second time
      stop()
    })
  })

})
