import {
  ref,
  computed,
  isRef,
  markRaw,
  readonly,
  onScopeDispose,
  type Ref,
  type DeepReadonly,
  type MaybeRefOrGetter,
} from 'vue'
import type { Tool } from '@ag-ui/core'
import type { UseAgentReturn } from './useAgent'
import { getToolRegistry, createToolRegistry } from './toolRegistry'
import type { ToolHandler, ToolHandlerContext, PendingToolCall, PendingDecision } from '../types'
import {
  type StandardSchemaV1,
  type SchemaOutput,
  isStandardSchema,
  extractJSONSchema,
} from '../types/standard-schema'

/**
 * Lifecycle status of a single frontend tool call. Mirrors the AI SDK shape:
 * `streaming-args` → `executing` (automatic) / `pending` (HITL) → `complete`/`error`.
 */
export type FrontendToolCallStatus =
  | 'streaming-args'
  | 'executing'
  | 'pending'
  | 'complete'
  | 'error'

/**
 * A single invocation of a frontend tool. Multiple parallel calls of the same
 * tool are tracked independently, each with its own status and (for HITL) its
 * own `respond`/`reject`.
 *
 * Shares the {@link PendingDecision} shape with `useInterrupts`'s entries, so
 * one approvals view can list pending HITL calls and interrupts together.
 */
export interface FrontendToolCall<TArgs = any, TResult = any> extends PendingDecision {
  kind: 'frontend-tool'
  /** Tool call ID from the AG-UI event (stable key for v-for). */
  id: string
  /** Current lifecycle status. */
  status: FrontendToolCallStatus
  /** Parsed arguments, populated incrementally while args stream in. */
  args: Partial<TArgs>
  /** Handler/HITL result, once the call completes. */
  result?: TResult
  /** Error, if the call failed or was rejected. */
  error?: Error
  /** Resolve this call with a result (present only while `status === 'pending'`). */
  respond?: (result: any) => Promise<void>
  /** Reject this call (present only while `status === 'pending'`). */
  reject?: (reason?: string) => Promise<void>
}

/**
 * Options for configuring a frontend tool.
 *
 * `TSchema` is the type of `parameters` — either a Standard Schema (Zod,
 * Valibot, ArkType) for type inference + runtime validation, or a plain JSON
 * Schema object (backward compatible, no inference or validation).
 */
export interface UseFrontendToolOptions<TSchema extends object = object, TResult = any> {
  /** Tool name (must be unique within the agent's tool set) */
  name: string

  /** Human-readable description of what the tool does */
  description: string

  /**
   * The tool's parameter schema. Accepts either:
   * - A **Standard Schema** (Zod, Valibot, ArkType): handler args are inferred
   *   from the schema type and validated at runtime before the handler is called.
   * - A **plain JSON Schema object**: used as-is on the wire; no type inference
   *   or runtime validation (backward compatible with v1 behaviour).
   *
   * @example
   * ```ts
   * // Zod — full type inference + validation
   * parameters: z.object({ city: z.string() })
   *
   * // Raw JSON Schema — backward compatible, no validation
   * parameters: { type: 'object', properties: { city: { type: 'string' } } }
   * ```
   */
  parameters: TSchema

  /**
   * Optional handler function for automatic execution.
   * If provided, the tool executes automatically when called.
   * If omitted, the tool requires manual resolution (human-in-the-loop).
   *
   * The second argument `ctx` provides `{ toolCallId, signal }`:
   * - `toolCallId` — the AG-UI call ID for this invocation.
   * - `signal` — an `AbortSignal` that fires when the agent is aborted or reset.
   *   Wire it to any cancellable async work (fetch, streaming, timers).
   */
  handler?: ToolHandler<SchemaOutput<TSchema>, TResult>

  /**
   * Whether to trigger a follow-up LLM turn after this tool resolves.
   * Default: `true`.
   *
   * Set to `false` for pure UI side-effect tools (e.g. `setDarkMode`) that
   * don't need the model to respond after execution. When every tool resolved
   * in a turn is `followUp: false`, no `continueRun` is issued — saving an
   * unnecessary LLM round-trip.
   *
   * A validation-error result always forces the follow-up regardless of this
   * setting, so the model can self-correct.
   */
  followUp?: boolean

