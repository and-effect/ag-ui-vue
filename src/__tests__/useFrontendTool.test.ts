import { vi, describe, it, expect } from 'vitest'
import { type } from 'arktype'
import { z } from 'zod'
import { ref, reactive, isReactive, toRaw } from 'vue'
import { withSetup } from './helpers/withSetup'
import { MockHttpAgent } from './helpers/mockHttpAgent'
import { useFrontendTool } from '../composables/useFrontendTool'
import { getToolRegistry } from '../composables/toolRegistry'
import type { UseAgentReturn } from '../composables/useAgent'
import type { UseFrontendToolOptions } from '../composables/useFrontendTool'

// Builds a minimal agent context backed by a MockHttpAgent. useFrontendTool
// only touches `agent` (for events/messages) and `continueRun`.
function setup(options: UseFrontendToolOptions) {
  const mock = new MockHttpAgent()
  const continueRun = vi.fn().mockResolvedValue(undefined)
  const ctx = { agent: mock, continueRun } as unknown as UseAgentReturn
  let result!: ReturnType<typeof useFrontendTool>
  let unmount!: () => void
  ;[result, unmount] = withSetup(() => useFrontendTool(ctx, options))
  return { mock, continueRun, result, unmount }
}

// Mounts several tools against a single shared context (one agent, one registry).
function setupMulti(optionsList: UseFrontendToolOptions[]) {
  const mock = new MockHttpAgent()
  const continueRun = vi.fn().mockResolvedValue(undefined)
  const ctx = { agent: mock, continueRun } as unknown as UseAgentReturn
  let results!: ReturnType<typeof useFrontendTool>[]
  let unmount!: () => void
  ;[results, unmount] = withSetup(() => optionsList.map((o) => useFrontendTool(ctx, o)))
  return { mock, continueRun, results, unmount }
}

