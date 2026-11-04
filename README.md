# ag-ui-vue

ag-ui-vue is a Vue toolkit for building agent-powered UIs. It gives you everything you need to go from a streaming chat interface to a full multi-thread conversation manager with persistent history, frontend tools, shared state, and headless components — without writing the same boilerplate every time.

Built on the open [AG-UI protocol](https://docs.ag-ui.com/), it works with any compatible backend: PydanticAI, LangGraph, Mastra, CrewAI, or anything emitting AG-UI events.

## Why ag-ui-vue?

**Not a React wrapper.** Built from scratch with Vue's reactivity system — `ref`, `computed`, `readonly`, `onScopeDispose` — with a deliberate reactivity boundary: shared `state` is deep-reactive so you mutate it directly (even with `v-model`) and it syncs to the agent, while streamed messages and protocol data stay `shallowRef` / `markRaw` to avoid needless deep-proxying. Everything behaves the way you'd expect in Vue.

**Multi-thread out of the box.** `useThreads` layers a full conversation manager onto your agent — localStorage persistence, auto-generated titles, and a storage adapter interface so you can swap in Pinia or a backend API. Switching swaps the conversation on one stable agent, so tools and middleware keep working across threads. A complete multi-thread chat UI in under 20 lines.

**Agents that act on your UI.** `useFrontendTool` lets agents call functions in the browser — toggle dark mode, update a form, trigger a confirmation dialog. Automatic execution or human-in-the-loop, with no polling or callbacks to wire up.

**Multimodal out of the box.** `send()` accepts `string | ContentPart[]`, so you can attach images, audio, video, and documents alongside text. `AgMessageInput` exposes `onAttach(file)` and `onRemoveAttachment(index)` slot helpers that handle base64 reading, content-type detection, and attachment list management — all without wiring up `FileReader` yourself.

**Generative UI.** `useGenerativeUI` maps tool names to Vue components and renders them inline as the agent calls them. Reactive props stream in as arguments arrive, with an optional loading component while the call is in flight.

**Headless components for the hard parts.** `AgMessageList`, `AgMessageInput`, `AgThreadList`, `AgToolCallStatus`, and `AgInterrupt` handle the interaction logic that's identical in every chat UI — role detection, input state, thread iteration, live tool call progress, approvals. All rendering is yours. Works with Tailwind, Vuetify, Quasar, or plain HTML.

**Backend-agnostic by design.** Switch backends without touching your frontend code.

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Composables](#composables)
  - [useAgent](#useagent)
    - [Error codes](#error-codes-errorcode)
    - [Multimodal messages](#multimodal-messages)
    - [Run identity](#run-identity)
    - [Page context](#page-context)
    - [Backend-specific run parameters](#backend-specific-run-parameters)
  - [useThreads](#usethreads)
  - [useFrontendTool](#usefrontendtool)
  - [useInterrupts](#useinterrupts)
  - [useGenerativeUI](#usegenerativeui)
  - [useAgentState](#useagentstate)
  - [useToolCalls](#usetoolcalls)
  - [useReasoning](#usereasoning)
  - [useActivities](#useactivities)
  - [useAgentEvent](#useagentevent)
- [Headless Components](#headless-components)
  - [AgMessageList](#agmessagelist)
  - [AgMessageInput](#agmessageinput)
  - [AgThreadList](#agthreadlist)
  - [AgToolCallStatus](#agtoolcallstatus)
  - [AgInterrupt](#aginterrupt)
- [Storage Adapters](#storage-adapters)
- [Backend Compatibility](#backend-compatibility)
- [Limitations](#limitations)
- [API Reference](#api-reference)
- [Development](#development)
- [License](#license)

## Install

```bash
npm install @and-effect/ag-ui-vue @ag-ui/client @ag-ui/core
```

The package is ESM-only and about 15 kB gzipped, not counting its peer dependencies.

### Peer dependencies

`vue`, `@ag-ui/client`, and `@ag-ui/core` are **peer dependencies** — install them in your app (they're not bundled).

| Peer            | Supported range        |
| --------------- | ---------------------- |
| `vue`           | `>=3.3.0`              |
| `@ag-ui/client` | `^1.0.0`               |
| `@ag-ui/core`   | `^1.0.0`               |

See the [playground](./examples) for a working page per feature — run it with `npm run dev:backend` and `npm run dev:playground`.

## Quick Start

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useAgent } from '@and-effect/ag-ui-vue'

const input = ref('')
const { messages, isRunning, error, send, abort } = useAgent({
  url: '/api/agent',
})

function handleSend() {
  send(input.value)
  input.value = ''
}
</script>

<template>
  <div v-for="msg in messages" :key="msg.id">
    <strong>{{ msg.role }}:</strong> {{ msg.content }}
  </div>

  <div v-if="error" style="color: red">{{ error }}</div>

  <input v-model="input" @keydown.enter="handleSend" :disabled="isRunning" />
  <button @click="handleSend" :disabled="isRunning">Send</button>
  <button v-if="isRunning" @click="abort">Stop</button>
</template>
```

Messages stream in reactively as the agent responds. That's the entire setup.

## Composables

### `useAgent`

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

#### Handling failed requests — `onError` (token refresh & retry)

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

#### Error codes — `errorCode`

`errorCode` holds a machine-readable code for `error` when the source provides one, so you can branch on a fixed value instead of the message text:

- A `RUN_ERROR` event's `code`, as set by your backend (e.g. a rate-limit code).
- `'abort'` for a run aborted mid-stream outside `abort()`, e.g. via `agent.abortRun()` on the raw agent. An abort before the response starts streaming is silent: `error` and `errorCode` both stay `null`.
- An `InterruptError`'s `code` for a queued run refused before it started.

It is `null` otherwise, including for network and HTTP errors (use `onError`'s `err.status` there) and for `useThreads` storage errors. Pressing Stop (`abort()`) is not an error: `error` and `errorCode` both stay `null`.

The type is `AgentErrorCode`, which autocompletes the values above. Backend codes and these share one string, so a backend that sends `'abort'` reads the same as a client-side abort.

#### Run outcome and token usage — `lastOutcome`, `usage`

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

#### Multimodal messages

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

#### Run identity

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

Grouping those runs into one logical exchange is deliberately left to you. AG-UI has a protocol-level key for it — [interrupts](https://docs.ag-ui.com/concepts/interrupts) correlate a paused run and its resumption via `Interrupt.id` — and ag-ui-vue relies on that rather than inventing a parallel notion of its own. [`useInterrupts`](#useinterrupts) handles the pause and the resume, but it does not group runs either: a resume run is just another run with its own `run_id`. To key on an exchange, join on `Interrupt.id` across runs for server-side pauses, or derive the key in your app from the user message that opened the exchange.

Attribution comes from what a run reports having produced when it completes, so a few things report `undefined` by design: messages added between runs (a locally-submitted tool result, say), messages hydrated without stored provenance, and a partial message left behind by a run that errored or was aborted mid-stream. Provenance for a streaming message therefore lands when its run finishes, not per token.

With [`useThreads`](#usethreads) the map is persisted as `PersistedThread.messageRuns` and restored on hydration, so a reloaded thread answers `runForMessage` identically to a live one.

#### Page context

`context` tells the agent what's around the conversation: the page the user is on, the item they have open, the filters they've set. It's sent as AG-UI's `RunAgentInput.context`, a list of `{ description, value }` entries the agent reads but never writes.

```ts
const pageContext = usePageContextStore()
const { send } = useAgent({
  url: '/api/agent',
  context: () => pageContext.entries, // e.g. [{ description: 'Application the user has open', value: application }]
})
```

The getter is re-read before **every** request: `send()`, the continuation after a [frontend tool](#usefrontendtool), an interrupt resume, and an `onError` retry. So a tool that changes what the user sees is reflected in the very next run, and the chat component never needs to know about pages. A per-run `send(content, { context })` is appended after these entries, for that request only. Entries aren't deduplicated.

A `value` can be a ref, a computed or a getter (e.g. from `storeToRefs()`); it is unwrapped per request. A string is then sent as is; anything else is JSON-serialised (the protocol's `value` is a string), so you can pass store objects directly, reactive or not. An entry whose `value` is `undefined` is left out, so "the current selection" can be listed unconditionally.

**Context, state or forwardedProps?**

| | Context | [State](#useagentstate) | [forwardedProps](#backend-specific-run-parameters) |
| --- | --- | --- | --- |
| Who reads it | The model | Agent and UI, both of which also write it | Your server code, as configuration |
| Lifetime | What the UI shows *now*, never persisted | Part of the conversation, persisted per thread by `useThreads` | Per request, never persisted |
| Shape | `{ description, value }` text for the model | A structured object the backend models | Whatever your backend expects |
| Use for | What's around the conversation (open page, selection, filters) | What user and agent work on together (a recipe, a canvas, a plan) | How the run is executed (model choice, temperature, tenant, a LangGraph `command`) |

Rule of thumb: if the model should read it, it's context. If agent and UI both read and write it and it belongs to the thread, it's state. If server-side code reads it as configuration, it's `forwardedProps`.

Putting "the open application" into state works, but it gets persisted with the thread (reopen it next week and it still claims you're viewing that application), and the agent can write it back.

**Backend.** Don't expect a backend to show `context` to the model by itself. LangGraph and Mastra make it available to your graph or agent (graph state, request context), but you still pass it on to the model; PydanticAI's `AGUIAdapter` drops it entirely. Since context isn't part of the transcript, put it next to the latest message rather than in the system prompt, or older messages can override it. See [`examples/backend/app/routers/page_context.py`](examples/backend/app/routers/page_context.py) for a PydanticAI version.

#### Backend-specific run parameters

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

> **Per-run props apply to one request, not one exchange.** A [frontend tool](#usefrontendtool) turns a single `send()` into a round-trip, and the second hop is a separate AG-UI run that the tool coordinator issues with the registered tools alone — so a `forwardedProps` (or `context`, or `subscriber`) passed to `send()` is not repeated on it. That's deliberate: re-sending a one-shot parameter like a LangGraph `command` on the continuation would be wrong more often than right. Anything that must hold for *every* hop goes on `useAgent` itself, where it's re-resolved fresh per request.

### `useThreads`

Manages a collection of persisted conversations on top of an **injected** agent. You construct the agent with `useAgent`; the threads layer swaps conversation contents on that one stable instance when you switch — so tools, events, and middleware wired to the agent keep working across switches. See [Storage Adapters](#storage-adapters) for persistence options.

```vue
<script setup lang="ts">
import { useAgent, useThreads, LocalStorageAdapter } from '@and-effect/ag-ui-vue'

// Construct the agent once — this is where url / headers / onError live.
const agent = useAgent({ url: '/api/agent' })

const {
  threads,         // Ref<ThreadMeta[]> — list for a sidebar
  activeThreadId,
  messages,        // ComputedRef — from the active thread
  isRunning,
  send, abort,
  createThread,    // (id?) => Promise<string> — creates, persists, switches; returns ID
  switchThread,
  deleteThread,
  updateTitle,
} = useThreads(agent, {
  adapter: new LocalStorageAdapter('my-app'),
})
</script>

<template>
  <aside>
    <button @click="createThread()">+ New</button>
    <button
      v-for="t in threads"
      :key="t.id"
      @click="switchThread(t.id)"
      :class="{ active: t.id === activeThreadId }"
    >{{ t.title ?? 'New conversation' }}</button>
  </aside>

  <main>
    <div v-for="msg in messages" :key="msg.id">...</div>
    <input @keydown.enter="send($event.target.value)" :disabled="isRunning" />
  </main>
</template>
```

Threads are persisted after every completed run. Titles are auto-generated from the first user message. See [`examples/playground/src/views/ThreadsView.vue`](examples/playground/src/views/ThreadsView.vue) for a full sidebar demo with inline title editing, delete buttons, and timestamps.

`url`, `headers`, and `onError` are configured on the `useAgent` call — pass a `headers` getter for a token that refreshes mid-session, and an `onError` hook to recover a failed run (e.g. `401` → refresh → `{ retry: true }`). See [`useAgent`](#useagent) and [Handling failed requests](#handling-failed-requests--onerror-token-refresh--retry).

```ts
const token = ref('…')
const agent = useAgent({
  url: () => `/api/agent/${activeProjectId.value}`,
  headers: () => ({ Authorization: `Bearer ${token.value}` }),
  onError: async (err) => {
    if (err.status === 401) { await refreshSession(); return { retry: true } }
  },
})
useThreads(agent, { adapter: new LocalStorageAdapter('my-app') })
```

> **`threadId` is owned by the threads layer.** Don't also pass a reactive `threadId` to the backing `useAgent` — switching sets `agent.threadId` directly.

Wire tools, shared state, or custom events to the **same** `agent` and they keep working across thread switches (the instance is never recreated):

```ts
const agent = useAgent({ url: '/api/agent' })
useFrontendTool(agent, { /* … */ })      // still fires after switchThread()
useGenerativeUI(agent, { /* … */ })
const { switchThread } = useThreads(agent, { adapter: new LocalStorageAdapter('my-app') })
```

The mental model: tools, events, and state subscriptions travel with the agent — declare them once, they survive every switch. Conversation control (`send`, `threadId`, the message/state lifecycle) moves under `useThreads`.

### `useFrontendTool`

Agents can call functions in the browser. Two patterns:

**Automatic execution** — provide a handler and the tool runs immediately.

Pass a [Standard Schema](https://standardschema.dev/) (Zod 4+, ArkType 2+) as `parameters` for automatic type inference and runtime validation. The handler's first argument is fully typed — no explicit generic needed:

```ts
import { z } from 'zod'

const darkMode = useFrontendTool(agentCtx, {
  name: 'setDarkMode',
  description: 'Toggle dark/light theme',
  parameters: z.object({ enabled: z.boolean() }),  // args inferred as { enabled: boolean }
  handler: async ({ enabled }, { signal }) => {     // signal aborts if the agent is stopped
    isDarkMode.value = enabled
    return { success: true }
  },
  followUp: false,  // skip the follow-up LLM turn — this is a pure side-effect
})

// Declaring the tool is enough — it auto-registers, so a bare send() advertises it.
send('Enable dark mode')
```

Raw JSON Schema is still accepted for backward compatibility — `args` becomes `any`:

```ts
const darkMode = useFrontendTool(agentCtx, {
  name: 'setDarkMode',
  description: 'Toggle dark/light theme',
  parameters: {
    type: 'object',
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
  },
  handler: async (args) => {
    isDarkMode.value = args.enabled
    return { success: true }
  },
})
```

The handler receives a second argument `{ toolCallId, signal }`. `signal` is wired to the agent's abort — if the user calls `abort()` while the handler is awaiting, the signal fires so async work (fetch, timers) can be cancelled.

`followUp` (default `true`) controls whether the agent gets a follow-up LLM turn after the tool result is submitted. Pure side-effect tools (dark mode toggle, UI state change) set `followUp: false` to skip the redundant turn. If the handler throws, a follow-up is always forced regardless of `followUp`, so the model can self-correct.

Args are validated against the schema before the handler is called. Validation failures submit a structured error result to the agent (so it can retry with corrected args) — the handler is never invoked with invalid data.

**Human-in-the-loop** — omit the handler and the tool waits for user approval:

```ts
const confirm = useFrontendTool(agentCtx, {
  name: 'confirmAction',
  description: 'Request user confirmation before performing an action',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['action', 'description'],
  },
})
```

```html
<div v-if="confirm.pending.value">
  <p>{{ confirm.pending.value.args.description }}</p>
  <button @click="confirm.resolve({ approved: true })">Approve</button>
  <button @click="confirm.reject('Declined')">Decline</button>
</div>
```

Multiple tools need no wiring — each auto-registers with the agent, and the shared coordinator batches every frontend result from a turn into a single follow-up run. Set `enabled: false` to drop a tool from what's advertised. Per invocation, `calls` exposes independent state (`streaming-args` → `executing`/`pending` → `complete`/`error`), so parallel calls don't clobber each other and each pending HITL call carries its own `respond`/`reject`:

```ts
const t = useFrontendTool(agentCtx, { name: 'a', /* … */ })
// t.calls.value[i] — per-call status, streamed args, and (while pending) respond/reject
// t.clear() — drop tracked calls (calls only grows otherwise)
```

### `useInterrupts`

Human in the loop for tools that live **on the server**. When a backend needs approval, an edit or an answer before it continues, the run ends with an AG-UI [interrupt](https://docs.ag-ui.com/concepts/interrupts) (`RUN_FINISHED.outcome = interrupt`) and the thread pauses until a new run answers it via `RunAgentInput.resume`. `useInterrupts` lists the open interrupts, lets you answer each one, and sends the resume:

```ts
const agentCtx = useAgent({ url: '/api/agent' })
const { interrupts, hasPending, canResume, resumeAll } = useInterrupts(agentCtx)
```

```html
<div v-for="i in interrupts" :key="i.id">
  <p>{{ i.message }}</p>
  <button @click="i.resolve({ approved: true })">Approve</button>
  <button @click="i.resolve({ approved: false, reason: 'Not now' })">Deny</button>
</div>
<button :disabled="!canResume" @click="resumeAll()">Continue</button>
```

- **Answers are staged, then sent together.** The protocol requires one resume that answers *every* open interrupt, so `resolve(payload)` / `cancel()` only record the answer for that interrupt (and can be changed until you resume). `resumeAll()` sends them all in one new run. `canResume` turns true once every interrupt has an answer. `resumeAll()` rejects with `code: 'run-in-flight'` while a run is in progress, so a double-click on Continue doesn't send the answers twice. `resolve()` / `cancel()` / `cancelAll()` reject the same way: answers are frozen while the resume run is in flight.
- **The payload is whatever the interrupt's `responseSchema` describes.** For a PydanticAI tool approval that is `{ approved, editedArgs?, reason? }`. `canEditArgs` is true when the schema declares `editedArgs`, so you can show an edit form: `resolve({ approved: true, editedArgs: { … } })` runs the tool with your arguments instead of the model's.
- **Tool approvals are answered by the server.** A `tool_call` interrupt carries the `toolCallId` of a server tool call that is already in `messages`; read its arguments from there (or from `useToolCalls` while it streams). After the resume the *server* runs the tool and emits its result. The client sends only the decision, never a tool message.
- **While paused, a plain run is refused.** `send()` / `continueRun()` without a `resume` covering every open interrupt reject with an `InterruptError` (`code: 'interrupts-pending'`) before any request is made, so it never reaches `onError`. `send(text, { resume })` is allowed if you want to answer and add a message at once.
- **Expiry.** An interrupt whose `expiresAt` has passed can only be cancelled: `resolve()` rejects with `code: 'interrupt-expired'`. Nothing is cancelled for you, so show the deadline and let the user dismiss it.
- **Unknown reasons are not errors.** `reason` is an open string. Render anything you don't recognise from `message`, `responseSchema` and `metadata`, or offer `cancel()`.
- **Threads.** `useThreads` saves the open interrupts with the thread, so a paused thread can still be resumed after a reload, and switching to another thread is never blocked by it.

**Validating payloads.** No JSON Schema validator ships with ag-ui-vue. To check answers against `responseSchema` before they are staged, plug in the one you use. A rejected payload makes `resolve()` reject with `code: 'payload-invalid'` and the `issues` you returned:

```ts
import { Validator } from '@cfworker/json-schema'

useAgent({
  url: '/api/agent',
  validateResumePayload: (schema, payload) =>
    new Validator(schema).validate(payload).errors.map((e) => e.error),
})
```

Without a validator the server decides. PydanticAI, for one, treats any approval payload that fails its own validation as a denial.

**Interrupts vs. HITL frontend tools.** A frontend tool without a handler (`useFrontendTool`) is a tool *you execute*: its answer goes back as a tool result. An interrupt is a step you *authorize the server to take*: your answer goes back on the next run's `resume`. They are separate mechanisms, but both `FrontendToolCall` and `AgentInterrupt` implement `PendingDecision` (`kind`, `id`, `status`, `message?`, `responseSchema?`), so one approvals list can render both.

The two can also arrive together. If the model calls a HITL frontend tool and a server tool that needs approval in the same step, the run pauses with the frontend call still open. Its card stays answerable, and its result is sent with the resume run. Until it is answered, `canResume` stays false, and any run carrying a `resume` (`resumeAll()`, or a hand-built `send`/`continueRun`) rejects with `code: 'frontend-calls-pending'`, because resuming without it would leave the tool call unanswered in the transcript.

### `useGenerativeUI`

Maps tool names to Vue components and renders them as the agent calls those tools. The composable tracks the tool call lifecycle, streams parsed args into props, and auto-registers its tools with the agent — so a bare `send()` advertises them, with nothing to wire up.

```ts
import { useAgent, useGenerativeUI } from '@and-effect/ag-ui-vue'
import WeatherCard from './WeatherCard.vue'
import RecipeCard from './RecipeCard.vue'
import RecipeSkeleton from './RecipeSkeleton.vue'

const agentCtx = useAgent({ url: '/api/agent' })

const { activeComponents, allComponents } = useGenerativeUI(agentCtx, {
  // Minimal: just a component — description and parameters are auto-filled
  show_weather: WeatherCard,

  // Full: component + tool metadata + optional loading state
  show_recipe: {
    component: RecipeCard,
    loading: RecipeSkeleton,          // shown while args are still streaming
    description: 'Display a recipe',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        ingredients: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
})

// Tools are auto-registered — no need to pass them
agentCtx.send('Show me a pasta recipe')
```

Each item in `activeComponents` (or `allComponents`) is a resolved `ActiveGenUI` object:

```vue
<div v-for="item in allComponents" :key="item.id">
  <component :is="item.component" v-bind="item.props" />
</div>
```

Use `activeComponents` to show only in-flight renders (streaming or awaiting result). Use `allComponents` to keep components visible after the tool call completes — the typical pattern for persistent in-chat widgets.

The `loading` component (if configured) is shown while `item.isStreaming` is true and replaced by the main component once args finish streaming.

By default GenUI items persist across runs (`autoClear: false`). Pass `{ autoClear: true }` to clear them when the next run starts.

### `useAgentState`

Bidirectional JSON state synced via `STATE_SNAPSHOT` and `STATE_DELTA` events. Updates live as the agent streams.

`state` is a writable `reactive()` object — mutate it directly (even deeply, or via `v-model`) and a deep watcher syncs the change to `agent.state`, so it is sent in `RunAgentInput.state` on the next run. There is no `setState`; mutation is the sync mechanism.

```ts
interface RecipeState {
  recipe: { title: string; ingredients: string[]; instructions: string[] } | null
}

const { agent, send, isRunning } = useAgent({ url: '/api/agent' })
const { state } = useAgentState<RecipeState>(agent, {
  initialState: { recipe: null },
})

// Write from the frontend by mutating directly — the change syncs to the agent
state.recipe = null
state.recipe?.ingredients.push('guanciale')
```

```html
<div v-if="state.recipe">
  <h2>{{ state.recipe.title }}</h2>
  <ul><li v-for="step in state.recipe.instructions" :key="step">{{ step }}</li></ul>
</div>
<input v-model="state.recipe.title" />
<button @click="send('Generate a pasta recipe')" :disabled="isRunning">Generate</button>
```

### `useToolCalls`

Optional observability composable for showing live tool execution progress. Not required for tool execution — `useFrontendTool` handles that. Pair with `AgToolCallStatus` to render without manual branching:

```ts
const { activeToolCalls } = useToolCalls(agent)
```

```vue
<AgToolCallStatus :tool-calls="activeToolCalls">
  <template #running="{ name }">⚙️ {{ name }}…</template>
  <template #completed="{ name, duration }">✅ {{ name }} ({{ duration }}ms)</template>
</AgToolCallStatus>
```

### `useReasoning`

A live view of the agent's reasoning while the run is still going (AG-UI 1.0's `REASONING_*` events). The protocol has two separate things: **spans** (`REASONING_START` / `END`, "the agent is thinking") and **reasoning messages** (the streamed text). A reasoning message does not have to sit inside a span, so both are tracked:

```ts
const { agent, messages } = useAgent({ url: '/api/agent' })
const { isReasoning, getReasoning } = useReasoning(agent)
```

```vue
<AgMessageList :messages="messages">
  <template #reasoning="{ msg, content }">
    <details :open="getReasoning(msg.id)?.status === 'streaming'">
      <summary>{{ getReasoning(msg.id)?.status === 'streaming' ? 'Thinking…' : 'Reasoning' }}</summary>
      {{ content }}
    </details>
  </template>
</AgMessageList>
<p v-if="isReasoning">Thinking…</p>
```

**Render the text in one place.** The client streams reasoning into the message in `messages`, so the `#reasoning` slot is already live. Use `getReasoning(msg.id)` there for status and timing. Render the text from `reasoningMessages` instead only if you leave out `#reasoning`; with both, it shows twice while it streams.

Entries belong to the current run (`autoClear`, default `true`). An entry still open when its run ends (an error, `abort()`, the next run starting) gets status `error`, so a thinking indicator never sticks. A settled entry whose message leaves the conversation (thread switch, `reset()`) is dropped.

### `useActivities`

A live view of the agent's activities (`ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`): structured progress such as "checked 3 of 4 registers". Each entry is the activity message itself, with `activityType` to branch on and `content` as an object with every snapshot and patch applied.

```ts
const { agent, isRunning } = useAgent({ url: '/api/agent' })
const { activityList } = useActivities(agent)
```

```vue
<template v-if="isRunning">
  <div v-for="a in activityList" :key="a.id">
    <span v-if="a.activityType === 'records-search'">Checked {{ a.content.checked }} of {{ a.content.total }}</span>
  </div>
</template>
```

The client applies snapshots (`replace` included) and JSON Patch deltas to the message in `messages`. This composable indexes those messages rather than applying anything itself, so it always matches what `#activity` shows. Activity messages are also persisted by `useThreads`. The client never sends them back to the server.

### `useAgentEvent`

Low-level event subscription with automatic cleanup on scope dispose.

```ts
const { agent } = useAgent({ url: '/api/agent' })

useAgentEvent(agent, {
  onToolCallStartEvent({ event }) {
    console.log('Tool called:', event.toolCallName)
  },
  onCustomEvent({ event }) {
    // Handle custom backend events
  },
})
```

## Headless Components

Five renderless components ship with the library. They have no HTML output — all rendering is done by your template through scoped slots.

```ts
import { AgMessageList, AgMessageInput, AgThreadList, AgToolCallStatus, AgInterrupt } from '@and-effect/ag-ui-vue'
```

### `AgMessageList`

Per-type named slots — no `v-if` branching, no type casts:

```vue
<AgMessageList :messages="messages" :streaming-content="streamingContent">
  <template #user="{ content }">
    <div class="text-right">{{ content }}</div>
  </template>
  <template #assistant="{ content }">
    <div>{{ content }}</div>
  </template>
  <template #assistant-tool-calls="{ toolCalls }">
    <div v-for="tc in toolCalls" :key="tc.id">🔧 {{ tc.function.name }}</div>
  </template>
  <template #tool-result="{ content }">✅ {{ content }}</template>
  <template #streaming="{ content }">{{ content }}<span class="cursor" /></template>
  <template #empty>Start a conversation…</template>
</AgMessageList>
```

The streaming cursor is yours to render too. With Tailwind, for example:

```vue
<template #streaming="{ content }">{{ content }}<span class="inline-block w-2 h-4 bg-current animate-pulse" /></template>
```

| Slot | Props |
|---|---|
| `#user` | `msg, content, index` |
| `#assistant` | `msg, content, index` |
| `#assistant-tool-calls` | `msg, toolCalls, index` |
| `#tool-result` | `msg, content, toolCallId, index` |
| `#system` | `msg, content, index` |
| `#developer` | `msg, content, index` |
| `#reasoning` | `msg, content, index` |
| `#activity` | `msg, index` |
| `#message` (fallback) | `msg, type, content, toolCalls, toolCallId, index` |
| `#streaming` | `content` |
| `#empty` | — |

`#reasoning` and `#activity` cover the two message kinds AG-UI 1.0 added: the model's own working (the `REASONING_*` family that replaced `THINKING_*`) and structured progress (`ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`). Neither is an assistant answer, so **neither renders unless you provide its slot** — reasoning is opt-in rather than silently shown as the reply. An activity message's content is an object, so the string-only `content` prop is `undefined` for it; read `msg.content`. Both update live while the run streams. Pair `#reasoning` with [`useReasoning`](#usereasoning) for streaming status.

A tool result may also be multimodal in 1.0 (`ContentPart[]`). `#tool-result`'s `content` is then the flattened text — the same as `ReactiveToolCall.result` — so `{{ content }}` keeps working; read `msg.content` for the media parts.

### `AgMessageInput`

Manages the input value, submit/abort, and file attachments:

```vue
<AgMessageInput :is-running="isRunning" @send="send" @abort="abort">
  <template #default="{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, attachments, isRunning: running, canSend }">
    <form @submit.prevent="onSubmit">
      <!-- Attachment strip -->
      <div v-for="(att, i) in attachments" :key="i">
        <img v-if="att.type === 'image'" :src="`data:${att.source.mimeType};base64,${att.source.value}`" :alt="att.metadata?.filename || 'Attached image'" />
        <span v-else>📄 {{ att.metadata?.filename ?? att.source.mimeType }}</span>
        <button type="button" @click="onRemoveAttachment(i)">✕</button>
      </div>

      <input :value="value" @input="onInput" :disabled="running" placeholder="Type a message…" />

      <!-- File picker — calls onAttach(file) to read and queue the attachment -->
      <label>
        <input type="file" class="hidden" accept="image/*,audio/*,video/*,.pdf" @change="e => onAttach(e.target.files[0])" />
        📎
      </label>

      <button v-if="!running" type="submit" :disabled="!canSend">Send</button>
      <button v-else type="button" @click="onAbort">Stop</button>
    </form>
  </template>
</AgMessageInput>
```

`onAttach(file)` reads the file as base64 and adds the appropriate `ContentPart` to the internal attachment list — `ImagePart` for `image/*`, `AudioPart` for `audio/*`, `VideoPart` for `video/*`, and `DocumentPart` for everything else. Every part carries the file's name in `metadata.filename`, so you can show it or use it in an `alt` text or accessible label. The name is sent to your backend along with the file. A file name can contain personal details, so if you don't want that, drop `metadata` from the parts in your `@send` handler before calling `send()`. `onRemoveAttachment(index)` removes the item at that index. On submit, text and attachments are merged into `ContentPart[]` automatically; a text-only message still emits a plain `string` for backward compatibility.

Props: `isRunning` (required) · `disabled` (optional) · `modelValue` (optional, v-model) · `attachments` (optional, controlled mode)
Events: `send(content: string | ContentPart[])` · `abort()` · `update:modelValue` · `update:attachments`
Slot: `{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, attachments, isRunning, canSend }`

### `AgThreadList`

Iterates threads with per-item state and handlers:

```vue
<AgThreadList :threads="threads" :active-thread-id="activeThreadId" @switch="switchThread" @delete="deleteThread">
  <template #thread="{ thread, isActive, onSwitch, onDelete }">
    <button @click="onSwitch" :class="{ active: isActive }">
      {{ thread.title ?? 'New conversation' }}
      <span @click.stop="onDelete">✕</span>
    </button>
  </template>
  <template #empty>No threads yet</template>
</AgThreadList>
```

Slots: `#thread="{ thread, isActive, onSwitch, onDelete }"` · `#empty`
Events: `switch(id)` · `delete(id)`

### `AgToolCallStatus`

Per-status named slots for live tool execution progress:

```vue
<AgToolCallStatus :tool-calls="activeToolCalls">
  <template #running="{ name, parsedArgs }">
    <div>⚙️ {{ name }}… <pre v-if="parsedArgs">{{ parsedArgs }}</pre></div>
  </template>
  <template #awaiting-result="{ name }">
    <div>⏳ {{ name }} — waiting for result…</div>
  </template>
  <template #completed="{ name, duration }">
    <div>✅ {{ name }} ({{ duration }}ms)</div>
  </template>
  <template #error="{ name }">
    <div>❌ {{ name }}</div>
  </template>
</AgToolCallStatus>
```

| Slot | Props |
|---|---|
| `#running` | `toolCall, name, args, parsedArgs, index` |
| `#awaiting-result` | `toolCall, name, args, parsedArgs, index` |
| `#completed` | `toolCall, name, result, duration, index` |
| `#error` | `toolCall, name, duration, index` |
| `#tool-call` (fallback) | `toolCall, status, name, args, parsedArgs, result, duration, startedAt, completedAt, index` |
| `#empty` | — |

### `AgInterrupt`

Renders the open [interrupts](#useinterrupts) one slot per interrupt, routed by `reason`, plus a `#resume` slot for the Continue control:

```vue
<AgInterrupt :agent="agentCtx">
  <template #tool_call="{ interrupt, args, toolName, resolve, cancel }">
    <ApprovalCard :title="interrupt.message ?? toolName" :args="args" :status="interrupt.status"
      @approve="resolve({ approved: true })" @reject="cancel()" />
  </template>
  <template #input_required="{ interrupt, resolve }">
    <SchemaForm :schema="interrupt.responseSchema" @submit="resolve" />
  </template>
  <!-- any reason without its own slot -->
  <template #default="{ interrupt, resolve, cancel }">…</template>
  <template #resume="{ canResume, resumeAll }">
    <button :disabled="!canResume" @click="resumeAll()">Continue</button>
  </template>
</AgInterrupt>
```

| Slot | Props |
|---|---|
| `#<reason>` / `#default` (fallback) | `interrupt, args, toolName, resolve, cancel` |
| `#resume` (only while paused) | `canResume, resumeAll, cancelAll` |

`agent` is the `useAgent` return value. For a `tool_call` interrupt, `args` and `toolName` come from the server tool call it points at in `messages`. It works the same way as `useInterrupts`: an answered interrupt stays in the list, with its answer in `interrupt.status` / `interrupt.payload`, and can be changed until `resumeAll()` sends them all. `default` and `resume` are reserved slot names.

## Storage Adapters

Two adapters ship with the library:

| Adapter | Description |
|---|---|
| `LocalStorageAdapter` | Persists to `localStorage` under a configurable namespace key. Suitable for most apps. |
| `MemoryAdapter` | In-memory only. Use for testing or SSR environments where `localStorage` is unavailable. |

```ts
import { LocalStorageAdapter, MemoryAdapter } from '@and-effect/ag-ui-vue'

const adapter = new LocalStorageAdapter('my-app')  // namespace-isolated
const adapter = new MemoryAdapter()                 // no persistence
```

Implement the `ThreadStorageAdapter` interface to plug in IndexedDB, a REST API, or a database. **All methods are async**, so a real database backend fits the same contract as the built-in adapters:

```ts
interface ThreadStorageAdapter {
  /** Metadata for every thread, for listing. Cheap — no messages/state. */
  listThreads(): Promise<ThreadMeta[]>
  /** Full payload for one thread, or null if it does not exist. */
  load(threadId: string): Promise<PersistedThread | null>
  save(thread: PersistedThread): Promise<void>
  delete(threadId: string): Promise<void>
}

interface PersistedThread {
  meta: ThreadMeta
  messages: Message[]
  state: unknown
  /** Message id → run id, so a reloaded thread answers `runForMessage`. Optional. */
  messageRuns?: Record<string, string>
}
```

The read path is split deliberately: `listThreads()` returns metadata only (maps to `SELECT id, title, timestamps`) for rendering the thread list, while `load(id)` fetches a single thread's full transcript + state for hydration. A database adapter should never pull every conversation into memory just to render a sidebar.

**Consumer contract** — a custom adapter must honor three things:

1. **Deserialize fully.** `listThreads()` / `load()` must resolve with real `Date` objects on `meta.createdAt` / `meta.updatedAt` — the thread sort relies on it. (`LocalStorageAdapter` revives `new Date(...)` from JSON; a DB consumer does the equivalent.)
2. **`save()` receives a plain object.** `useThread` JSON-strips `state` before saving, so no Vue proxies reach the adapter — no special handling needed.
3. **Reject freely.** Methods may reject; the thread layer reports the failure on the thread's `error` and stays usable (a failed `load()` leaves the thread on its default state rather than hanging on `isLoading`) — it never wedges.

**Supplying thread IDs.** By default `useThreads` generates IDs (`thread_<ts>_<rand>`). A backend that needs a different format — e.g. a database whose primary key is a UUID — can take over ID generation instead of maintaining a `thread_xxx → UUID` lookup table.

`idFactory: () => string` sets the policy for **every** new thread, including the ones the manager creates itself. A per-call `createThread(id)` argument takes precedence over it.

```ts
// Every thread the manager creates is a UUID — matches the DB primary key,
// so the adapter can save/load by id directly with no translation layer.
const { createThread } = useThreads(agent, {
  adapter: new MyDatabaseAdapter(),
  idFactory: () => crypto.randomUUID(),
})

// Most of the time you let the policy generate the id:
const id = await createThread() // -> "f47ac10b-58cc-4372-a567-0e02b2c3d479"

// Pass an id to use it verbatim — e.g. resuming a conversation the server
// already created, or deep-linking to /chat/:id. Overrides idFactory.
await createThread(route.params.id)
```

Omitting both `idFactory` and the per-call argument keeps the built-in `thread_<ts>_<rand>` default (non-breaking).

Hydration is **construct-then-hydrate**: the thread is built synchronously, then the persisted state is loaded asynchronously and applied by mutation. `send()` / `continueRun()` await this internally, so a run always sees the loaded state — never the empty default. Observe `isLoading` for the in-flight window.

> Conflict resolution for concurrent edits to the same thread from multiple clients is out of scope; the last write wins.

## Backend Compatibility

Works with any AG-UI compatible backend:

- [PydanticAI](https://ai.pydantic.dev/ui/ag-ui/) via `AGUIAdapter`
- [LangGraph](https://langchain-ai.github.io/langgraph/) — first-party AG-UI support
- [Mastra](https://mastra.ai/) via `@ag-ui/mastra`
- [CrewAI](https://www.crewai.com/) — first-party AG-UI support
- Any server emitting AG-UI SSE events

## Limitations

- **Interrupts: structured lifecycle only.** `useInterrupts` handles AG-UI 1.0's `RUN_FINISHED.outcome` / `resume` lifecycle. It does not handle the legacy LangGraph `on_interrupt` custom event or `command.resume`. Agent capabilities (`humanInTheLoop.interrupts` / `approveWithEdits`) are not read either: affordances come from each interrupt's `responseSchema`.
- **One live conversation at a time.** Switching threads aborts the outgoing run; inactive threads don't keep background runs alive, and switching back re-attaches to the persisted transcript, not a still-streaming run.

## API Reference

> **Reference section.** If you're getting started, the [Composables](#composables) and [Headless Components](#headless-components) sections have what you need. Come here for exact types, defaults, and the complete return interface.

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

### `useThreads(agent, options?)`

```ts
const agent = useAgent({ url: '/api/agent' })

const {
  threads,          // DeepReadonly<Ref<ThreadMeta[]>>
  activeThreadId,   // Readonly<Ref<string | null>>
  activeThread,     // ComputedRef<DeepReadonly<ThreadMeta> | null> — the open thread, whatever its list position

  // Re-exported from the active thread (ComputedRef):
  messages, isRunning, error, errorCode, lastOutcome, usage, streamingContent, state,
  send, continueRun, abort, reset,

  // Run provenance, persisted and restored across switches — see Run identity:
  messageRuns,      // Readonly<Ref<ReadonlyMap<string, string>>>
  runForMessage,    // (messageId: string) => string | undefined

  // Thread management:
  createThread,     // (id?: string) => Promise<string> — supply an id, or omit to generate one
  switchThread,     // (id: string) => void
  deleteThread,     // (id: string) => Promise<void>
  updateTitle,      // (id: string, title: string) => Promise<void>
  refresh,          // () => Promise<void> — re-read the list from the adapter
} = useThreads(agent, {
  adapter: new LocalStorageAdapter('my-app'),   // Optional, defaults to LocalStorageAdapter()
  autoTitle: true,                              // Optional, default true
  initialState: { ... },                        // Optional — default state for new threads
  saveDebounceMs: 500,                          // Optional, default 500
  initialThreadId: 'thread_123',                // Optional — restore specific thread on init
  idFactory: () => crypto.randomUUID(),         // Optional — ID policy for all new threads
})
```

The first argument is the return value of [`useAgent`](#useagent) — configure `url` / `headers` / `onError` there. The threads layer owns `threadId`; don't also pass a reactive `threadId` to that `useAgent`.

`ThreadMeta` shape:

```ts
interface ThreadMeta {
  id: string
  title: string | null   // null until the first message is sent or updateTitle is called
  createdAt: Date
  updatedAt: Date        // last activity: advances when messages or state change, not on visits or renames
}
```

`threads` is sorted by `updatedAt` (last activity), newest first. Opening or renaming a thread doesn't change it. Use `activeThread` for the open conversation, not `threads[0]`.

`refresh()` re-reads `listThreads()`, for example to show a title your server generated after the first send, or threads created on another device. The adapter's titles win, including on the open thread, so its next save keeps the server's title. `updatedAt` never moves back. The open thread stays listed even if the adapter no longer lists it.

### `useThread(agent, options)`

Single-thread composable with persistence, built on the same injected agent. Used internally by `useThreads` but works standalone. Cleanup is automatic on scope teardown (a final save flushes on unmount).

```ts
const agent = useAgent({ url: '/api/agent' })

const thread = useThread(agent, {
  id: 'thread_123',                            // string | null (null = no active thread)
  adapter: new LocalStorageAdapter('my-app'),
  autoTitle: true,
  initialState: { ... },
  saveDebounceMs: 500,
})

thread.meta            // DeepReadonly<Ref<ThreadMeta | null>>
thread.state           // T — writable reactive() object; mutate it to sync
thread.updateTitle     // (title: string) => Promise<void>
thread.adoptMeta       // (meta: ThreadMeta) => ThreadMeta | null — take meta read back from the adapter
thread.load            // (id: string | null, opts?) => Promise<void> — switch on the same agent
thread.messageRuns     // Readonly<Ref<ReadonlyMap<string, string>>>
thread.runForMessage   // (messageId: string) => string | undefined
```

### `useFrontendTool(agentContext, options)`

```ts
const {
  tool,          // Tool — auto-registered; rarely needed directly
  isAutomatic,   // boolean — true if handler was provided
  calls,         // DeepReadonly<Ref<FrontendToolCall[]>> — per-call state, in arrival order
  isExecuting,   // Readonly<Ref<boolean>> — derived
  lastResult,    // Readonly<Ref<any>> — derived
  lastError,     // Readonly<Ref<Error | null>> — derived
  pending,       // Readonly<Ref<PendingToolCall | null>> — derived, oldest pending HITL call
  resolve,       // (result) => Promise<void> — derived, answers oldest pending
  reject,        // (reason?) => Promise<void> — derived, answers oldest pending
  enabled,       // Ref<boolean> — toggle at runtime (false drops it from advertised tools)
  clear,         // () => void — drop tracked calls
  dispose,       // () => void — manual cleanup
} = useFrontendTool(agentCtx, {
  name: 'myTool',
  description: '...',
  parameters: schema,                             // Standard Schema (Zod/ArkType) or raw JSON Schema object
  handler: async (args, { toolCallId, signal }) => { ... },  // Optional — omit for HITL
  followUp: true,                                 // Optional, default true — set false to skip follow-up LLM turn
  enabled: true,                                  // Optional, default true — boolean | ref | getter
})
```

`parameters` accepts either a [Standard Schema](https://standardschema.dev/) (Zod 4+, ArkType 2+) or a raw JSON Schema object. With a Standard Schema, handler args are fully typed (no explicit generic needed) and validated at runtime before the handler is called — validation failures submit a structured error result to the agent instead of invoking the handler.

The handler's second argument `{ toolCallId, signal }` provides the call ID and an `AbortSignal` wired to the agent's abort — pass `signal` to `fetch` or other async work so user-initiated stops cancel in-flight operations.

`followUp` (default `true`) determines whether a follow-up LLM turn fires after the tool result is submitted. Set `false` for pure side-effect tools. Handler errors and validation errors always force a follow-up regardless, so the model can self-correct.

Each `FrontendToolCall` carries `{ id, status, args, result?, error?, respond?, reject? }` — `respond`/`reject` are present only while `status === 'pending'`, so any pending call is resolvable directly (not just the oldest).

### `useInterrupts(agentContext)`

```ts
const {
  interrupts,   // ComputedRef<AgentInterrupt[]> — open interrupts, in the order the run reported them
  hasPending,   // ComputedRef<boolean> — the thread is paused
  canResume,    // ComputedRef<boolean> — every interrupt and pending frontend tool call answered, no run in flight
  resumeAll,    // (runOptions?) => Promise<void> — send every answer as one resume[]
  cancelAll,    // () => Promise<void> — answer every interrupt with `cancelled`
} = useInterrupts(agentCtx)

interface AgentInterrupt extends PendingDecision {
  kind: 'interrupt'
  id: string
  reason: string                    // 'tool_call' | 'input_required' | 'confirmation' | any string
  status: 'pending' | 'resolved' | 'cancelled'
  message?: string
  toolCallId?: string               // for tool approvals: the server tool call awaiting it
  responseSchema?: JsonSchema
  canEditArgs: boolean              // responseSchema declares editedArgs
  expiresAt?: string
  metadata?: Record<string, unknown>
  payload?: unknown                 // the staged answer
  raw: Interrupt                    // as the protocol delivered it
  resolve: (payload?) => Promise<void>  // rejects 'run-in-flight' while a run is in progress
  cancel: () => Promise<void>           // likewise
}
```

`InterruptError` (`code`: `'interrupts-pending' | 'resume-incomplete' | 'interrupt-unknown' | 'interrupt-expired' | 'payload-invalid' | 'run-in-flight' | 'frontend-calls-pending'`, plus `interruptIds` and `issues`) is thrown before any request is made.

### `useGenerativeUI(agentContext, registry, options?)`

```ts
const {
  activeComponents,  // ComputedRef<ActiveGenUI[]> — in-flight renders only
  allComponents,     // ComputedRef<ActiveGenUI[]> — includes completed
  tools,             // Tool[] — auto-registered; returned only as an escape hatch
  resolve,           // (toolName: string) => Component | null
  getProps,          // (tc: ReactiveToolCall) => Record<string, any>
  clear,             // () => void
} = useGenerativeUI(agentCtx, registry, {
  autoClear: false,  // Optional, default false
})
```

Each `ActiveGenUI` item:

```ts
interface ActiveGenUI {
  id: string           // Tool call ID — use as :key in v-for
  name: string         // Tool name
  component: Component // Main component (or loading component while isStreaming)
  props: Record<string, any>  // Parsed tool call args
  isStreaming: boolean // True while args are still arriving
  status: ToolCallStatus      // 'running' | 'awaiting_result' | 'completed' | 'error'
}
```

Registry entries can be a bare component or a full `GenUIEntry`:

```ts
interface GenUIEntry {
  component: Component   // Required
  description?: string   // Tool description sent to the agent
  parameters?: any       // JSON Schema — sent to the agent
  loading?: Component    // Shown while args stream; falls back to component
}
```

### `useToolCalls(agent, options?)`

```ts
const {
  activeToolCalls,     // ComputedRef<ReactiveToolCall[]>
  completedToolCalls,  // ComputedRef<ReactiveToolCall[]>
  getToolCall,         // (id) => ReactiveToolCall | undefined
  getToolResult,       // (toolCallId, messages) => Message | undefined
  markCompleted,       // (toolCallId, result?) => void
  clear,               // () => void
} = useToolCalls(agent, { autoClear: true })
```

Each `ReactiveToolCall` carries `id`, `name`, `args` (raw, streaming), `parsedArgs`, `status`, `startedAt` / `completedAt` / `duration`, and two result fields. **`result`** is the result as text — since AG-UI 1.0 a tool result may be multimodal, so this is the flattened text and drops any media parts. **`resultContent`** holds the unflattened `string | ContentPart[]`; read it if your tools return images or other media.

### `useReasoning(agent, options?)`

```ts
const {
  reasoningMessages,  // Ref<ReadonlyMap<string, ReasoningMessageEntry>> — keyed by message id
  openSpans,          // Ref<ReadonlyMap<string, ReasoningSpan>> — open spans only, keyed by span id
  streamingMessages,  // ComputedRef<ReasoningMessageEntry[]>
  isReasoning,        // ComputedRef<boolean> — a span is open or a message is streaming
  getReasoning,       // (messageId) => ReasoningMessageEntry | undefined
  clear,              // () => void
} = useReasoning(agent, { autoClear: true })
```

Each `ReasoningMessageEntry` carries `id`, `content` (accumulated), `status` (`'streaming' | 'complete' | 'error'`), `startedAt` / `completedAt` / `duration`, and, when present, `subagentRunId` and `encryptedValue`. A `ReasoningSpan` carries `id`, `startedAt` and, when present, `subagentRunId`. `subagentRunId` is exposed as-is; entries are not grouped by it. Entries are plain objects: a change replaces the entry rather than editing it, so passing one as a prop updates the child.

### `useActivities(agent)`

```ts
const {
  activities,    // Ref<ReadonlyMap<string, ActivityMessage>> — keyed by message id
  activityList,  // ComputedRef<ActivityMessage[]> — in conversation order
  getActivity,   // (messageId) => ActivityMessage | undefined
} = useActivities(agent)
```

An `ActivityMessage` carries `id`, `activityType`, `content` (an object) and, when present, `subagentRunId`. `activities` changes only when an activity does, not on every streamed token, and an unchanged entry keeps its identity.

### `useAgentState<T>(agent, options?)`

```ts
const {
  state,       // T — writable reactive() object; updates on STATE_SNAPSHOT / STATE_DELTA
} = useAgentState<MyState>(agent, {
  initialState: { ... },
})
```

`state` is a writable `reactive()` object. Mutate it directly (even deeply, or via `v-model`) — a deep watcher syncs the change to `agent.state`, so it is sent in `RunAgentInput.state` on the next run. There is no `setState`; mutation is the sync mechanism. Inbound `STATE_SNAPSHOT` / `STATE_DELTA` events update the same object in place.

### `useAgentEvent(agent, subscriber)`

```ts
useAgentEvent(agent, {
  onToolCallStartEvent({ event }) { ... },
  onToolCallEndEvent({ event }) { ... },
  onCustomEvent({ event }) { ... },
  // Any AgentSubscriber method
})
```

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — [&effect data solutions GmbH](https://and-effect.com)
