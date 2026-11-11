# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `useAgent`'s `streamingContent` now includes the latest chunk. It used to lag one chunk behind and stayed empty after the first token, so `AgMessageList`'s `#streaming` slot showed the text one step late.

## [0.5.0] - 2026-11-05

### Added
- **`useInterrupts`** for AG-UI 1.0 server-side interrupts. It lists the interrupts a run paused on, lets you answer each one with `resolve(payload)` / `cancel()` (including approve-with-edits via `editedArgs`), and `resumeAll()` sends every answer as one `resume[]`. The answers can be changed until then.
- `useAgent` gains `interrupts`, `RunOptions.resume`, and an optional `validateResumePayload` hook (no validator is bundled). `setMessages` and `useThreads` restore and persist open interrupts.
- **`useAgent({ context })`**: composable-level `RunAgentInput.context`, re-resolved before every request, including tool continuations, interrupt resumes and retries. New `ContextEntry` type.
- **`AgInterrupt`**: a headless component that renders one slot per open interrupt, routed by `reason` with a `#default` fallback, plus a `#resume` slot with `canResume` / `resumeAll` / `cancelAll`.
- `PendingDecision`: a shared shape for `FrontendToolCall` and `AgentInterrupt`, so one approvals view can render both.
- **`useReasoning(agent)`** and **`useActivities(agent)`**: live views of AG-UI 1.0 reasoning (spans and streamed reasoning messages, for a "thinking…" indicator or a chain-of-thought panel) and activities (structured progress with snapshots and patches applied, keyed by message id). Both are opt-in, and `AgMessageList`'s `#reasoning` / `#activity` slots are unchanged. `ReasoningMessage` and `ActivityMessage` are re-exported.
- `useAgent`, `useThread` and `useThreads` gain `lastOutcome` (how the last run ended: `success` / `interrupt` / `cancelled` / `error` / `aborted`) and `usage` (its `TokenUsage[]`). New `RunOutcome` type.
- `useAgent`, `useThread` and `useThreads` gain `errorCode`: a machine-readable code next to `error`, such as a `RUN_ERROR` event's `code` or `'abort'`.
- `useThreads` gains `refresh()`, which re-reads the thread list from the adapter (e.g. a title the server generated), and `activeThread`, the open thread's metadata. `useThread` gains `adoptMeta()`, which `refresh()` uses.
- `AgMessageInput` now stores the file name in `metadata.filename` for image, audio and video attachments too, not just documents, so apps can show it or use it in alt text.

### Changed
- **BREAKING:** The package is renamed to `@and-effect/ag-ui-vue` and published to the public npm registry.
- **BREAKING:** The package is ESM-only. The CommonJS build (`dist/index.cjs`) is removed. Use a bundler, or Node >= 20.19, which can `require()` ESM.
- The type declarations are now a single rolled-up `dist/index.d.ts`, which fixes type resolution under `moduleResolution: node16`/`nodenext`.
- Test type declarations (`dist/__tests__`) are no longer published.
- `RunOptions.context` is typed `ContextEntry[]` (was `any[]`). Per-run values are now serialised like composable-level ones, and `undefined` ones are dropped.
- While interrupts are open, `send()` / `continueRun()` without a matching `resume` reject with a typed `InterruptError` before any request is made. It does not reach `onError`.
- The frontend-tool coordinator continues a run only when its outcome is `success`. After an `interrupt` outcome it keeps pending frontend tool calls open, and their results are sent with the resume run. A run carrying `resume` is refused until they are answered (`InterruptError` code `'frontend-calls-pending'`).
- `resumeAll()`, and a `continueRun({ resume })` issued while a run is in flight, reject with `InterruptError` code `'run-in-flight'` instead of queuing a second resume. An interrupt's `resolve()` / `cancel()` (and `cancelAll()`) reject the same way, since answers are frozen until the run settles. An empty `resume: []` counts as no resume.
- An `abort()` while the thread is idle and paused on interrupts keeps pending frontend tool calls open, so their results still go out with the resume.