// Drives a full tool-call lifecycle for the given tool name through the mock.
function emitToolCall(mock: MockHttpAgent, name: string, id: string, args: object) {
  mock.emit('onToolCallStartEvent', { event: { toolCallId: id, toolCallName: name } })
  mock.emit('onToolCallArgsEvent', { event: { toolCallId: id, delta: JSON.stringify(args) } })
  return mock.emit('onToolCallEndEvent', { event: { toolCallId: id } })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const baseOptions = {
  name: 'doThing',
  description: 'does a thing',
  parameters: { type: 'object', properties: {} },
}

describe('useFrontendTool — reactive enabled', () => {
  it('defaults enabled to true when omitted', () => {
    const { result, unmount } = setup({ ...baseOptions })
    expect(result.enabled.value).toBe(true)
    unmount()
  })

  it('accepts a static boolean and stays writable', () => {
    const { result, unmount } = setup({ ...baseOptions, enabled: false })
    expect(result.enabled.value).toBe(false)
    result.enabled.value = true
    expect(result.enabled.value).toBe(true)
    unmount()
  })

  it('tracks a ref passed as enabled', () => {
    const flag = ref(true)
    const { result, unmount } = setup({ ...baseOptions, enabled: flag })
    expect(result.enabled.value).toBe(true)
    flag.value = false
    expect(result.enabled.value).toBe(false)
    unmount()
  })

  it('tracks a getter passed as enabled', () => {
    const flag = ref(false)
    const { result, unmount } = setup({ ...baseOptions, enabled: () => flag.value })
    expect(result.enabled.value).toBe(false)
    flag.value = true
    expect(result.enabled.value).toBe(true)
    unmount()
  })

  it('stays a raw (un-proxied) object inside a reactive container while its enabled ref keeps tracking', () => {
    const flag = ref(true)
    const { result, unmount } = setup({ ...baseOptions, enabled: flag })

    // The documented multi-tool pattern collects tools into a reactive container.
    // markRaw at the source means the tool is NOT proxied even in here, so it
    // crosses into @ag-ui/client's structuredClone without a per-call toRaw strip.
    const allTools = reactive<{ tools: any[] }>({ tools: [] })
    allTools.tools = [result.tool]

    const fromContainer = allTools.tools[0]
    expect(isReactive(fromContainer)).toBe(false)
    expect(toRaw(fromContainer)).toBe(fromContainer)
    expect(fromContainer).toBe(result.tool)
    // structuredClone would throw on a reactive proxy; raw objects clone fine.
    expect(() => structuredClone(fromContainer)).not.toThrow()

    // markRaw freezes proxying of the container, not the inner ref — it still tracks.
    flag.value = false
    expect(result.enabled.value).toBe(false)
    unmount()
  })

  it('skips execution while disabled, runs once re-enabled — without re-creating the tool', async () => {
    const flag = ref(false)
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const { mock, continueRun, result, unmount } = setup({ ...baseOptions, enabled: () => flag.value, handler })

    const tool = result.tool

    // Disabled: the tool call is ignored, no handler, no follow-up run.
    await emitToolCall(mock, 'doThing', 'call_1', { x: 1 })
    expect(handler).not.toHaveBeenCalled()
    expect(continueRun).not.toHaveBeenCalled()

    // Toggle the source — same tool object, no recreation.
    flag.value = true
    expect(result.tool).toBe(tool)

    await emitToolCall(mock, 'doThing', 'call_2', { x: 2 })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toEqual({ x: 2 })
    unmount()
  })
})

describe('useFrontendTool — auto-registration', () => {
  it('registers the tool with the agent coordinator so it is advertised automatically', () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    const registry = getToolRegistry(mock as any)!
    expect(registry).toBeDefined()
    expect(registry.enabledTools().map((t) => t.name)).toContain('doThing')
    expect(registry.enabledTools()[0]).toBe(result.tool)
    unmount()
  })

  it('excludes a disabled tool from what is advertised (RunAgentInput.tools)', () => {
    const flag = ref(true)
    const { mock, unmount } = setup({ ...baseOptions, enabled: flag })
    const registry = getToolRegistry(mock as any)!
    expect(registry.enabledTools()).toHaveLength(1)
    flag.value = false
    expect(registry.enabledTools()).toHaveLength(0)
    unmount()
  })

  it('two tools called in one turn produce exactly one continueRun', async () => {
    const handlerA = vi.fn().mockResolvedValue({ a: 1 })
    const handlerB = vi.fn().mockResolvedValue({ b: 2 })
    const { mock, continueRun, unmount } = setupMulti([
      { name: 'toolA', description: 'a', parameters: {}, handler: handlerA },
      { name: 'toolB', description: 'b', parameters: {}, handler: handlerB },
    ])

    emitToolCall(mock, 'toolA', 'call_1', { x: 1 })
    emitToolCall(mock, 'toolB', 'call_2', { y: 2 })
    await flush() // let both handlers resolve and submit
    mock.emit('onRunFinishedEvent', {})
    await flush()

    expect(mock.addMessage).toHaveBeenCalledTimes(2)
    expect(continueRun).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('unregisters on unmount (coordinator torn down)', () => {
    const { mock, unmount } = setup({ ...baseOptions })
    expect(getToolRegistry(mock as any)).toBeDefined()
    unmount()
    expect(getToolRegistry(mock as any)).toBeUndefined()
  })
})

describe('useFrontendTool — per-call lifecycle', () => {
  it('tracks two parallel calls of the same HITL tool independently', () => {
    const { mock, result, unmount } = setup({ ...baseOptions }) // no handler → HITL
    emitToolCall(mock, 'doThing', 'call_1', { n: 1 })
    emitToolCall(mock, 'doThing', 'call_2', { n: 2 })

    expect(result.calls.value).toHaveLength(2)
    expect(result.calls.value.map((c) => c.id)).toEqual(['call_1', 'call_2'])
    expect(result.calls.value.every((c) => c.status === 'pending')).toBe(true)
    expect(result.calls.value[0].args).toEqual({ n: 1 })
    expect(result.calls.value[1].args).toEqual({ n: 2 })
    unmount()
  })

  it('exposes partial args while streaming (streaming-args status)', () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    mock.emit('onToolCallStartEvent', { event: { toolCallId: 'call_1', toolCallName: 'doThing' } })
    expect(result.calls.value[0].status).toBe('streaming-args')

    // Unparseable partial — args stay at last good value ({}).
    mock.emit('onToolCallArgsEvent', { event: { toolCallId: 'call_1', delta: '{"city":' } })
    expect(result.calls.value[0].args).toEqual({})

    // Now parseable.
    mock.emit('onToolCallArgsEvent', { event: { toolCallId: 'call_1', delta: '"Berlin"}' } })
    expect(result.calls.value[0].args).toEqual({ city: 'Berlin' })
    expect(result.calls.value[0].status).toBe('streaming-args')
    unmount()
  })

  it('resolves any pending HITL call directly, not just the oldest', async () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    emitToolCall(mock, 'doThing', 'call_1', {})
    emitToolCall(mock, 'doThing', 'call_2', {})

    // Answer the SECOND call first.
    await result.calls.value[1].respond!('second')

    expect(result.calls.value[1].status).toBe('complete')
    expect(result.calls.value[0].status).toBe('pending')
    expect(mock.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', toolCallId: 'call_2', content: 'second' }),
    )
    unmount()
  })

  it('reject submits an error result for that call', async () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    emitToolCall(mock, 'doThing', 'call_1', {})
    await result.calls.value[0].reject!('nope')

    expect(result.calls.value[0].status).toBe('error')
    expect(mock.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', toolCallId: 'call_1', error: 'nope' }),
    )
    unmount()
  })

  it('automatic handler drives executing → complete and populates lastResult', async () => {
    const handler = vi.fn().mockResolvedValue({ done: true })
    const { mock, result, unmount } = setup({ ...baseOptions, handler })

    emitToolCall(mock, 'doThing', 'call_1', { x: 1 })
    expect(result.calls.value[0].status).toBe('executing') // synchronous, pre-await

    await flush()
    expect(result.calls.value[0].status).toBe('complete')
    expect(result.calls.value[0].result).toEqual({ done: true })
    expect(result.lastResult.value).toEqual({ done: true })
    expect(result.isExecuting.value).toBe(false)
    unmount()
  })

  it('automatic handler error sets error status and lastError', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'))
    const { mock, result, unmount } = setup({ ...baseOptions, handler })

    emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()

    expect(result.calls.value[0].status).toBe('error')
    expect(result.lastError.value?.message).toBe('boom')
    unmount()
  })

  it('derived pending/resolve still answer the oldest call (back-compat)', async () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    emitToolCall(mock, 'doThing', 'call_1', { a: 1 })
    emitToolCall(mock, 'doThing', 'call_2', { a: 2 })

    expect(result.pending.value?.id).toBe('call_1')
    await result.resolve('ok')

    expect(result.calls.value[0].status).toBe('complete')
    expect(result.pending.value?.id).toBe('call_2') // advanced to the next
    unmount()
  })
})