  /**
   * Whether this tool is enabled. Accepts a ref/getter so it can be toggled
   * reactively without re-creating the tool. A disabled tool is removed from
   * what is advertised to the LLM (it never enters `RunAgentInput.tools`) and
   * incoming calls for it are ignored.
   * @default true
   */
  enabled?: MaybeRefOrGetter<boolean>
}

/**
 * Return type for useFrontendTool composable.
 */
export interface UseFrontendToolReturn<TArgs = any, TResult = any> {
  /** The tool definition (plain schema from @ag-ui/core). Auto-registered with the agent. */
  tool: Tool

  /** Whether this tool has a handler (automatic) or requires manual resolution (HITL) */
  isAutomatic: boolean

  /**
   * All calls of this tool, in arrival order. The source of truth for rendering
   * live tool cards — each entry carries its own status, streamed args, and
   * (while pending) its own `respond`/`reject`.
   */
  calls: DeepReadonly<Ref<FrontendToolCall<TArgs, TResult>[]>>

  /** Whether any call is currently executing its handler (derived convenience). */
  isExecuting: Readonly<Ref<boolean>>

  /** The most recent successful result (derived convenience). */
  lastResult: Readonly<Ref<any>>

  /** The most recent error (derived convenience). */
  lastError: Readonly<Ref<Error | null>>

  /** The oldest pending HITL call, or null (derived convenience). */
  pending: Readonly<Ref<PendingToolCall | null>>

  /** Resolve the oldest pending HITL call (derived convenience for single-call UIs). */
  resolve: (result: any) => Promise<void>

  /** Reject the oldest pending HITL call (derived convenience for single-call UIs). */
  reject: (reason?: string) => Promise<void>

  /** Whether this tool is currently enabled (writable). */
  enabled: Ref<boolean>

  /**
   * Clear the tracked `calls`. `calls` only grows otherwise (one entry per
   * invocation, kept for history); call this to drop completed cards in a
   * long-lived component. There is no `autoClear` — retention is consumer-managed.
   */
  clear: () => void

  /**
   * Manually unregister the tool and tear down its coordination.
   * In component setup this happens automatically on scope dispose.
   */
  dispose: () => void
}

/**
 * Per-tool composable for defining and executing frontend tools.
 *
 * Supports two execution modes:
 * 1. **Automatic** (with handler): the tool executes immediately when called.
 * 2. **Human-in-the-loop** (without handler): each call waits for manual
 *    resolution via its own `respond`/`reject`.
 *
 * Declaring a tool is sufficient — it auto-registers with the agent on setup and
 * unregisters on scope dispose, so there is no manual `tools` passing on `send`.
 * The agent's shared coordinator batches every frontend tool result from a turn
 * and issues a single follow-up run, so two tools called in one turn produce
 * exactly one `continueRun`.
 *
 * @param agentContext - The return value from useAgent()
 * @param options - Tool configuration
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue'
 * import { z } from 'zod'
 * import { useAgent, useFrontendTool } from 'ag-ui-vue'
 *
 * const isDarkMode = ref(false)
 * const agentCtx = useAgent({ url: '/api/agent' })
 *
 * // Automatic tool with Zod schema — args fully typed, validated at runtime.
 * useFrontendTool(agentCtx, {
 *   name: 'setDarkMode',
 *   description: 'Toggle dark/light mode',
 *   parameters: z.object({ enabled: z.boolean() }),
 *   followUp: false,  // pure side-effect — no need for an LLM follow-up turn
 *   handler: async ({ enabled }, { signal }) => {
 *     isDarkMode.value = enabled
 *     return { success: true }
 *   },
 * })
 *
 * // HITL tool — each call waits for the user.
 * const confirm = useFrontendTool(agentCtx, {
 *   name: 'confirmAction',
 *   description: 'Ask the user to confirm an action',
 *   parameters: z.object({ action: z.string() }),
 * })
 *
 * // No `tools` needed — registered tools are merged automatically.
 * function handleSend(msg: string) {
 *   agentCtx.send(msg)
 * }
 * </script>
 *
 * <template>
 *   <div v-for="call in confirm.calls.value" :key="call.id">
 *     <template v-if="call.status === 'pending'">
 *       <p>⚠️ Agent wants to: {{ call.args.action }}</p>
 *       <button @click="call.respond!('approved')">✅ Approve</button>
 *       <button @click="call.reject!('User declined')">❌ Reject</button>
 *     </template>
 *   </div>
 * </template>
 * ```
 *
 * @see https://docs.ag-ui.com/concepts/tools - AG-UI Tools Documentation
 */
