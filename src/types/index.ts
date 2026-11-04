/**
 * Re-export core AG-UI types that consumers will need.
 * This avoids forcing users to install @ag-ui/core directly for basic usage.
 */
export type {
  Message,
  ToolCall,
  RunAgentInput,
  BaseEvent,
  Tool,
  Context,
  State,
  // Event types for advanced subscribers
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  // Reasoning & activity messages (new in AG-UI 1.0)
  ReasoningMessage,
  ActivityMessage,
  // Multimodal content parts
  ContentPart,
  TextPart,
  ImagePart,
  AudioPart,
  VideoPart,
  DocumentPart,
  PartSource,
  DataSource,
  UrlSource,
  // `PartSource`'s third arm (new in AG-UI 1.0): a handle the model provider
  // issued for bytes already uploaded to it. Its `value` is NOT a URL — code
  // switching exhaustively on `source.type` needs a case for it.
  FileSource,
  // Run outcomes & interrupts (new in AG-UI 1.0)
  Interrupt,
  ResumeEntry,
  RunFinishedOutcome,
  Metadata,
  TokenUsage,
} from '@ag-ui/core'

/**
 * Pre-1.0 names for the multimodal content parts. AG-UI 1.0 renamed these to
 * describe what they are rather than which direction they travel; upstream
 * keeps them as aliases of the same types, and so do we.
 *
 * @deprecated Use `ContentPart` / `TextPart` / `ImagePart` / `AudioPart` /
 * `VideoPart` / `DocumentPart` / `PartSource` / `DataSource` / `UrlSource`.
 */
export type {
  InputContent,
  TextInputContent,
  ImageInputContent,
  AudioInputContent,
  VideoInputContent,
  DocumentInputContent,
  InputContentSource,
  InputContentDataSource,
  InputContentUrlSource,
} from '@ag-ui/core'

// Import types for internal use
import type { Tool, Message, Interrupt, ResumeEntry } from '@ag-ui/core'
import type { AgentSubscriber } from '@ag-ui/client'
import type { MaybeRefOrGetter } from 'vue'

export type { HttpAgentConfig, AgentSubscriber, RunAgentResult } from '@ag-ui/client'

/**
 * Per-run overrides accepted by `send` / `continueRun` (on `useAgent`,
 * `useThread`, and `useThreads`). All optional: `tools` / `context` /
 * `forwardedProps` are merged into `RunAgentInput` for that run, and
 * `subscriber` attaches an extra `AgentSubscriber` for its duration.
 *
 * **These apply to one request, not one exchange.** A frontend-tool round-trip
 * is a second, separate run, and the tool coordinator issues it with the
 * registered tools alone — so `context`, `forwardedProps` and `subscriber`
 * passed to a `send()` do *not* carry to the continuation it triggers. That is
 * deliberate: a continuation is a new AG-UI run, and re-sending a one-shot
 * parameter (a LangGraph `command`, say) on it would be wrong more often than
 * right. Anything that must hold for every hop belongs at composable level,
 * where it is re-resolved per request — see {@link UseAgentOptions.context}
 * and {@link UseAgentOptions.forwardedProps}.
 */
export interface RunOptions {
  tools?: any[]
  /**
   * Context entries for this request only, appended after the composable-level
   * {@link UseAgentOptions.context}. Not repeated on a tool continuation.
   */
  context?: readonly ContextEntry[]
  /**
   * Backend-specific run parameters, passed through verbatim as
   * `RunAgentInput.forwardedProps`. This is AG-UI's protocol escape hatch —
   * what each backend understands here is up to that backend (LangGraph reads
   * `command` / `config`, other integrations read model or agent selectors).
   *
   * Shallow-merged over {@link UseAgentOptions.forwardedProps}, so a per-run
   * key overrides the composable-level default of the same name — for that
   * request only. If a frontend tool turns the exchange into a round-trip, the
   * continuation run reverts to the composable-level value; put anything that
   * must survive a tool hop there instead.
   */
  forwardedProps?: Record<string, any>
  /**
   * Answers to the interrupts the previous run ended on, sent as
   * `RunAgentInput.resume`. While interrupts are open a run *must* carry one
   * answering every one of them, or it is refused with an `InterruptError`
   * before any request. Normally built for you by `useInterrupts().resumeAll()`;
   * pass it directly only to resume without that composable.
   */
  resume?: ResumeEntry[]
  subscriber?: AgentSubscriber
}

/**
 * One entry of `RunAgentInput.context`: read-only background the agent gets
 * for a run ("the caseworker has application BA-2026-0142 open").
 *
 * The protocol's `Context.value` is a string. A ref or getter `value` is
 * unwrapped (so `storeToRefs()` output can be passed as is); then a string is
 * sent as is and anything else is JSON-serialised, so a store object can be
 * passed directly. An entry whose `value` is `undefined` is dropped, so a
 * getter can emit an entry for "the current selection" unconditionally.
 */