### Removed
- **BREAKING:** `AgStreamingCursor` is removed. Render your own cursor in `AgMessageList`'s `#streaming` slot, e.g. `<template #streaming="{ content }">{{ content }}<span class="inline-block w-2 h-4 bg-current animate-pulse" /></template>`.

### Fixed
- `useAgent`'s `send()`, `setMessages()` and `reset()` now notify the agent's other subscribers (`onMessagesChanged`). They write `agent.messages` directly, so composables and custom subscribers on the same agent missed thread switches.
- Opening a thread no longer moves it to the top of `threads`. `updatedAt` now changes only when a thread's messages or state change and the save succeeds. Visiting a thread, renaming it, or a failed save leaves it as is, and a switch away from an unchanged thread doesn't write.
- An interrupted run no longer locks the agent: `reset()`, `setMessages()` and thread switches now clear the client's pending interrupts.

### Examples
- New **Reasoning & activity** demo: a collapsible thinking panel for the model's reasoning, and a progress row fed by activity events that a timezone tool emits while it runs.
- New **Page context** demo: the agent answers about the building permit application you have open, including after its `openApplication` tool switches it. The backend shows how to feed `context` to a PydanticAI agent.
- New **Interrupts** demo: approve, deny or edit server tool calls (PydanticAI `requires_approval`), rendered with `AgInterrupt`.
- `basic-chat` and `project-canvas` are replaced by one playground (`examples/playground`) and one backend (`examples/backend`), with new **Tool calls** and **Run identity** demos. Run `npm run dev:backend` and `npm run dev:playground` from the repo root; see `examples/README.md`.

## [0.4.0] - 2026-10-03

### Changed
- **BREAKING** Upgraded to **AG-UI 1.0**. The `@ag-ui/client` / `@ag-ui/core` peer range moves from `>=0.0.44 <0.1.0` to `^1.0.0`; there is no overlap, so consumers must upgrade both alongside this release. See AG-UI's [Migrating to 1.0](https://docs.ag-ui.com/migrating-to-1.0) for the protocol-level story. What it means here:
  - **Content part types renamed.** AG-UI 1.0 names the multimodal parts for what they are rather than which direction they travel: `InputContent` → `ContentPart`, `TextInputContent` → `TextPart`, `ImageInputContent` → `ImagePart` (audio, video, document alike), `InputContentSource` → `PartSource`, `InputContentDataSource` → `DataSource`, `InputContentUrlSource` → `UrlSource`. We re-export the new names and keep the old ones as `@deprecated` aliases of the same types, so **existing code keeps compiling** — `send(content: string | ContentPart[])` accepts anything already typed `InputContent[]`.
  - **`PartSource` has a third arm, `FileSource`** (`type: 'file'`) — a handle the model provider issued for bytes already uploaded to it. Its `value` is **not** a URL and must never be rendered as one. Code that switches exhaustively on `source.type` needs a case for it; `FileSource` is re-exported for that.
  - **`ReactiveToolCall.result` is now flattened text.** A tool result may be multimodal in 1.0 (`ToolCallResultEvent.content` widened to `string | ContentPart[]`), so `result` holds `contentToText(content)` — unchanged for every string-returning tool, but it drops media parts. The new **`ReactiveToolCall.resultContent`** carries the unflattened `string | ContentPart[]`; read it if your tools return media.
  - **Stricter streams.** The client now enforces on every path: an unrecognised event type is dropped with a warning, an unknown property on a known event is stripped before subscribers see it, and reasoning spans left open at `RUN_FINISHED` fail the run. If you were reading a non-standard property off an event in a `useAgentEvent` subscriber, move it to `metadata` (open by key, never stripped) or `forwardedProps` on the way out.
  - **zod is no longer pulled in by `@ag-ui/core`'s main entry.** Validators moved to the `@ag-ui/core/schemas` subpath. We import types only, so this package no longer brings zod along transitively.
