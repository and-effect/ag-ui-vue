import {
  ref,
  shallowRef,
  readonly,
  shallowReadonly,
  onScopeDispose,
  toValue,
  watch,
  type DeepReadonly,
  type Ref,
} from 'vue'
import { HttpAgent, getRunOutcome, randomUUID } from '@ag-ui/client'
import type { Message, ContentPart, Interrupt, Context, RunFinishedOutcome, TokenUsage } from '@ag-ui/core'
import type { AgentSubscriber, RunAgentResult } from '@ag-ui/client'
import type { UseAgentOptions, AgentRequestError, RunOptions, ContextEntry } from '../types'
import { createToolRegistry } from './toolRegistry'
import { createInterruptRegistry, InterruptError } from './interruptRegistry'
import type { InterruptErrorCode } from './interruptRegistry'
import { stripState } from './useAgentState'

/**
 * Machine-readable code for `UseAgentReturn.error`. Our own values autocomplete;
 * any other string is a backend's `RUN_ERROR` code. Both share one namespace, so
 * a backend that sends `'abort'` reads the same as the client's own abort.
 */
export type AgentErrorCode = InterruptErrorCode | 'abort' | (string & {})

/**
 * How a run ended: the server-reported `RUN_FINISHED` outcome, a failure
 * (`code` is the same value as `UseAgentReturn.errorCode`), or `aborted` when
 * `useAgent`'s `abort()` stopped it.
 */
export type RunOutcome =
  | RunFinishedOutcome
  | { type: 'error'; code: AgentErrorCode | null }
  | { type: 'aborted' }

/**
 * Return type for useAgent composable.
 */
export interface UseAgentReturn {
  /** Reactive array of all messages in the conversation. */
  messages: DeepReadonly<Ref<Message[]>>
  /** Whether the agent is currently processing a request. */
  isRunning: Readonly<Ref<boolean>>
  /** The latest error message, or null. */
  error: Readonly<Ref<string | null>>
  /**
   * Machine-readable code for the latest error, when its source provided one —
   * the `code` of a `RUN_ERROR` event (e.g. a backend's rate-limit code),
   * `'abort'` for a run aborted mid-stream outside `abort()` (an abort before
   * the response starts streaming is silent: both stay `null`), or an `InterruptError`'s
   * `code` for a queued run refused before it started. `null` otherwise, and
   * whenever `error` is `null`. Branch on this instead of matching `error`'s
   * text. Pressing Stop (`abort()`) is not an error: both stay `null`.
   */
  errorCode: Readonly<Ref<AgentErrorCode | null>>
  /** Live streaming content of the current assistant message. */
  streamingContent: Readonly<Ref<string>>
  /** Result of the last completed run. */
  lastResult: DeepReadonly<Ref<RunAgentResult | null>>
  /**
   * How the most recent run ended. `null` before the first run, while a run is
   * in flight, and after `reset()` / `setMessages()`. A `RUN_FINISHED` without
   * an outcome counts as `success`, as the client treats it. Only runs started
   * by `send` / `continueRun` are reported, not direct `agent.runAgent()` calls.
   */
  lastOutcome: Readonly<Ref<RunOutcome | null>>
  /**
   * Token usage the backend reported for the most recent run, verbatim from
   * `RUN_FINISHED.usage` or `RUN_ERROR.usage` (one entry per provider/model;
   * combine them with `aggregateTokenUsage` from `@ag-ui/core`). `null` when it
   * reported none, and on the same occasions as `lastOutcome`.
   */
  usage: Readonly<Ref<readonly TokenUsage[] | null>>
  /**
   * Message id → the `run_id` that produced it (see
   * {@link UseAgentReturn.runForMessage}). An ordinary reactive ref — a fresh
   * Map is assigned on each change, so `computed` / `watch` over it behave as
   * expected without `deep`.
   */
  messageRuns: Readonly<Ref<ReadonlyMap<string, string>>>
  /**
   * The `run_id` of the run that produced a message, or `undefined` if unknown:
   * a message hydrated from storage without provenance, one added between runs
   * (a locally-submitted tool result, say), or one left behind by a run that
   * errored or was aborted mid-stream — a run only reports what it produced once
   * it completes.
   *
   * Reports the run that actually emitted the message — a fact, not a grouping
   * policy. An exchange spanning several runs (a tool round-trip) therefore
   * yields several ids; correlating those runs into one logical exchange is the
   * consumer's call, and AG-UI's own `interrupts` (0.0.57+) gives a protocol
   * key for it via `Interrupt.id`. Deliberately not invented here.
   *
   * Provenance is tracked in a side-map, never as a field on the `Message`
   * object: nothing non-spec may ride back to the server inside
   * `RunAgentInput.messages`.
   */
  runForMessage: (messageId: string) => string | undefined
  /**
   * Interrupts the thread is paused on: set when a run finishes with an
   * `interrupt` outcome, cleared once a later run finishes with `success` or
   * `cancelled`. While non-empty, `send` / `continueRun` refuse to start a run
   * that does not answer them via `resume`. The protocol objects as received —
   * use `useInterrupts` for a resolvable per-interrupt view.
   */
  interrupts: Readonly<Ref<readonly Interrupt[]>>
  /** The underlying HttpAgent instance, for advanced usage. */
  agent: HttpAgent
  /** Send a user message and run the agent. */
  send: (content: string | ContentPart[], runOptions?: RunOptions) => Promise<void>
  /** Continue an agent run without adding a new user message. */
  continueRun: (runOptions?: RunOptions) => Promise<void>
  /** Abort the currently running agent request. */
  abort: () => void
  /** Reset all state and start a fresh conversation. */
  reset: () => void
  /**
   * Replace the conversation's messages wholesale and refresh the reactive ref.
   *
   * Unlike pushing to `agent.messages` directly, this also reassigns the
   * `messages` ref so Vue reacts. Intended for hydrating a persisted
   * conversation *after* construction (see `useThread`), where the messages
   * are not known synchronously.
   *
   * @param messageRuns - Persisted run provenance for those messages, restoring
   *   `runForMessage` for a reloaded conversation. Omit it and the hydrated
   *   messages simply report no run.
   * @param interrupts - Persisted open interrupts, so a conversation saved while
   *   paused can be resumed after a reload. Omit it and the conversation has
   *   none.
   */
  setMessages: (
    messages: Message[],
    messageRuns?: Record<string, string> | ReadonlyMap<string, string>,
    interrupts?: readonly Interrupt[],
  ) => void
}

