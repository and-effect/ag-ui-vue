# `useAgent`

Core composable. Connects to an AG-UI backend, streams messages into reactive refs, and exposes `send`, `abort`, and `reset`. Beyond the basics shown in Quick Start:

```ts
const { messages, isRunning, error, streamingContent, agent, send, abort, reset } = useAgent({
  url: '/api/agent',
  headers: { Authorization: `Bearer ${token}` },
  initialMessages: previousMessages,  // Pre-load conversation history
})
```

`streamingContent` holds the live message text while it's being received — useful for showing a typing indicator or rendering text before `TEXT_MESSAGE_END`. The raw `HttpAgent` instance is always accessible via `agent` for middleware and custom subscribers.

`url`, `headers`, and `threadId` accept refs or getters (`MaybeRefOrGetter`) and are resolved with `toValue()` before every request — so a token that refreshes mid-session is always sent fresh, and changing `threadId` resets and reconnects the conversation:

```ts
const token = ref('...')
const threadId = ref('thread_1')

const { send } = useAgent({
  url: '/api/agent',
  headers: () => ({ Authorization: `Bearer ${token.value}` }), // re-read each request
  threadId,                                                     // change to start a new thread
})
```

Static values still work — `MaybeRefOrGetter` is a superset, so existing usage is unchanged.

## Handling failed requests — `onError` (token refresh & retry)

Resolving `headers` per request keeps the token fresh on user-initiated sends, but it can't recover a request that fails *because* the token expired in flight. The `onError` hook closes that gap: it fires when any request fails — including ones `useAgent` issues internally, such as tool-result continuations via `continueRun` — and can refresh credentials and ask for a single retry.

```ts
const token = ref('...')

const { send } = useAgent({
  url: '/api/agent',
  headers: () => ({ Authorization: `Bearer ${token.value}` }),
  onError: async (err) => {
    if (err.status === 401) {
      await refreshSession()   // update the token ref
      return { retry: true }   // re-run once, re-resolving url/headers
    }
    // return nothing for anything else → the error surfaces on `error`
  },
})
```