describe('useFrontendTool — turn abandonment & retention (review fixes)', () => {
  it('run error marks pending HITL calls as error and kills respond (#2)', async () => {
    const { mock, result, unmount } = setup({ ...baseOptions }) // HITL
    emitToolCall(mock, 'doThing', 'call_1', {})
    expect(result.calls.value[0].status).toBe('pending')
    const capturedRespond = result.calls.value[0].respond!

    mock.emit('onRunErrorEvent', {})
    expect(result.calls.value[0].status).toBe('error')
    expect(result.calls.value[0].respond).toBeUndefined()

    // The captured closure is dead — a late approval submits nothing.
    await capturedRespond('late')
    expect(mock.addMessage).not.toHaveBeenCalled()
    unmount()
  })

  it('clear() empties the tracked calls (#5)', () => {
    const { mock, result, unmount } = setup({ ...baseOptions })
    emitToolCall(mock, 'doThing', 'call_1', {})
    emitToolCall(mock, 'doThing', 'call_2', {})
    expect(result.calls.value).toHaveLength(2)

    result.clear()
    expect(result.calls.value).toHaveLength(0)
    unmount()
  })
})

// ── Minimal Standard Schema stub (no Zod dependency in tests) ────────────────
// We build a hand-rolled schema that satisfies StandardSchemaV1 so we can test
// validation without importing Zod into the test suite.
function makeSchema<T>(
  validate: (v: unknown) => { value: T } | { issues: { message: string }[] },
) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate,
      // No-op jsonSchema so tests that don't care about the wire schema
      // don't trigger the console.warn fallback.
      jsonSchema: { input: () => ({}), output: () => ({}) },
    },
  }
}