export interface ContextEntry {
  /** What this entry is, for the agent to interpret. */
  description: string
  value: unknown
}

/**
 * A JSON Schema document, carried opaquely — e.g. `Interrupt.responseSchema`.
 * AG-UI does not constrain its dialect, so neither do we.
 */
export type JsonSchema = Record<string, any>

/**
 * Validates an interrupt response against the interrupt's `responseSchema`
 * before it is staged (AG-UI interrupt rule 6). Return the problems found —
 * empty or nothing when the payload conforms. May be async.
 *
 * @example
 * ```ts
 * import { Validator } from '@cfworker/json-schema'
 * const validateResumePayload: ValidateResumePayload = (schema, payload) =>
 *   new Validator(schema).validate(payload).errors.map((e) => e.error)
 * ```
 */
export type ValidateResumePayload = (
  schema: JsonSchema,
  payload: unknown,
  interrupt: Interrupt,
) => string[] | void | Promise<string[] | void>

/**
 * What a human is asked to decide — the shape shared by a pending HITL
 * frontend-tool call (`useFrontendTool`) and an interrupt (`useInterrupts`), so
 * one approvals view can list both. Narrow on `kind` for the specifics.
 *
 * The two are resolved differently: a frontend tool call is *executed* by the
 * client (its result goes back as a tool message), an interrupt is *authorized*
 * by the client and executed by the server (its answer goes back on the next
 * run's `resume`).
 */
export interface PendingDecision {
  kind: 'frontend-tool' | 'interrupt'
  /** Tool call id or interrupt id; stable `v-for` key. */
  id: string
  status: string
  /** Human-readable prompt, when the producer supplied one. */
  message?: string
  /** Shape of the expected answer, when the producer supplied one. */
  responseSchema?: JsonSchema
}

/**
 * Configuration for the useAgent composable.
 *
 * `url`, `headers`, and `threadId` accept a `MaybeRefOrGetter` and are resolved
 * via `toValue()` before each request, so reactive values (e.g. a refreshing
 * auth token) are always sent fresh. Static values remain valid.
 */
export interface UseAgentOptions {
  /** URL of the AG-UI agent endpoint. Resolved before every request. */
  url: MaybeRefOrGetter<string>

  /**
   * Optional HTTP headers (e.g. for auth). Resolved before every request, so a
   * getter like `() => ({ Authorization: `Bearer ${token.value}` })` always
   * sends the current token.
   */
  headers?: MaybeRefOrGetter<Record<string, string> | undefined>

  /**
   * Optional thread ID. If not provided, one is generated automatically.
   * Changing a reactive `threadId` resets and reconnects the conversation.
   */
  threadId?: MaybeRefOrGetter<string | undefined>

  /**
   * Messages to pre-load into the agent before any run.
   * Used by useThread to hydrate a conversation from persisted storage.
   */
  initialMessages?: Message[]

  /**
   * Backend-specific run parameters applied to **every** run, passed through as
   * `RunAgentInput.forwardedProps`. Resolved before each request, so a getter
   * always sends current values. A per-run `RunOptions.forwardedProps` is
   * shallow-merged on top.
   *
   * @example
   * ```ts
   * useAgent({ url: '/api/agent', forwardedProps: () => ({ model: model.value }) })
   * ```
   */
  forwardedProps?: MaybeRefOrGetter<Record<string, any> | undefined>

  /**
   * Context entries applied to **every** run, sent as `RunAgentInput.context`:
   * ambient, read-only background such as the page or item the user has open.
   * Resolved before each request, including tool continuations, interrupt
   * resumes and `onError` retries, so a getter over a store always sends what
   * the UI shows *now*. A per-run `RunOptions.context` is appended after it.
   *
   * Unlike `state`, context is one-way and never persisted with a thread. See
   * {@link ContextEntry} for how values are serialised.
   *
   * @example
   * ```ts
   * useAgent({ url: '/api/agent', context: () => pageContext.entries })
   * ```
   */
  context?: MaybeRefOrGetter<readonly ContextEntry[] | undefined>

  /**
   * Mint the `run_id` for each run. Defaults to a UUID.
   *
   * `useAgent` owns the run id rather than letting `@ag-ui/client` generate one
   * internally, so the value is knowable client-side *before* the first token
   * streams and stays stable across an `onError` retry. Override this to align
   * run ids with your own tracing/telemetry scheme.
   *
   * Must return a fresh id per call — it is called once per run, and a repeated
   * value would merge two runs in anything keyed on it: provenance, and the
   * abandoned-run bookkeeping that keeps a stale RUN_ERROR from a killed run
   * from leaking onto later state (reusing an id could suppress a later run's
   * real error instead).
   *
   * Note a run id identifies one *logical* run, not one HTTP request: an
   * `onError` retry deliberately re-sends the same id, so the server can see two
   * requests bearing it. Don't treat it as a unique key for a server-side
   * request record. See {@link UseAgentOptions.onError}.
   *
   * @example
   * useAgent({ url: '/api/agent', runIdFactory: () => `run_${traceId()}` })
   */
  runIdFactory?: () => string