- The error is a standard `Error`, augmented by `@ag-ui/client` with `status` and `payload` on non-OK HTTP responses (a pure network failure has no `status`).
- Returning `{ retry: true }` re-runs the request once, re-resolving `url`/`headers` via `toValue()` so the refreshed token is sent.
- A request is retried **at most once** — if the retry also fails, the error surfaces on `error` regardless of what the hook returns (no infinite loops).
- User-initiated aborts (`abort()` / `AbortError`) never trigger `onError`.
- The hook is `async`, so you can `await` a backoff delay before returning `{ retry: true }` (e.g. for transient network errors). Omitting it entirely keeps the previous behavior.
- The retry re-sends the **same `run_id`** — a refresh-and-retry is one logical run, not two (see [Run identity](#run-identity)). That's clean for a `401`, where the request never reached the model. But `onError` fires for *every* failure, so retrying after a partially-streamed response re-sends that run id alongside the partial assistant message already in the transcript. If your backend keys run state on `run_id` — a LangGraph checkpointer, say — retry only the failures you know left no server-side run behind.

## Error codes — `errorCode`

`errorCode` holds a machine-readable code for `error` when the source provides one, so you can branch on a fixed value instead of the message text:

- A `RUN_ERROR` event's `code`, as set by your backend (e.g. a rate-limit code).
- `'abort'` for a run aborted mid-stream outside `abort()`, e.g. via `agent.abortRun()` on the raw agent. An abort before the response starts streaming is silent: `error` and `errorCode` both stay `null`.
- An `InterruptError`'s `code` for a queued run refused before it started.

It is `null` otherwise, including for network and HTTP errors (use `onError`'s `err.status` there) and for `useThreads` storage errors. Pressing Stop (`abort()`) is not an error: `error` and `errorCode` both stay `null`.

The type is `AgentErrorCode`, which autocompletes the values above. Backend codes and these share one string, so a backend that sends `'abort'` reads the same as a client-side abort.

## Run outcome and token usage — `lastOutcome`, `usage`

`lastOutcome` says how the most recent run ended:

- `{ type: 'success' }`, `{ type: 'interrupt', interrupts }` or `{ type: 'cancelled' }`, as reported by `RUN_FINISHED` (a missing outcome counts as `success`).
- `{ type: 'error', code }` for a `RUN_ERROR` or a failed request. `code` is the same value as `errorCode`.
- `{ type: 'aborted' }` when you pressed Stop (`abort()`). `error` stays `null`, so branch on this rather than on the error text.

`usage` holds the `TokenUsage[]` from `RUN_FINISHED.usage` or `RUN_ERROR.usage` as sent, one entry per provider/model. To combine entries, use `aggregateTokenUsage` from `@ag-ui/core`. It is `null` when the backend reported none.

```ts
const { lastOutcome, usage } = useAgent({ url: '/api/agent' })
const tokens = computed(() => (usage.value ? aggregateTokenUsage([...usage.value]) : null))
```

Both are `null` before the first run, while a run is in flight, and after `reset()` / `setMessages()`. Only runs started by `send()` / `continueRun()` are reported, not direct `agent.runAgent()` calls. After an `onError` retry they describe the retried request.

## Multimodal messages

`send()` accepts either a plain string or a `ContentPart[]` for multimodal messages:

```ts
import type { ImagePart, DocumentPart } from '@and-effect/ag-ui-vue'

// Plain text
send('What time is it in Tokyo?')

// Mixed text + image
send([
  { type: 'text', text: 'What is in this screenshot?' },
  { type: 'image', source: { type: 'data', value: base64, mimeType: 'image/png' } },
])

// Document only
send([
  // 1.0's DocumentPart has no top-level `filename` — the client strips fields it
  // does not recognise, so the document's name goes in the open `metadata` bag.
  { type: 'document', source: { type: 'data', value: base64, mimeType: 'application/pdf' }, metadata: { filename: 'report.pdf' } },
])
```

All `ContentPart` types — `TextPart`, `ImagePart`, `AudioPart`, `VideoPart`, `DocumentPart`, `PartSource`, `DataSource`, `UrlSource`, `FileSource` — are re-exported from `@and-effect/ag-ui-vue` so you don't need to import from `@ag-ui/core` directly. The pre-1.0 names (`InputContent`, `TextInputContent`, `InputContentSource`, …) are still exported as deprecated aliases of the same types.

`PartSource` has three arms: `DataSource` (`type: 'data'`, base64 in `value`), `UrlSource` (`type: 'url'`) and — new in AG-UI 1.0 — `FileSource` (`type: 'file'`), a handle the model provider issued for bytes already uploaded to it. A `FileSource` `value` is **not** a URL; don't render it as one. If you switch exhaustively on `source.type`, add a case for it.

## Run identity

> **Record the `run_id` alongside anything durable you key on a message.** The `run_id` is what the server knows a turn by — it received it in `RunAgentInput` and echoes it in `RUN_STARTED` — so it's the join key to the server's own trace, token, and cost records. Whether an *assistant message id* is equally durable depends on your backend: the server mints it (in `TEXT_MESSAGE_START`), but a stateless adapter typically discards it after the stream, while a stateful one (LangGraph's checkpointer, say) keeps it. Check yours before treating a message id as a stable server-side handle. Within ag-ui-vue itself the ids are stable — `useThreads` persists them verbatim.

`useAgent` owns the `run_id` rather than letting `@ag-ui/client` mint one internally. That makes it knowable client-side *before the first token streams*, and — the reason it matters — **stable across an `onError` retry**: a 401-refresh-and-retry is the same logical run, so it re-sends the same id instead of silently starting a second one under a new one.

Override the id policy with `runIdFactory` (symmetric with `useThreads`' `idFactory`):

```ts
useAgent({ url: '/api/agent', runIdFactory: () => `run_${traceId()}` })
```

Because a retry reuses the id, a `run_id` identifies one *logical* run rather than one HTTP request — the server can see two requests bearing it. Don't use it as a unique key for a server-side request record, and if your backend keys run state on `run_id`, see the caveat under [Handling failed requests](#handling-failed-requests--onerror-token-refresh--retry) about which failures are safe to retry.

**Which run produced this message?** `runForMessage(id)` answers it, live and after a reload:

```vue
<template>
  <div v-for="m in messages" :key="m.id">
    {{ m.content }}
    <FeedbackButtons v-if="m.role === 'assistant'" :run-id="runForMessage(m.id)" />
  </div>
</template>
```

For per-message features like feedback, **store both ids** — `{ threadId, runId, messageId }`. They answer different questions, and neither substitutes for the other: a run can emit several assistant bubbles (multiple text messages in one run are legal), so `run_id` alone can't say *which* bubble was rated; and one exchange can span several runs (below), so `message_id` alone doesn't tell you which run to join against for the trace or token counts.

Provenance is a **side-map** (`messageRuns`), never a field on the `Message` object — messages go back to the server verbatim inside `RunAgentInput.messages`, so nothing non-spec may ride along.

**One exchange can span several runs.** A tool round-trip is a new AG-UI run per hop, each with its own `run_id`, and `runForMessage` reports the run that **actually emitted** the message — a fact, not a grouping policy. So the assistant text after a tool call is attributed to the continuation run, not to the `send()` that started things.

Grouping those runs into one logical exchange is deliberately left to you. AG-UI has a protocol-level key for it — [interrupts](https://docs.ag-ui.com/concepts/interrupts) correlate a paused run and its resumption via `Interrupt.id` — and ag-ui-vue relies on that rather than inventing a parallel notion of its own. [`useInterrupts`](use-interrupts.md) handles the pause and the resume, but it does not group runs either: a resume run is just another run with its own `run_id`. To key on an exchange, join on `Interrupt.id` across runs for server-side pauses, or derive the key in your app from the user message that opened the exchange.

Attribution comes from what a run reports having produced when it completes, so a few things report `undefined` by design: messages added between runs (a locally-submitted tool result, say), messages hydrated without stored provenance, and a partial message left behind by a run that errored or was aborted mid-stream. Provenance for a streaming message therefore lands when its run finishes, not per token.

With [`useThreads`](use-threads.md) the map is persisted as `PersistedThread.messageRuns` and restored on hydration, so a reloaded thread answers `runForMessage` identically to a live one.

## Page context

`context` tells the agent what's around the conversation: the page the user is on, the item they have open, the filters they've set. It's sent as AG-UI's `RunAgentInput.context`, a list of `{ description, value }` entries the agent reads but never writes.

```ts
const pageContext = usePageContextStore()
const { send } = useAgent({
  url: '/api/agent',
  context: () => pageContext.entries, // e.g. [{ description: 'Application the user has open', value: application }]
})
```

The getter is re-read before **every** request: `send()`, the continuation after a [frontend tool](use-frontend-tool.md), an interrupt resume, and an `onError` retry. So a tool that changes what the user sees is reflected in the very next run, and the chat component never needs to know about pages. A per-run `send(content, { context })` is appended after these entries, for that request only. Entries aren't deduplicated.

A `value` can be a ref, a computed or a getter (e.g. from `storeToRefs()`); it is unwrapped per request. A string is then sent as is; anything else is JSON-serialised (the protocol's `value` is a string), so you can pass store objects directly, reactive or not. An entry whose `value` is `undefined` is left out, so "the current selection" can be listed unconditionally.

**Context, state or forwardedProps?**

| | Context | [State](use-agent-state.md) | [forwardedProps](#backend-specific-run-parameters) |
| --- | --- | --- | --- |
| Who reads it | The model | Agent and UI, both of which also write it | Your server code, as configuration |
| Lifetime | What the UI shows *now*, never persisted | Part of the conversation, persisted per thread by `useThreads` | Per request, never persisted |
| Shape | `{ description, value }` text for the model | A structured object the backend models | Whatever your backend expects |
| Use for | What's around the conversation (open page, selection, filters) | What user and agent work on together (a recipe, a canvas, a plan) | How the run is executed (model choice, temperature, tenant, a LangGraph `command`) |

Rule of thumb: if the model should read it, it's context. If agent and UI both read and write it and it belongs to the thread, it's state. If server-side code reads it as configuration, it's `forwardedProps`.

Putting "the open application" into state works, but it gets persisted with the thread (reopen it next week and it still claims you're viewing that application), and the agent can write it back.

**Backend.** Don't expect a backend to show `context` to the model by itself. LangGraph and Mastra make it available to your graph or agent (graph state, request context), but you still pass it on to the model; PydanticAI's `AGUIAdapter` drops it entirely. Since context isn't part of the transcript, put it next to the latest message rather than in the system prompt, or older messages can override it. See [`examples/backend/app/routers/page_context.py`](../../examples/backend/app/routers/page_context.py) for a PydanticAI version.

## Backend-specific run parameters

`forwardedProps` is AG-UI's protocol escape hatch — it rides along on `RunAgentInput` untouched, and what it means is up to your backend (LangGraph reads `command` / `config`; other integrations use it for model or agent selection).

```ts
// Applied to every run, resolved fresh per request
const { send } = useAgent({
  url: '/api/agent',
  forwardedProps: () => ({ model: model.value }),
})

// Per-run keys shallow-merge over the default
send('hello', { forwardedProps: { model: 'smart', temperature: 0.2 } })
```

You can hand it reactive data — a `reactive()` object, a store slice — without unwrapping it yourself; it's serialised to plain JSON on the way out. Since it goes over the wire as JSON either way, the usual JSON caveats apply: `Date`s arrive as ISO strings, and functions or `undefined` values are dropped.

> **Per-run props apply to one request, not one exchange.** A [frontend tool](use-frontend-tool.md) turns a single `send()` into a round-trip, and the second hop is a separate AG-UI run that the tool coordinator issues with the registered tools alone — so a `forwardedProps` (or `context`, or `subscriber`) passed to `send()` is not repeated on it. That's deliberate: re-sending a one-shot parameter like a LangGraph `command` on the continuation would be wrong more often than right. Anything that must hold for *every* hop goes on `useAgent` itself, where it's re-resolved fresh per request.

## API

### `useAgent(options)`

```ts
const {
  messages,          // DeepReadonly<Ref<Message[]>>
  isRunning,         // Readonly<Ref<boolean>>
  error,             // Readonly<Ref<string | null>>
  errorCode,         // Readonly<Ref<string | null>> — machine-readable code for error, if any
  streamingContent,  // Readonly<Ref<string>> — live content as it streams
  lastResult,        // Readonly<Ref<RunAgentResult | null>>
  lastOutcome,       // Readonly<Ref<RunOutcome | null>> — how the last run ended
  usage,             // Readonly<Ref<readonly TokenUsage[] | null>> — token usage of the last run
  messageRuns,       // Readonly<Ref<ReadonlyMap<string, string>>> — message id → run id
  runForMessage,     // (messageId: string) => string | undefined
  interrupts,        // Readonly<Ref<readonly Interrupt[]>> — open interrupts; see useInterrupts
  agent,             // HttpAgent instance
  send,              // (content: string | ContentPart[], options?) => Promise<void>
  continueRun,       // (options?) => Promise<void>
  abort,             // () => void
  reset,             // () => void
  setMessages,       // (messages: Message[], messageRuns?, interrupts?) => void
} = useAgent({
  url: '/api/agent',           // Required — string | ref | getter
  headers: { ... },            // Optional — object | ref | getter, resolved per request
  threadId: 'thread_123',      // Optional — string | ref | getter, auto-generated if omitted
  initialMessages: messages,   // Optional
  context: () => [...],        // Optional — ContextEntry[] | ref | getter, sent as RunAgentInput.context
  forwardedProps: { ... },     // Optional — object | ref | getter, sent as RunAgentInput.forwardedProps
  runIdFactory: () => uuid(),  // Optional — mint the run_id; defaults to a UUID
  onError: async (err) => {},  // Optional — (err: AgentRequestError) => void | { retry?: boolean } | Promise<…>
  validateResumePayload,       // Optional — (schema, payload, interrupt) => string[] | void | Promise<…>
})
```

Per-run options (`send(content, options)` / `continueRun(options)`):

```ts
interface RunOptions {
  tools?: Tool[]                          // merged over the auto-registered frontend tools
  context?: ContextEntry[]                // appended after the composable-level entries
  forwardedProps?: Record<string, any>    // shallow-merged over the composable-level default
  resume?: ResumeEntry[]                  // answers to the open interrupts; required while any are open
  subscriber?: AgentSubscriber            // extra subscriber, for this run only
}
```