describe('useFrontendTool — Standard Schema (runtime validation)', () => {
  it('passes validated args to the handler when schema passes', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const schema = makeSchema<{ city: string }>((v: any) =>
      typeof v?.city === 'string' ? { value: v } : { issues: [{ message: 'city must be string' }] },
    )
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: schema as any,
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 'Berlin' })
    await flush()

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toEqual({ city: 'Berlin' })
    expect(result.calls.value[0].status).toBe('complete')
    unmount()
  })

  it('submits a structured error and skips the handler when schema fails', async () => {
    const handler = vi.fn()
    const schema = makeSchema<{ city: string }>((v: any) =>
      typeof v?.city === 'string' ? { value: v } : { issues: [{ message: 'city must be string' }] },
    )
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: schema as any,
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 42 })
    await flush()

    expect(handler).not.toHaveBeenCalled()
    expect(result.calls.value[0].status).toBe('error')
    expect(result.calls.value[0].error?.message).toContain('city must be string')

    // A tool-result message must have been added (structured error for self-correction).
    expect(mock.addMessage).toHaveBeenCalledOnce()
    const msg = mock.addMessage.mock.calls[0][0] as any
    const parsed = JSON.parse(msg.content)
    expect(parsed.error).toBe('input-error')
    unmount()
  })

  it('extracts JSON Schema from a StandardJSONSchemaV1 schema for the wire', () => {
    const jsonSchema = { type: 'object', properties: { city: { type: 'string' } } }
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (v: unknown) => ({ value: v }),
        jsonSchema: {
          input: () => jsonSchema,
          output: () => jsonSchema,
        },
      },
    }
    const { result, unmount } = setup({
      ...baseOptions,
      parameters: schema as any,
    })

    expect(result.tool.parameters).toEqual(jsonSchema)
    unmount()
  })

  it('falls back to {} and warns when schema has no JSON Schema converter', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Build a schema without jsonSchema to trigger the fallback.
    const schema = {
      '~standard': { version: 1 as const, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
    }
    const { result, unmount } = setup({ ...baseOptions, parameters: schema as any })

    expect(result.tool.parameters).toEqual({})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('~standard.jsonSchema.input'))
    warnSpy.mockRestore()
    unmount()
  })
})

describe('useFrontendTool — handler signal (AbortController)', () => {
  it('passes a signal to the handler that starts as not aborted', async () => {
    let capturedSignal: AbortSignal | undefined
    const handler = vi.fn().mockImplementation((_args: any, ctx: any) => {
      capturedSignal = ctx.signal
      return 'done'
    })

    const { mock, unmount } = setup({ ...baseOptions, handler })
    await emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
    unmount()
  })

  it('passes toolCallId as the second argument', async () => {
    let capturedCtx: any
    const handler = vi.fn().mockImplementation((_args: any, ctx: any) => {
      capturedCtx = ctx
      return 'done'
    })

    const { mock, unmount } = setup({ ...baseOptions, handler })
    await emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()

    expect(capturedCtx.toolCallId).toBe('call_1')
    unmount()
  })

  it('aborts the signal when onTerminate fires while the handler is in-flight', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveHandler!: () => void
    const handler = vi.fn().mockImplementation((_args: any, ctx: any) => {
      capturedSignal = ctx.signal
      return new Promise<string>((res) => { resolveHandler = () => res('done') })
    })

    const { mock, unmount } = setup({ ...baseOptions, handler })
    emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()

    expect(capturedSignal!.aborted).toBe(false)

    // Simulate agent abort → onTerminate fires
    mock.emit('onRunErrorEvent', {})

    expect(capturedSignal!.aborted).toBe(true)

    resolveHandler() // let the handler settle so no unhandled rejection
    unmount()
  })

  it('does not resurrect a call terminated while schema validation was still pending', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const schema = makeSchema<{ city: string }>((v: any) =>
      typeof v?.city === 'string' ? { value: v } : { issues: [{ message: 'bad' }] },
    )
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: schema as any,
      handler,
    })

    // Kick off the call — onEnd starts, awaits schema validation, and yields
    // to the microtask queue before this line returns.
    emitToolCall(mock, 'doThing', 'call_1', { city: 'Berlin' })

    // Abandon the turn (e.g. agent.abort()/reset()) before that await resolves.
    mock.emit('onRunErrorEvent', {})
    expect(result.calls.value[0].status).toBe('error')

    // Let the pending validation microtask resume.
    await flush()

    // The handler must never run for an already-abandoned call, and the
    // terminated status must not be overwritten back to executing/complete.
    expect(handler).not.toHaveBeenCalled()
    expect(result.calls.value[0].status).toBe('error')
    unmount()
  })

  it('does not resurrect a non-schema call terminated while the handler was in-flight', async () => {
    let resolveHandler!: () => void
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>((res) => { resolveHandler = () => res('done') }),
    )
    const { mock, result, unmount } = setup({ ...baseOptions, handler })

    emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()

    // Abandon the turn while the handler is still awaiting.
    mock.emit('onRunErrorEvent', {})
    expect(result.calls.value[0].status).toBe('error')

    // A handler that ignores `signal` resolves after termination — the
    // terminated status must not be overwritten back to 'complete'.
    resolveHandler()
    await flush()

    expect(result.calls.value[0].status).toBe('error')
    unmount()
  })
})