- New 1.0 types re-exported for consumers: `Interrupt`, `ResumeEntry`, `RunFinishedOutcome`, `Metadata`, `TokenUsage`.
- **`AgMessageList` gains a `developer` message type** with a `#developer` slot, so developer instructions no longer render as the model's reply. Like `#system`, it renders nothing unless you provide the slot.
- **`AgMessageList` gains `reasoning` and `activity` message types.** AG-UI 1.0 added both arms to the `Message` union (`REASONING_*` replaced `THINKING_*`, and `ACTIVITY_SNAPSHOT`/`ACTIVITY_DELTA` carry structured progress). They previously fell through to `assistant`, so a model's private working would render as its answer and an activity message as an empty bubble. Both now resolve to their own `MessageType` with matching `#reasoning` / `#activity` slots, and render **nothing** unless you provide a slot — reasoning is opt-in by design. An `activity` message's content is an object, so the string-only `content` slot prop is `undefined` for it; read `msg.content`.

### Fixed
- A `RUN_ERROR` event from a run abandoned by `reset()`/`abort()` (e.g. switching threads mid-response, or stopping and retrying) no longer leaks onto the current state — even once a new run has started before the stale event arrives.
- The multimodal examples no longer render a non-`data` part source as an image URL, which would have used a 1.0 `FileSource` provider handle as an `<img src>`.
- **`AgMessageList`'s `#tool-result` no longer drops a multimodal tool result.** 1.0 widened `ToolMessage.content` to `string | ContentPart[]`, and the string-only `content` slot prop was `undefined` for the array form, so `{{ content }}` rendered nothing. It is now the flattened text (`contentToText`, as `ReactiveToolCall.result` is); the media parts are on `msg.content`.
- **No duplicate bubble when an `activity` or `reasoning` message arrives mid-stream.** `AgMessageList` skipped the partial assistant message only when it was the *very last* one, so a 1.0 activity/reasoning message appended during the stream left the partial text rendered in both the list and `#streaming`. The guard now walks back over those.
- **An attached document's name is no longer stripped from the request.** `AgMessageInput` put it in a top-level `filename`, which 1.0's `DocumentPart` no longer defines, so the client stripped it from every request. It now goes in `metadata`, which the client passes through untouched, so the name reaches the backend. Whether the model then sees it is up to the backend: pydantic-ai 2.46, for one, reads only its own keys (`vendor_metadata`, `force_download`) from a part's `metadata` and ignores `filename`. **If you read `att.filename`, read `att.metadata?.filename`.** The parts are built with `satisfies` rather than an `as` cast now, so a field 1.0 does not define is a typecheck error instead of a silent strip.

### Examples
- Backends bumped to **pydantic-ai 2.46** (from 1.101) and **ag-ui-protocol 1.0** (from 0.1.18); lockfiles regenerated. Both apps import and serve a 1.0-shaped `RunAgentInput` unchanged — the existing `AGUIAdapter.dispatch_request` / `StateDeps` / `@agent.tool` wiring needed no edits.

## [0.3.0] - 2026-08-06