/**
 * Core composable for connecting a Vue app to an AG-UI agent.
 *
 * Wraps `@ag-ui/client`'s `HttpAgent` and exposes reactive state
 * that updates as the agent streams events.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAgent } from 'ag-ui-vue'
 *
 * const { messages, isRunning, send, abort } = useAgent({
 *   url: '/api/agent',
 * })
 * </script>
 * ```
 */
export function useAgent(options: UseAgentOptions): UseAgentReturn {
  // --- Resolve reactive options at use time ---
  // url/headers/threadId may be refs or getters. We resolve them via toValue()
  // right before each request so reactive values (e.g. a refreshing auth token)
  // are always sent fresh, instead of being captured once at construction.
  const resolveHeaders = (): Record<string, string> => toValue(options.headers) ?? {}

  /**
   * Resolve the `forwardedProps` for one request: the composable-level defaults
   * with this run's keys shallow-merged on top, so a per-run key wins.
   *
   * JSON-stripped for the same reason `state` is (see {@link stripState}), and it
   * is the same category of data: consumer-supplied, deliberately uninterpreted,
   * and JSON over the wire — `HttpAgent` sends `RunAgentInput` as
   * `JSON.stringify(input)`, so the round-trip cannot lose anything the server
   * would have received. Without it, the natural usage
   * (`forwardedProps: () => ({ config: settings })` where `settings` is a
   * `reactive()` object or a store) throws `DataCloneError` from the
   * `structuredClone` deep inside the client: the shallow merge only unwraps the
   * top level, and `toRaw` would leave the nested proxies in place too.
   */
  const resolveForwardedProps = (perRun?: Record<string, any>): Record<string, any> =>
    stripState({ ...toValue(options.forwardedProps), ...perRun })

  /**
   * Resolve the `context` for one request: the composable-level entries, then
   * this run's. Each entry is rebuilt as a plain `{ description, value }` with
   * a ref or getter `value` unwrapped and a non-string one JSON-serialised (the
   * protocol's `Context.value` is a string). That serialisation is also the
   * proxy strip: `JSON.stringify` reads through reactive proxies, so a
   * store-backed entry can't reach the client's `structuredClone` as a proxy.
   * The `undefined` check runs after serialising, so it also drops values JSON
   * can't represent (a function, a symbol).
   */
  const resolveContext = (perRun?: readonly ContextEntry[]): Context[] =>
    [...(toValue(options.context) ?? []), ...(perRun ?? [])].flatMap(({ description, value }) => {
      const raw = toValue(value)
      const serialised = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return serialised === undefined ? [] : [{ description, value: serialised }]
    })

  /** Mint the id for a new run. Client-owned — see `UseAgentOptions.runIdFactory`. */
  const nextRunId = (): string => options.runIdFactory?.() ?? randomUUID()

  // --- HttpAgent instance ---
  const agent = new HttpAgent({
    url: toValue(options.url),
    headers: resolveHeaders(),
    threadId: toValue(options.threadId) ?? `thread_${Date.now()}`,
  })

  /**
   * Push the latest resolved url/headers onto the agent before a request.
   * HttpAgent reads `this.url`/`this.headers` when building each fetch, so
   * mutating them here is enough to pick up reactive changes.
   */
  function syncRequestConfig() {
    agent.url = toValue(options.url)
    agent.headers = resolveHeaders()
  }

  /**
   * Run the agent for the given options, applying the onError retry policy.
   *
   * Re-resolves url/headers (via syncRequestConfig) before every attempt, so a
   * token refreshed inside the onError handler is sent on the retry. Retries at
   * most once per request to guard against infinite loops. Returns once the run
   * settles (success, terminal error, or supersession by reset/new run).
   *
   * `runId` is minted by the caller, *outside* this loop: a retry is the same
   * logical run and must keep its id, or anything keyed on it (feedback,
   * telemetry) would be attributed to a run the server never completed.
   *
   * Writes lastResult on success and error on terminal failure; respects the
   * runToken so a run superseded mid-flight (reset/thread-switch, or a reset
   * triggered from within the onError handler) never leaks its outcome.
   */
  async function runWithRetry(
    runOptions: RunOptions | undefined,
    token: number,
    runId: string,
  ) {
    // At most two attempts: the original request plus one retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      // Per attempt, so a retry reports what the request that finished reported.
      lastOutcome.value = null
      usage.value = null
      syncRequestConfig()
      try {
        const result = await agent.runAgent(
          {
            runId,
            tools: runOptions?.tools ?? [],
            context: resolveContext(runOptions?.context),
            forwardedProps: resolveForwardedProps(runOptions?.forwardedProps),
            // Payloads are consumer-supplied JSON, like forwardedProps — strip proxies.
            ...(runOptions?.resume?.length && { resume: stripState(runOptions.resume) }),
          },
          runOptions?.subscriber,
        )
        if (token !== runToken) return // superseded by reset/new run
        lastResult.value = result
        // Stamp only once the run is known to still be current: a superseded run
        // (reset/thread-switch) has had its messages *and* provenance cleared, so
        // writing ids into the fresh conversation's map would strand them.
        stampRun(result.newMessages, runId)
        return
      } catch (e) {
        if (token !== runToken) return // aborted by reset/thread-switch; don't leak onto the new state
        // AbortError is expected when the user cancels — not a failed request.
        // Fallback only: @ag-ui/client 1.0 swallows AbortError and resolves
        // runAgent, so this is unreachable there.
        if (e instanceof Error && e.name === 'AbortError') {
          // Same code as the client's own RUN_ERROR on abort, so both routes read alike.
          setError('Request aborted', 'abort')
          return
        }

        // Give the consumer a chance to recover (e.g. refresh an expired token)
        // and request a retry — but only on the first attempt, so a persistently
        // failing request can never loop forever.
        if (options.onError && attempt === 0) {
          const decision = await options.onError(e as AgentRequestError)
          if (token !== runToken) return // handler triggered reset/new run while awaiting
          if (decision?.retry) continue // re-resolve config and run once more
        }

        setError(e instanceof Error ? e.message : 'An unexpected error occurred')
        return
      }
    }
  }

  // --- Reactive state ---
  // shallowRef, not ref: the array is always replaced wholesale (every
  // onMessagesChanged assigns a fresh `[...agent.messages]`), so consumers get
  // identical reactivity without Vue deep-proxying every message on every
  // streamed token. It also keeps messages as plain objects, so they cross into
  // @ag-ui/client (which uses structuredClone) without a proxy strip.
  // INVARIANT: only ever reassign `messages.value` — never mutate it in place
  // (`messages.value.push(...)`, `messages.value[i].content += ...`), which a
  // shallowRef would not detect.
  const messages: Ref<Message[]> = shallowRef([])
  const isRunning = ref(false)

  /**
   * Monotonic token identifying the current run. Bumped when a run starts and
   * when reset() invalidates in-flight work. A run's async completion only
   * writes back state if its token still matches — otherwise a run aborted by a
   * mid-run reset/thread-switch would leak its outcome ('Request aborted',
   * isRunning) onto the freshly reset conversation.
   */
  let runToken = 0

  // Run ids useAgent abandoned via abort()/reset() while still in flight. A
  // real abort doesn't reject `agent.runAgent()` — HttpAgent turns it into a
  // RUN_ERROR *event* instead, bypassing runWithRetry's token guard. Keyed on
  // the event's own `input.runId`, not a counter, so a new run starting
  // before the stale event arrives doesn't re-arm the leak, and a consumer's
  // own `agent.runAgent()` calls are never affected.
  const abandonedRunIds = new Set<string>()

  // Run id most recently started by send()/continueRun() — what abort()/reset() abandon, if that run is still in flight.
  let currentRunId: string | null = null

  /**
   * Message id → the producing `run_id`. A side-map rather than a field on the
   * `Message`: messages go back to the server verbatim inside
   * `RunAgentInput.messages`, so nothing non-spec may ride along.
   *
   * Copy-on-write in a `shallowRef`: reassigning a fresh Map (rather than
   * mutating + `triggerRef`) keeps it behaving like an ordinary ref for
   * consumers — a plain `watch(messageRuns, …)` fires, which it would not for an
   * in-place mutation whose old and new values are the same object.
   */
  const messageRuns = shallowRef<ReadonlyMap<string, string>>(new Map())

  /**
   * Record `runId` as the producing run for each of `newMessages`.
   *
   * Fed from `RunAgentResult.newMessages`, which `runAgent` computes by
   * snapshotting the message ids present *before* the stream and diffing after
   * it. Deriving provenance from that diff — rather than scanning
   * `agent.messages` for ids we have not stamped yet — is what makes the
   * attribution exact: only messages a run actually emitted can appear in it, so
   * a message adopted outside a run (hydrated from storage, `initialMessages`,
   * a locally-submitted tool result) can never be retroactively swept up by
   * whichever run happens to come next.
   *
   * Already-stamped ids keep their original run, so a retry re-reporting its
   * first attempt's messages does not re-attribute them.
   *
   * Entries for messages no longer in the transcript are dropped in the same
   * pass. A MESSAGES_SNAPSHOT replaces the transcript with the server's view and
   * discards local messages absent from it; without this their provenance would
   * linger forever, and `useThread` persists the whole map, so it would
   * round-trip to storage on every save. Once per run over a
   * transcript-sized map — not worth a cheaper, more intricate trigger.
   *
   * Tolerates a result without `newMessages` (a partial/stubbed agent result):
   * no provenance is better than wrong provenance.
   */
  function stampRun(produced: readonly { id: string }[] | undefined, runId: string) {
    if (!produced?.length) return
    const live = new Set(agent.messages.map((m) => m.id))
    const next = new Map([...messageRuns.value].filter(([id]) => live.has(id)))
    for (const m of produced) {
      if (!next.has(m.id)) next.set(m.id, runId)
    }
    messageRuns.value = next
  }

  // Hydrate from persisted messages if provided
  if (options.initialMessages?.length) {
    agent.messages.push(...options.initialMessages)
    messages.value = [...agent.messages]
  }
  const error = ref<string | null>(null)
  const errorCode = ref<AgentErrorCode | null>(null)

  /**
   * Write `error` and `errorCode` together, so a code never outlives its message.
   * `reportOutcome: false` leaves `lastOutcome` alone, for an error from a run
   * useAgent didn't start, or from one that was refused before it started.
   */
  function setError(message: string | null, code: AgentErrorCode | null = null, reportOutcome = true) {
    error.value = message
    errorCode.value = message === null ? null : code
    if (message !== null && reportOutcome) lastOutcome.value = { type: 'error', code }
  }

  // Fresh objects/arrays on every write, so a plain watch() fires.
  const lastOutcome = shallowRef<RunOutcome | null>(null)
  const usage = shallowRef<readonly TokenUsage[] | null>(null)

  /**
   * The currently streaming message content, updated on every
   * TEXT_MESSAGE_CONTENT event. Useful for rendering a streaming
   * indicator or live preview without scanning the messages array.
   */
  const streamingContent = ref('')

  /**
   * The most recently completed RunAgentResult, available after
   * each successful `send()` call.
   */
  const lastResult = shallowRef<RunAgentResult | null>(null)

  /**
   * Queued follow-up run to execute after the current run finishes.
   * This handles the race condition where frontend tools call continueRun()
   * while the original run is still active.
   *
   * Uses shallowRef to avoid Vue trying to make tools array deeply reactive,
   * which would fail with structuredClone on Vue reactive proxies.
   */
  const pendingContinueRun = shallowRef<{
    runOptions?: RunOptions
  } | null>(null)

  // --- Subscriber bridges AG-UI events → Vue refs ---
  const subscriber: AgentSubscriber = {
    onMessagesChanged() {
      // HttpAgent maintains its own messages array internally.
      // We sync it into our reactive ref so Vue picks up changes.
      messages.value = [...agent.messages]
    },

    onTextMessageContentEvent({ textMessageBuffer }) {
      streamingContent.value = textMessageBuffer
    },

    onTextMessageEndEvent() {
      streamingContent.value = ''
    },

    onRunFinishedEvent({ event, input }) {
      // Not ours: a consumer's own agent.runAgent(), or a run superseded by a newer one.
      // Abandoned: abortRun() doesn't drop events the client already parsed, so a
      // RUN_FINISHED can still arrive after Stop/reset(). `has`, not `delete`: the
      // synthetic abort RUN_ERROR comes after it and needs the id to be suppressed.
      if (input?.runId !== currentRunId || abandonedRunIds.has(input.runId)) return
      lastOutcome.value = getRunOutcome(event) ?? { type: 'success' }
      usage.value = event.usage ? [...event.usage] : null
    },

    onRunErrorEvent({ event, input }) {
      // Suppresses any RUN_ERROR for an abandoned run, not just the synthetic
      // 'abort' one — once a run is abandoned, nothing it reports is still
      // relevant. RUN_ERROR is terminal for its run, so the id is removed
      // once matched rather than kept for the composable's whole lifetime.
      if (input?.runId && abandonedRunIds.delete(input.runId)) return // stale: abandoned by reset()/abort() before the event arrived
      // A consumer's own agent.runAgent() still sets error, but outcome and
      // usage only describe runs useAgent started (as in onRunFinishedEvent).
      const ours = input?.runId === currentRunId
      if (ours) usage.value = event.usage ? [...event.usage] : null
      setError(event.message ?? 'An error occurred during the run', event.code ?? null, ours)
    },
  }

  const subscription = agent.subscribe(subscriber)

  /**
   * Publish a direct write to `agent.messages` (send, setMessages, reset).
   * Those mutate the array in place rather than go through
   * `agent.setMessages`, so the client never tells its subscribers. Other
   * composables on this agent (useReasoning, useActivities) and consumer
   * subscribers would otherwise miss a thread switch. Synchronous, unlike the
   * client's own notification, so they are current before the caller continues.
   * A listener that throws (or rejects) is logged and skipped, as the client
   * does: in send() this runs before the request, so a throw would leave the
   * agent stuck running with nothing sent.
   */
  function publishMessages() {
    messages.value = [...agent.messages]
    for (const s of agent.subscribers) {
      if (s === subscriber) continue
      try {
        Promise.resolve(s.onMessagesChanged?.({ messages: agent.messages, state: agent.state, agent })).catch(
          logSubscriberError,
        )
      } catch (err) {
        logSubscriberError(err)
      }
    }
  }

  function logSubscriberError(err: unknown) {
    console.error('Subscriber error:', err)
  }

  // Shared frontend-tool coordinator. Owns the single TOOL_CALL_* subscription
  // and the per-turn batching gate; useFrontendTool/useGenerativeUI discover it
  // via the agent. continueRun is wrapped so the (hoisted) function is resolved
  // at call time. The coordinator fires continueRun during onRunFinishedEvent —
  // isRunning is still true then, so it rides the pendingContinueRun queue and
  // flushes in the run's finally block, exactly like a tool-issued continue.
  const registry = createToolRegistry(agent, {
    continueRun: (runOptions) => {
      continueRun(runOptions).catch(reportRefusedRun)
    },
  })

  // Interrupt coordinator: tracks the interrupts the thread is paused on and
  // guards every run against the interrupt rules (see assertRunAllowed below).
  const interruptRegistry = createInterruptRegistry(agent, {
    validateResumePayload: options.validateResumePayload,
  })

  /**
   * Every client-side run check, shared by `send` and `continueRun`. The
   * resume itself is validated first, so a malformed one reports its own error.
   * A resume must not leave a frontend call of the interrupted run unanswered:
   * its RUN_STARTED would terminate the call and the tool call would go out
   * without a result. Plain runs keep the old behaviour (terminate the call).
   */
  function assertRunAllowed(resume: RunOptions['resume']) {
    interruptRegistry.assertRunAllowed(resume)
    if (resume?.length && registry.hasUnresolvedCalls()) {
      throw new InterruptError(
        'frontend-calls-pending',
        'Answer the pending frontend tool calls before resuming',
      )
    }
  }

  /**
   * Surface a run that was refused before it started — e.g. an `InterruptError`
   * — when nobody awaits it (a queued or coordinator-issued continuation).
   */
  function reportRefusedRun(e: unknown) {
    // No outcome: the run never started, and lastOutcome/usage keep describing
    // the last one that did (as for a synchronous refusal from send()).
    setError(e instanceof Error ? e.message : String(e), e instanceof InterruptError ? e.code : null, false)
  }

  // Clean up when the component unmounts
  onScopeDispose(() => {
    subscription.unsubscribe()
    agent.abortRun()
  })

  // --- Actions ---

  /**
   * Shared tail of `send`/`continueRun`: settle the run and flush any queued
   * follow-up (e.g. from frontend tool execution).
   */
  function settleRun(token: number) {
    if (token !== runToken) return
    isRunning.value = false
    streamingContent.value = ''

    if (pendingContinueRun.value) {
      const queued = pendingContinueRun.value
      pendingContinueRun.value = null
      // Don't await here - let it run asynchronously
      continueRun(queued.runOptions).catch(reportRefusedRun)
    }
  }

  /**
   * Send a user message and run the agent.
   *
   * Adds the message to the agent's internal list, triggers a run,
   * and streams events into the reactive state.
   *
   * @param content - The user's message text.
   * @param runOptions - Optional overrides for this specific run
   *   (tools, context, additional subscriber, etc.).
   */
  async function send(
    content: string | ContentPart[],
    runOptions?: RunOptions,
  ) {
    if (typeof content === 'string' ? !content.trim() : content.length === 0) {
      throw new Error('Cannot send empty message')
    }

    if (isRunning.value) {
      throw new Error('Agent is already running')
    }

    // Refuse before the user message is pushed: a refused send must leave no
    // trace in the transcript.
    assertRunAllowed(runOptions?.resume)

    setError(null)
    isRunning.value = true
    streamingContent.value = ''

    const runId = nextRunId()

    // Add user message to agent's internal message list.
    // A UUID, not `msg_${Date.now()}`: two sends in the same millisecond would
    // collide, corrupting Vue's keying and every id-keyed map (provenance
    // included).
    const userMessageId = randomUUID()
    agent.messages.push({
      id: userMessageId,
      role: 'user',
      content: typeof content === 'string' ? content.trim() : content,
    } as Message)

    // Stamped here rather than from RunAgentResult.newMessages: the message is
    // pushed *before* runAgent snapshots the pre-run ids, so it is by definition
    // excluded from that diff. It belongs to this run — it is what the run was
    // started to send — and stamping it now (rather than on completion) means a
    // run that fails or is aborted still attributes the message the user typed.
    // Before publishing, so a listener's runForMessage() already sees it.
    stampRun([{ id: userMessageId }], runId)

    // Sync immediately so the user message appears in the UI
    publishMessages()

    const token = ++runToken
    currentRunId = runId

    try {
      // Merge auto-registered frontend tools with any explicit ones for this run.
      await runWithRetry(
        { ...runOptions, tools: registry.mergeTools(runOptions?.tools) },
        token,
        runId,
      )
    } finally {
      settleRun(token)
    }
  }

  /**
   * Continue an agent run without adding a new user message.
   *
   * This is used after tool results have been added to the message history
   * to allow the agent to continue processing. Unlike `send()`, this does NOT
   * add a new user message — it just resumes the conversation with the current
   * message history.
   *
   * Useful for:
   * - Frontend tool execution (after adding tool result via agent.addMessage())
   * - Human-in-the-loop flows (after user provides tool result)
   * - Deferred tool patterns (after external service provides result)
   *
   * Per AG-UI semantics a continuation is a **new run**, so it gets its own
   * fresh `run_id` and messages it produces are stamped with that id — an
   * exchange spanning a tool round-trip therefore spans several run ids.
   *
   * @param runOptions - Optional overrides for this run (tools, context,
   *   forwardedProps, subscriber)
   *
   * @example
   * ```ts
   * // After executing a frontend tool
   * agent.addMessage({
   *   role: 'tool',
   *   content: JSON.stringify(result),
   *   toolCallId: 'call_123',
   * })
   * await continueRun({ tools: frontendTools.value })
   * ```
   */
  async function continueRun(
    runOptions?: RunOptions,
  ) {
    if (isRunning.value) {
      // Never queue a resume: whether it is still valid depends on how the run
      // in flight ends, and the single-slot queue would replay it after a
      // successful resume (as a stale `interrupt-unknown`) or re-send it after
      // a failed one.
      if (runOptions?.resume?.length) {
        throw new InterruptError('run-in-flight', 'A run is already in flight; resume once it settles')
      }
      // Queue this run to execute after the current run finishes
      pendingContinueRun.value = { runOptions }
      return
    }

    // Checked when the run actually starts, not when it was queued: the run in
    // flight may have opened or closed interrupts since.
    assertRunAllowed(runOptions?.resume)

    setError(null)
    isRunning.value = true
    streamingContent.value = ''

    const runId = nextRunId()

    const token = ++runToken
    currentRunId = runId

    try {
      // Merge auto-registered frontend tools with any explicit ones for this run.
      await runWithRetry(
        { ...runOptions, tools: registry.mergeTools(runOptions?.tools) },
        token,
        runId,
      )
    } finally {
      settleRun(token)
    }
  }

  /**
   * Abort the currently running agent request.
   */
  function abort() {
    agent.abortRun()
    runToken++ // invalidate any in-flight run (incl. a pending onError retry) so it can't fire/write back after abort
    // Only a run still in flight can produce a late RUN_ERROR — skip when idle
    // (e.g. a thread switch between runs), or a custom runIdFactory that
    // reuses an id could have a later real error suppressed forever.
    if (isRunning.value && currentRunId) abandonedRunIds.add(currentRunId)
    // Discard coordinator turn-state so a slow tool handler can't inject/continue
    // after abort. Exception: an idle abort while paused on interrupts. Abort
    // doesn't close them, so the resume still has to carry the frontend calls'
    // results; and an interrupted turn never continues on its own, so keeping it
    // open is safe.
    if (isRunning.value || !interruptRegistry.open.value.length) registry.abandonTurn()
    if (isRunning.value) lastOutcome.value = { type: 'aborted' } // an idle abort keeps the last real outcome
    isRunning.value = false
    streamingContent.value = ''
    pendingContinueRun.value = null // Clear any queued runs
  }

  /**
   * Replace the conversation's messages wholesale and refresh the reactive ref.
   *
   * Mirrors the in-place manipulation used by send()/reset() (`agent.messages`
   * is mutated directly), then reassigns the shallowRef so Vue reacts. Used to
   * hydrate a persisted conversation after construction.
   *
   * These messages carry their own persisted provenance (via `runs`) or none at
   * all; they are never stamped with a run, because provenance is derived from
   * what a run reports having produced, not from what is in the array.
   *
   * Replacing the messages always replaces the provenance map — omitting `runs`
   * means "these messages have no known runs", not "keep the previous
   * conversation's". Carrying the old map over would attribute a hydrated
   * transcript to runs from a conversation it was never part of, and would grow
   * unbounded across switches. (`useThread` reaches this via `reset()` first, so
   * only a direct `useAgent` consumer swapping conversations depends on it.)
   *
   * Open interrupts are replaced the same way: omitting `interrupts` means the
   * conversation is not paused.
   */
  function setMessages(
    newMessages: Message[],
    runs?: Record<string, string> | ReadonlyMap<string, string>,
    interrupts?: readonly Interrupt[],
  ) {
    agent.messages.length = 0
    if (newMessages.length) agent.messages.push(...newMessages)
    // The client gates every run on its own pendingInterrupts; left over from
    // the previous conversation it would lock the swapped-in one.
    interruptRegistry.restore(interrupts ?? [])
    messageRuns.value = runs
      ? new Map(runs instanceof Map ? runs : Object.entries(runs))
      : new Map()
    lastOutcome.value = null
    usage.value = null
    // Last, so listeners read the swapped-in conversation's runs and interrupts.
    publishMessages()
  }

  /**
   * Reset all state and start a fresh conversation.
   */
  function reset() {
    agent.abortRun()
    runToken++ // invalidate any in-flight run so its async completion can't write back
    if (isRunning.value && currentRunId) abandonedRunIds.add(currentRunId) // see abort()'s comment on this guard
    registry.abandonTurn() // discard coordinator turn-state so a slow tool handler can't inject into the fresh conversation
    agent.messages.length = 0
    interruptRegistry.restore([]) // else an interrupted conversation locks the fresh one
    messageRuns.value = new Map()
    isRunning.value = false
    setError(null)
    streamingContent.value = ''
    lastResult.value = null
    lastOutcome.value = null
    usage.value = null
    pendingContinueRun.value = null // Clear any queued runs
    publishMessages() // last, so listeners see the fresh state
  }

  // --- React to changed reactive options ---
  // A changed threadId means a different conversation: point the agent at the
  // new thread and reset state. Static threadIds never trigger this (the getter
  // returns a constant, so the watch never fires).
  watch(
    () => toValue(options.threadId),
    (newThreadId) => {
      if (newThreadId == null) return
      reset()
      agent.threadId = newThreadId
    },
  )

  // A changed url retargets the endpoint without discarding history (unlike a
  // threadId change, a new URL doesn't invalidate the conversation).
  // syncRequestConfig() already applies it per request; we mirror it eagerly so
  // direct reads of `agent.url` (middleware, custom subscribers) stay current.
  // Note: changing url mid-run only affects the *next* request — the agent
  // reads `this.url` once when building each fetch, so the in-flight run is
  // unaffected, but a follow-up fetch within the same logical run (e.g. a tool
  // round-trip via continueRun) would use the new endpoint.
  watch(
    () => toValue(options.url),
    (newUrl) => {
      agent.url = newUrl
    },
  )

  return {
    /** Reactive array of all messages in the conversation. */
    messages: readonly(messages) as DeepReadonly<Ref<Message[]>>,
    /** Whether the agent is currently processing a request. */
    isRunning: readonly(isRunning),
    /** The latest error message, or null. */
    error: readonly(error),
    /** Machine-readable code for the latest error, or null. */
    errorCode: readonly(errorCode),
    /** Live streaming content of the current assistant message. */
    streamingContent: readonly(streamingContent),
    /** Result of the last completed run. */
    lastResult: readonly(lastResult) as DeepReadonly<Ref<RunAgentResult | null>>,
    /** How the most recent run ended, or null. */
    // shallowReadonly, not readonly(): the latter deep-proxies the value, which
    // then throws on structuredClone (persisting usage, passing interrupts on).
    lastOutcome: shallowReadonly(lastOutcome) as Readonly<Ref<RunOutcome | null>>,
    /** Token usage reported for the most recent run, or null. */
    usage: shallowReadonly(usage) as Readonly<Ref<readonly TokenUsage[] | null>>,
    /** Message id → the run id of the turn that produced it. */
    messageRuns: readonly(messageRuns) as Readonly<Ref<ReadonlyMap<string, string>>>,
    /** The run id of the turn that produced a message, if known. */
    runForMessage: (messageId: string) => messageRuns.value.get(messageId),
    /** Interrupts the thread is paused on. */
    interrupts: interruptRegistry.open,
    /** The underlying HttpAgent instance, for advanced usage. */
    agent,

    send,
    continueRun,
    abort,
    reset,
    setMessages,
  }
}