export function useFrontendTool<TSchema extends object = object, TResult = any>(
  agentContext: UseAgentReturn,
  options: UseFrontendToolOptions<TSchema, TResult>,
): UseFrontendToolReturn<SchemaOutput<TSchema>, TResult> {
  const { name, description, parameters, handler, followUp, enabled: enabledOption } = options

  const agent = agentContext.agent

  // --- Schema detection ---
  // If `parameters` is a Standard Schema, extract the JSON Schema for the wire
  // and keep a reference for runtime validation in onEnd.
  // Otherwise treat it as a plain JSON Schema object (backward compatible).
  const rawSchema: StandardSchemaV1 | null = isStandardSchema(parameters)
    ? (parameters as unknown as StandardSchemaV1)
    : null

  const wireParameters: object = rawSchema ? extractJSONSchema(rawSchema) : parameters

  // --- Tool definition ---
  // markRaw so the tool stays a plain object even when collected into a reactive
  // container, so it crosses into @ag-ui/client's structuredClone cleanly.
  const tool: Tool = markRaw({ name, description, parameters: wireParameters })

  // --- enabled (writable, synchronous) ---
  // A passed ref flows through unchanged. Otherwise a writable computed: it reads
  // the static value / getter synchronously (needed because tool calls dispatch
  // synchronously), and a manual write takes effect via the override layer — so
  // the returned ref is honestly writable in every case, never a silent no-op.
  const override = ref<boolean | undefined>(undefined)
  const enabled: Ref<boolean> = isRef(enabledOption)
    ? enabledOption
    : computed({
        get: () =>
          (override.value ??
            (typeof enabledOption === 'function' ? !!enabledOption() : enabledOption)) ??
          true,
        set: (v) => {
          override.value = v
        },
      })

  // Mark handler raw so Vue never proxies the function.
  const rawHandler = handler ? markRaw(handler) : null
  const isAutomatic = !!handler

  // --- Per-call state ---
  // Typed loosely internally (a generic ref hits Vue's UnwrapRef on Partial<TArgs>);
  // the public `calls` is cast back to the generic shape at the return boundary.
  const calls = ref<FrontendToolCall[]>([])
  const lastResult = ref<any>(null)
  const lastError = ref<Error | null>(null)
  // Arrival timestamps, kept out of the public call shape.
  const startedAt = new Map<string, number>()
  // Per-call AbortControllers for handler cancellation via onTerminate.
  const callControllers = new Map<string, AbortController>()
  // Ids abandoned via onTerminate while onEnd was still awaiting (e.g. schema
  // validation) — checked after the await so a terminated call isn't resurrected.
  const terminatedIds = new Set<string>()

  function findCall(id: string): FrontendToolCall | undefined {
    return calls.value.find((c) => c.id === id)
  }

  function toContent(result: any): string {
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  // --- Register with the shared coordinator ---
  // Reuse the agent's coordinator if present (the normal case); otherwise create
  // one bound to this context's continueRun (covers bare/mocked contexts).
  const registry =
    getToolRegistry(agent) ??
    createToolRegistry(agent, { continueRun: agentContext.continueRun })

  const unregister = registry.register({
    tool,
    isEnabled: () => enabled.value,
    followUp: followUp ?? true,

    onStart(id) {
      startedAt.set(id, Date.now())
      calls.value.push({ kind: 'frontend-tool', id, status: 'streaming-args', args: {} })
    },

    onArgs(id, raw) {
      const call = findCall(id)
      if (!call) return
      try {
        call.args = JSON.parse(raw)
      } catch {
        // Not valid JSON yet — keep the last good parse.
      }
    },

    async onEnd(id, parsedArgs) {
      const call = findCall(id)
      if (!call) return
      call.args = (parsedArgs ?? {})

      // --- Runtime validation (Standard Schema only) ---
      if (rawSchema) {
        const result = await rawSchema['~standard'].validate(parsedArgs)
        // The call may have been abandoned (reset/abort/RUN_ERROR) while this
        // validation was pending — onTerminate already finalized it, so don't
        // resurrect it by proceeding to the handler.
        if (terminatedIds.delete(id)) return
        if (result.issues) {
          // Validation failed — submit a structured error so the model can
          // self-correct. Never invoke the handler. Force the follow-up turn
          // regardless of the tool's followUp setting.
          // Spread into a plain array first: some libraries (e.g. ArkType) return
          // an Array *subclass* for `issues` whose own custom toJSON assumes its
          // elements are still that library's error objects. Mapping directly
          // would preserve the subclass (via Symbol.species) and carry that
          // broken toJSON into our plain {message, path} shape, breaking
          // JSON.stringify below.
          const issues = [...result.issues]
          const errorMsg = issues.map((i) => i.message).join('; ')
          const errorContent = JSON.stringify({
            error: 'input-error',
            message: errorMsg,
            issues: issues.map((i) => ({ message: i.message, path: i.path })),
          })
          call.status = 'error'
          call.error = new Error(errorMsg)
          lastError.value = call.error
          registry.submitResult(id, errorContent, errorMsg, { forceFollowUp: true })
          return
        }
        // Use the validated (and potentially coerced/transformed) output.
        parsedArgs = result.value
        call.args = parsedArgs
      }

      if (rawHandler) {
        // --- Automatic execution ---
        // Create a per-call AbortController so onTerminate can cancel an
        // in-flight handler when the agent is aborted or reset.
        const controller = new AbortController()
        callControllers.set(id, controller)
        const ctx: ToolHandlerContext = { toolCallId: id, signal: controller.signal }

        call.status = 'executing'
        try {
          const result = await rawHandler(parsedArgs, ctx)
          if (controller.signal.aborted) return
          call.result = result
          call.status = 'complete'
          lastResult.value = result
          registry.submitResult(id, toContent(result))
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e))
          call.error = err
          call.status = 'error'
          lastError.value = err
          registry.submitResult(id, JSON.stringify({ error: err.message }), err.message, { forceFollowUp: true })
        } finally {
          callControllers.delete(id)
        }
        return
      }

      // --- Human-in-the-loop: this call carries its own resolution ---
      call.status = 'pending'
      call.respond = async (result: any) => {
        if (call.status !== 'pending') return
        call.result = result
        call.status = 'complete'
        call.respond = undefined
        call.reject = undefined
        lastResult.value = result
        registry.submitResult(id, toContent(result))
      }
      call.reject = async (reason: string = 'User rejected') => {
        if (call.status !== 'pending') return
        const err = new Error(reason)
        call.error = err
        call.status = 'error'
        call.respond = undefined
        call.reject = undefined
        lastError.value = err
        registry.submitResult(id, JSON.stringify({ error: reason }), reason)
      }
    },

    // The coordinator is abandoning this call (run error, reset/abort, or a
    // result arrived elsewhere). Finalize it so the card stops spinning and the
    // pending respond/reject closures go dead. Also abort any in-flight handler.
    onTerminate(id) {
      // Abort the handler's signal if it's still running.
      callControllers.get(id)?.abort()
      callControllers.delete(id)
      // Mark abandoned in case onEnd is still awaiting schema validation for
      // this id — it checks this set right after the await to avoid resurrecting.
      if (rawSchema) terminatedIds.add(id)

      const call = findCall(id)
      if (!call || call.status === 'complete' || call.status === 'error') return
      call.status = 'error'
      call.error = new Error('Tool call terminated')
      call.respond = undefined
      call.reject = undefined
    },
  })

  onScopeDispose(() => {
    unregister()
  })

  // --- Derived conveniences (backward compatible) ---
  const isExecuting = computed(() => calls.value.some((c) => c.status === 'executing'))

  const pending = computed<PendingToolCall | null>(() => {
    const c = calls.value.find((call) => call.status === 'pending')
    if (!c) return null
    return { id: c.id, name, args: c.args, timestamp: startedAt.get(c.id) ?? 0 }
  })

  async function resolve(result: any): Promise<void> {
    const c = calls.value.find((call) => call.status === 'pending')
    await c?.respond?.(result)
  }

  async function reject(reason?: string): Promise<void> {
    const c = calls.value.find((call) => call.status === 'pending')
    await c?.reject?.(reason)
  }

  function clear() {
    calls.value = []
    startedAt.clear()
    callControllers.clear()
    terminatedIds.clear()
  }

  function dispose() {
    unregister()
  }

  type TArgs = SchemaOutput<TSchema>

  return {
    tool,
    isAutomatic,
    calls: readonly(calls) as DeepReadonly<Ref<FrontendToolCall<TArgs, TResult>[]>>,
    isExecuting,
    lastResult: readonly(lastResult),
    lastError: readonly(lastError),
    pending,
    resolve,
    reject,
    enabled,
    clear,
    dispose,
  }
}