### Added
- **Client-owned `run_id`**. `useAgent` now mints the run id and passes it to `agent.runAgent({ runId, … })` instead of letting `@ag-ui/client` generate one internally. The id is therefore knowable client-side *before the first token streams*, and — the reason it matters — is **reused across the `onError` retry**: a 401-refresh-and-retry is the same logical run rather than a silent second run under a new id. New `runIdFactory?: () => string` option overrides the default UUID (symmetric with `useThreads`' `idFactory`).
- **Message → run provenance.** `useAgent` (and `useThread` / `useThreads`) expose `runForMessage(messageId)` and the reactive `messageRuns` map, answering "which run produced this bubble?" — the join key server-side concerns like feedback and usage attribution need, since `run_id` is what the server is known to hold for a turn (it received it in `RunAgentInput`), whereas the durability of an assistant message id depends on the backend. Record both for per-message features: a run can emit several messages, and an exchange can span several runs. Kept as a side-map, never a field on `Message`, so nothing non-spec rides back to the server inside `RunAgentInput.messages`.
  - Reports the run that **actually emitted** the message. An exchange spanning a tool round-trip therefore spans several run ids; grouping them into one logical exchange is left to the consumer, pending AG-UI's own [interrupts](https://docs.ag-ui.com/concepts/interrupts) (0.0.57+), which correlate a paused run and its resumption via `Interrupt.id`. Derived from `RunAgentResult.newMessages` (the run's own before/after message diff), so only messages a run actually emitted are attributed: messages added between runs, messages hydrated without stored provenance, and a partial message from a run that errored or was aborted all report `undefined`, and provenance lands when a run resolves rather than per token.
  - `PersistedThread` gains optional `messageRuns?: Record<string, string>`; `useThread` persists and restores it, so a reloaded thread answers `runForMessage` identically to a live one. Existing threads without it simply report no run.
  - `setMessages(messages, messageRuns?)` accepts hydrated provenance. Provenance for messages that leave the transcript (a `MESSAGES_SNAPSHOT` replaces it with the server's view) is dropped on the next run, so the map stays an index into the current transcript rather than growing across saves.
- **`forwardedProps`** — AG-UI's run-input escape hatch is now reachable. Available as a composable-level `UseAgentOptions.forwardedProps` (a `MaybeRefOrGetter`, resolved fresh per request) and per-run via `RunOptions.forwardedProps`, which shallow-merges over it. This is what LangGraph reads for `command` / `config`, and what other integrations use for model or agent selection. Per-run props apply to that *request*: the continuation run a frontend tool triggers is issued with the registered tools alone, so anything that must hold across a tool round-trip belongs at composable level.

### Changed
- Message ids are now UUIDs. User message ids were `msg_${Date.now()}`, so two sends within the same millisecond collided — corrupting Vue's keying and any id-keyed map. Tool-result message ids moved to UUIDs for consistency.

### Docs
- README gains a **Run identity** section covering client-owned run ids, run-vs-turn semantics, why a retry reuses a run id (and what that means for backends keying run state on it), and how to choose between a run id and a message id when keying durable per-message state.

## [0.2.0] - 2026-07-15

### Added
- `useFrontendTool` v2 — Standard Schema support, runtime validation, handler signal, and `followUp` option:
  - `parameters` now accepts a [Standard Schema](https://standardschema.dev/) (Zod 4+, ArkType 2+) **or** a raw JSON Schema object. Passing a Standard Schema infers handler args automatically — no explicit generic needed. The schema is converted to JSON Schema for the wire using its `.input()` shape (what the LLM must produce, before transforms/coercions).
  - Args are validated against the schema before the handler is called. Validation failures submit a structured error result to the agent (so it can retry with corrected args) — the handler is never invoked with malformed data.
  - The handler's second argument `{ toolCallId, signal }` is now available. `signal` is an `AbortSignal` wired to the agent's abort — pass it to `fetch` or other async work so user-initiated `abort()` cancels in-flight operations.
  - New `followUp?: boolean` option (default `true`). Set `false` for pure side-effect tools (e.g. a dark-mode toggle) to skip the follow-up LLM turn. Handler errors and validation errors always force a follow-up regardless of this setting, so the model can self-correct.
  - Schema libraries without JSON Schema conversion support (those that don't implement `~standard.jsonSchema.input`) emit a `console.warn` and fall back to `{}` on the wire, so developers know the tool will be advertised without an argument shape.
- `createThread` now accepts an optional id: it let's the users pass an id, for example a UUID that works with their database restrictions. One can also pass an `idFactory`: a function that declares how id's should be created. The default id generation still exists and is used if no id and no idFactory is passed. This gives users more abilities for parsing and creating their own id's.
- Frontend tools now **auto-register** with the agent: declaring a tool via `useFrontendTool` (or registering via `useGenerativeUI`) is enough — a bare `send()` advertises it, no manual `tools` passing. A shared coordinator (`toolRegistry.ts`) batches every frontend tool result from a turn and issues exactly one follow-up `continueRun`, across `useFrontendTool` and `useGenerativeUI` together. `enabled: false` now drops a tool from what's advertised to the LLM.
- `useFrontendTool` exposes per-call state via `calls` (`streaming-args` → `executing`/`pending` → `complete`/`error`): parallel calls of the same tool are tracked independently, partial args are visible while streaming, and each pending HITL call carries its own `respond`/`reject` (any pending call is resolvable, not just the oldest). `isExecuting`/`lastResult`/`lastError`/`pending`/`resolve`/`reject` remain as derived conveniences. New `clear()` drops tracked calls.
- `getToolRegistry` and the `ToolRegistry` / `RegisteredTool` / `FrontendToolCall` types are exported.
- `useThread` now exposes `load(id, { persistOutgoing? })` — switch the active thread on the same agent (persist outgoing → abort → hydrate incoming). The new `LoadThreadOptions` type is exported.

### Changed
- **BREAKING** `useFrontendTool<TArgs>` — the explicit generic no longer works when `parameters` is a raw JSON Schema literal. In v2, the generic parameter is `TSchema` (the schema type itself, not the args shape), so passing a raw JSON Schema object while also supplying an explicit args-shape generic causes a TypeScript error (TS2353). **Migration:** drop the explicit generic — `args` becomes `any`, identical to the v1 runtime behavior. To get full type inference, migrate `parameters` to a Zod or ArkType schema instead:
  ```ts
  // Before (v1 — still compiles if you drop the generic):
  useFrontendTool(agentCtx, { name: '...', parameters: { type: 'object', ... } })

  // After (v2 — type-safe, no explicit generic needed):
  useFrontendTool(agentCtx, { name: '...', parameters: z.object({ ... }) })
  ```
- **BREAKING** `useThreads` / `useThread` now take an **injected agent**: `useThreads(agent, options)` / `useThread(agent, options)`, where `agent` is the return value of `useAgent`. The agent is no longer constructed inside the thread layer, so `agentUrl` / `agentHeaders` / `onError` (and `useThread`'s `url` / `headers` / `onError`) are gone — configure them on the `useAgent` call. Switching a thread swaps the conversation's contents on that one stable instance instead of recreating it, so tools / events / middleware wired to the agent (`useFrontendTool`, `useGenerativeUI`, `useAgentState`, `agent.use(...)`) keep working across `switchThread`. State binds once to the agent and is re-applied on switch (switching to a new thread resets to `initialState` rather than carrying the previous thread's state over). `threadId` is owned by the threads layer — do not also pass a reactive `threadId` to the backing `useAgent`.
  - Migration: move `agentUrl`/`agentHeaders`/`onError` into a `useAgent({ url, headers, onError })` call and pass the result in — `const agent = useAgent({ url }); useThreads(agent, { adapter })`. `useThread` gains `load()` and drops `dispose()` (cleanup is automatic on scope teardown; a final save flushes on unmount); its `meta` ref is now `ThreadMeta | null`.
- **BREAKING** `useFrontendTool` no longer accepts the `tools` option — tools auto-register, so the shared-`ref<Tool[]>` workaround is obsolete. Migration: delete the `tools` option and the `allTools` ref; a bare `send()` advertises every declared tool. An explicit `tools` array on `send()`/`continueRun()` still works as an override/extension.

### Fixed
- A slow tool handler can no longer corrupt a fresh conversation: `reset()`, `abort()`, and run errors now discard coordinator turn-state, so a handler (or HITL response) resolving after the turn is abandoned neither injects a stale tool message nor triggers a follow-up run.
- Pending HITL calls are finalized (status → `error`, `respond`/`reject` cleared) on run error / reset / abort, so their cards stop spinning and stale closures go dead — instead of hanging indefinitely.
- Unregistering a tool with unresolved calls (e.g. a component unmounting mid-turn) now submits an error result for each, keeping the continuation protocol-valid, rather than firing a follow-up run with a missing tool result.

## [0.1.2] - 2026-06-16

### Added
- `useThread` / `useThreads` now expose `isLoading` — `true` while a thread hydrates its persisted state from the adapter (and while `useThreads` loads its thread list on init). Use it to render a loading state during the async window.
- `useThread` / `useThreads` option `saveDebounceMs` (default `500`). Direct `state` mutations and `v-model` edits now persist on a debounced `watch(state)` — so an edit survives a reload even *before* a run, not only on the `isRunning` true→false transition. A `lastSaved` baseline guard skips redundant writes (e.g. an inbound `STATE_DELTA` that matches what is already on disk, or the hydration mutation itself).
- `useAgent` now returns `setMessages(messages)` — replaces the conversation's messages wholesale and refreshes the reactive ref. Used internally to hydrate a persisted conversation after construction.
- A test-only fake async adapter (latency + rejection injection) verifies the thread layer against the `ThreadStorageAdapter` contract.
- `useAgent` option `onError` — a hook invoked when a request fails, including requests issued internally (tool-result continuations via `continueRun`). It receives the error (augmented by `@ag-ui/client` with `status`/`payload` on non-OK HTTP responses) and may refresh credentials, then return `{ retry: true }` to re-run the request once with freshly resolved `url`/`headers` (so a refreshed token is sent). A request is retried at most once — a second failure surfaces as `error`. User-initiated aborts (`abort()` / `AbortError`) never trigger it. Omitting the hook keeps current behavior — non-breaking. New exported types: `AgentRequestError`, `OnErrorResult`, `OnErrorHandler`.
- `useAgent` options `url`, `headers`, and `threadId` now accept `MaybeRefOrGetter` and are resolved via `toValue()` before every request. A `headers` ref/getter (e.g. `() => ({ Authorization: \`Bearer ${token.value}\` })`) is re-read per request, so a token that refreshes mid-session is always sent fresh. A changed `url` retargets the endpoint for subsequent requests; a changed `threadId` resets and reconnects the conversation. Static values are unchanged (`MaybeRefOrGetter` is a superset) — non-breaking.
- `useFrontendTool` option `enabled` now accepts `MaybeRefOrGetter<boolean>`, so a tool can be toggled reactively (ref or getter) without re-creating it. A passed ref flows through unchanged; a getter becomes a read-only computed; a static value remains a writable ref.

### Fixed
- Switching `threadId` (or calling `reset()`) while a run is in flight no longer leaks the aborted run's outcome onto the fresh conversation. Runs are now tagged with a generation token, so a superseded run's late `AbortError` can't write `error`/`isRunning` after the reset.

### Changed
- **BREAKING** `ThreadStorageAdapter` is now **fully async** and its read path is **split**. `loadAll(): PersistedThread[]` is replaced by `listThreads(): Promise<ThreadMeta[]>` (metadata only — for the thread list) plus `load(id): Promise<PersistedThread | null>` (one thread's full payload — for hydration); `save` / `delete` now return `Promise<void>`. This lets threads be backed by a real database without dragging every conversation's transcript into memory to render a sidebar. `MemoryAdapter` and `LocalStorageAdapter` are migrated (and remain the only shipped adapters — the async interface *is* the contract for database backends; consumers implement their own). The consumer contract (full deserialization incl. real `Date`s, proxy-free `save()` input, rejection tolerance) is documented in the README.
  - Migration: a custom adapter implementing `loadAll` must split it into `listThreads` (return `.map(p => p.meta)`) and `load(id)` (return the single matching thread or `null`), and mark all four methods `async`.
- **BREAKING** `useThread` is now **construct-then-hydrate**: it builds the agent + reactive state synchronously, then loads the persisted thread asynchronously and applies it by mutation (which syncs to the agent via the v2 outbound watch). `send()` / `continueRun()` await this hydration internally, so a run never executes against the empty default state. `useThread().updateTitle` now returns `Promise<void>`.
- **BREAKING** `useThreads` initializes asynchronously (the thread list loads from the adapter), so `threads` / `activeThreadId` populate after the returned object is created — observe `isLoading`. `createThread` now returns `Promise<string>`; `deleteThread` and `updateTitle` now return `Promise<void>`. `switchThread` stays synchronous (the newly active thread hydrates itself in the background).
- Adapter rejections no longer wedge the thread layer: a failed `load()` surfaces on the thread's `error` and leaves it usable on default state; a failed `save()` is reported on `error` rather than swallowed. `useThread().error` is now a computed that combines run errors with storage errors.
- `messages` is now a `shallowRef` instead of a deep `ref`. The array is always replaced wholesale on every change, so consumer reactivity is identical — but Vue no longer deep-proxies every message on every streamed token, and messages stay plain objects when they cross into `@ag-ui/client` (non-breaking). Invariant: only ever reassign `messages.value`; never mutate it in place (`messages.value.push(...)` / `messages.value[i].content += ...` would not trigger reactivity).
- Tool definitions, GenUI components, and tool handlers are now `markRaw`'d at their source (`useFrontendTool`, `useGenerativeUI`), so they stay un-proxied even when collected into a reactive container — removing the per-call-site `toRaw` strip that previously guarded `structuredClone`. The reactivity convention (deep `state` / shallow `messages` / raw protocol data) is documented in `CLAUDE.md`.
- **BREAKING** `useAgentState` now returns a writable `reactive()` `state` object instead of a readonly `state` ref plus a `setState` setter. Mutate `state` directly (even deeply) and a deep watcher syncs the change to `agent.state` automatically — no more spread-reducers, and `v-model` binds straight to nested fields. Backend `STATE_SNAPSHOT` / `STATE_DELTA` events update the same object in place without echoing back out (synchronous-flush watcher + guard).
  - Migration: replace `const { state, setState } = useAgentState(...)` with `const { state } = useAgentState(...)`, drop `.value`, and replace each `setState((s) => ({ ...s, foo: x }))` with a direct mutation such as `state.foo = x` / `state.list.push(x)`.
  - Note: this removes *our* `setState`. The client's own `agent.setState` is unchanged — it has simply moved inside the deep watch and now fires on mutation instead of on an explicit call.
  - `useThread` / `useThreads` follow suit: their `state` is the writable reactive object and their `setState` has been removed.

## [0.1.1] - 2026-06-11

### Changed
- Package renamed to `@cause-effect/ag-ui-vue` and published to the GitLab Package Registry under the `@cause-effect` scope.

### Added
- GitLab CI/CD pipeline (`.gitlab-ci.yml`): `typecheck`, `test`, and `build` on every merge request and the default branch; `npm publish` to the GitLab Package Registry on `vX.Y.Z` tags.
- `CONTRIBUTING.md` documenting the local dev setup, MR process, and `develop` → `main` release workflow.
- `SECURITY.md` with vulnerability reporting instructions.
- Consumer install instructions in `README.md`: `.npmrc` setup (local + CI), peer-dependency matrix, and scoped-package quickstart.

## [0.1.0] - 2026-05-26

### Added
- `useAgent` composable — core composable wrapping `HttpAgent` with reactive `messages`, `isRunning`, `error`, and `streamingContent` refs
- `useAgentEvent` composable — lightweight helper for subscribing to specific AG-UI events with automatic cleanup
- `useToolCalls` composable — reactive tracking of tool call lifecycle (start → args → end → result)
- `useFrontendTool` composable — per-tool composable supporting automatic execution and human-in-the-loop patterns
- `useAgentState` composable — bidirectional shared state synced via `STATE_SNAPSHOT` and `STATE_DELTA` events
- `useGenerativeUI` composable — component registry mapping tool names to Vue components for static Generative UI
- `useThread` / `useThreads` composables — multi-conversation management with memory and `localStorage` adapters
- Headless renderless components: `AgMessageList`, `AgMessageInput`, `AgThreadList`, `AgStreamingCursor`
- ESM + CJS dual build via Vite library mode
- 146 unit tests with Vitest and happy-dom