  /**
   * Called when a request fails — including requests `useAgent` issues
   * internally (tool-result continuations via `continueRun`). Fires once per
   * failed request, before `error` is set.
   *
   * Return `{ retry: true }` to re-run the request a single time. The retry
   * re-resolves `url`/`headers` via `toValue()`, so a token refreshed inside
   * the handler is sent on the retry. `context` and `forwardedProps` are
   * re-resolved too, so the retry carries what the UI shows at retry time,
   * not what the first attempt sent. To guard against infinite loops, a
   * request is retried at most once: a second failure surfaces as `error`
   * regardless of what the handler returns.
   *
   * Not called for user-initiated aborts (`abort()` / `AbortError`).
   *
   * The retry re-sends the **same `run_id`** — a refresh-and-retry is one
   * logical run, not two. That is clean for the case this hook is built for (a
   * 401, where the request never reached the model), but `onError` fires for
   * *every* failure: retrying after a partially-streamed response re-sends that
   * run id alongside the partial assistant message already in the transcript. If
   * your backend keys run state on `run_id` (a LangGraph checkpointer, say),
   * retry only the failures you know left no server-side run behind.
   *
   * @example
   * ```ts
   * useAgent({
   *   url: '/api/chat',
   *   headers: () => ({ Authorization: `Bearer ${token.value}` }),
   *   onError: async (err) => {
   *     if (err.status === 401) {
   *       await refreshSession() // updates the token ref
   *       return { retry: true } // re-run with the refreshed token
   *     }
   *   },
   * })
   * ```
   */
  onError?: OnErrorHandler

  /**
   * Validate an interrupt response against its `responseSchema` before it is
   * staged. No validator ships with the library — plug in the JSON Schema
   * validator you already use. Without one, payloads are sent unchecked and the
   * server is the authority on their shape (PydanticAI, for one, denies any
   * approval payload that fails its own validation).
   */
  validateResumePayload?: ValidateResumePayload
}

/**
 * Error passed to {@link UseAgentOptions.onError}. It is a standard `Error`,
 * augmented by `@ag-ui/client` with the HTTP `status` and parsed response
 * `payload` when the failure was a non-OK HTTP response (e.g. a `401`).
 */
export interface AgentRequestError extends Error {
  /** HTTP status code, present when the failure was a non-OK HTTP response. */
  status?: number
  /** Parsed response body (JSON object or string) when available. */
  payload?: unknown
}

/**
 * Value an {@link OnErrorHandler} may return to control retry behavior.
 */
export interface OnErrorResult {
  /** Re-run the failed request once with freshly resolved `url`/`headers`. */
  retry?: boolean
}

/**
 * Handler invoked when a request fails. May refresh credentials (e.g. an auth
 * token) and signal a retry by returning `{ retry: true }`.
 */
export type OnErrorHandler = (
  error: AgentRequestError,
) => void | OnErrorResult | Promise<void | OnErrorResult>

/**
 * Context passed as the second argument to a frontend tool handler.
 */
export interface ToolHandlerContext {
  /** The tool call ID for this invocation. */
  toolCallId: string
  /**
   * AbortSignal that fires when the agent is aborted or reset.
   * Wire this to any cancellable async work (fetch, streaming, timers) so the
   * handler stops cleanly when the user hits Stop.
   *
   * @example
   * ```ts
   * handler: async ({ city }, { signal }) => {
   *   const res = await fetch(`/weather/${city}`, { signal })
   *   return res.json()
   * }
   * ```
   */
  signal: AbortSignal
}

/**
 * Handler function for executing frontend tools locally.
 * Receives parsed arguments and an optional context with toolCallId and AbortSignal.
 *
 * Backward compatible: existing handlers that only accept `args` continue to work.
 */
export type ToolHandler<TArgs = any, TResult = any> = (
  args: TArgs,
  ctx: ToolHandlerContext,
) => TResult | Promise<TResult>

/**
 * Pending tool call awaiting manual resolution (human-in-the-loop).
 */
export interface PendingToolCall {
  /** Tool call ID from the event */
  id: string
  /** Tool name */
  name: string
  /** Parsed arguments */
  args: any
  /** Timestamp when the tool call was received */
  timestamp: number
}

/**
 * Tool definition with enabled state.
 * @deprecated Legacy type - use Tool from @ag-ui/core instead
 */
export interface ToolDefinition {
  /** The AG-UI tool definition (name, description, parameters) */
  tool: Tool
  /** Whether this tool is currently enabled */
  enabled: boolean
}