describe('useFrontendTool — followUp option', () => {
  it('registers with followUp:true by default (continueRun fires)', async () => {
    const { mock, continueRun, unmount } = setup({
      ...baseOptions,
      handler: vi.fn().mockResolvedValue('ok'),
    })
    await emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()
    mock.emit('onRunFinishedEvent', {})
    expect(continueRun).toHaveBeenCalledOnce()
    unmount()
  })

  it('does NOT call continueRun when followUp: false', async () => {
    const { mock, continueRun, unmount } = setup({
      ...baseOptions,
      followUp: false,
      handler: vi.fn().mockResolvedValue('ok'),
    })
    await emitToolCall(mock, 'doThing', 'call_1', {})
    await flush()
    mock.emit('onRunFinishedEvent', {})
    expect(continueRun).not.toHaveBeenCalled()
    unmount()
  })

  it('forces continueRun even with followUp:false when validation fails', async () => {
    const schema = makeSchema<{ city: string }>((v: any) =>
      typeof v?.city === 'string' ? { value: v } : { issues: [{ message: 'bad' }] },
    )
    const { mock, continueRun, unmount } = setup({
      ...baseOptions,
      parameters: schema as any,
      followUp: false,
      handler: vi.fn(),
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 99 }) // invalid
    await flush()
    mock.emit('onRunFinishedEvent', {})

    // Validation error always triggers follow-up so the model can self-correct.
    expect(continueRun).toHaveBeenCalledOnce()
    unmount()
  })
})


describe('useFrontendTool — ArkType schema (schema-agnostic Standard Schema support)', () => {
  it('validates args and calls handler when ArkType schema passes', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: type({ city: 'string' }),
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 'Berlin' })
    await flush()

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toEqual({ city: 'Berlin' })
    expect(result.calls.value[0].status).toBe('complete')
    unmount()
  })

  it('submits a structured error and skips the handler when ArkType schema fails', async () => {
    const handler = vi.fn()
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: type({ city: 'string' }),
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 42 })
    await flush()

    expect(handler).not.toHaveBeenCalled()
    expect(result.calls.value[0].status).toBe('error')
    const msg = mock.addMessage.mock.calls[0][0] as any
    expect(JSON.parse(msg.content).error).toBe('input-error')
    unmount()
  })

  it('extracts a real wire JSON Schema since ArkType implements StandardJSONSchemaV1', () => {
    const { result, unmount } = setup({
      ...baseOptions,
      parameters: type({ city: 'string' }),
    })

    // ArkType implements ~standard.jsonSchema, so extractJSONSchema() derives a
    // real schema instead of falling back to {}.
    expect(result.tool.parameters).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    })
    unmount()
  })
})

describe('useFrontendTool — Zod schema (schema-agnostic Standard Schema support)', () => {
  it('validates args and calls handler when Zod schema passes', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: z.object({ city: z.string() }),
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 'Berlin' })
    await flush()

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toEqual({ city: 'Berlin' })
    expect(result.calls.value[0].status).toBe('complete')
    unmount()
  })

  it('submits a structured error and skips the handler when Zod schema fails', async () => {
    const handler = vi.fn()
    const { mock, result, unmount } = setup({
      ...baseOptions,
      parameters: z.object({ city: z.string() }),
      handler,
    })

    await emitToolCall(mock, 'doThing', 'call_1', { city: 42 })
    await flush()

    expect(handler).not.toHaveBeenCalled()
    expect(result.calls.value[0].status).toBe('error')
    const msg = mock.addMessage.mock.calls[0][0] as any
    expect(JSON.parse(msg.content).error).toBe('input-error')
    unmount()
  })

  it('extracts a real wire JSON Schema since Zod implements StandardJSONSchemaV1', () => {
    const { result, unmount } = setup({
      ...baseOptions,
      parameters: z.object({ city: z.string() }),
    })

    // Zod 4+'s ~standard.jsonSchema converter is implemented, so
    // extractJSONSchema() derives a real schema instead of falling back to {}.
    expect(result.tool.parameters).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    })
    unmount()
  })
})
