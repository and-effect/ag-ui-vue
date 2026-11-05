# CLAUDE.md

## Project overview

ag-ui-vue is a Vue SDK for the [AG-UI protocol](https://docs.ag-ui.com/). It provides Vue composables that wrap the official `@ag-ui/client` package, bridging AG-UI's event-driven agent communication into Vue's reactivity system.

## Architecture

The package is a thin adapter layer. It does NOT implement the AG-UI protocol directly — it delegates to `@ag-ui/client`'s `HttpAgent` for all protocol handling (SSE parsing, event validation, middleware, state tracking) and bridges the results into Vue `ref()`s.

```
@ag-ui/client (HttpAgent, subscribers, middleware)
       ↓ events
ag-ui-vue composables (useAgent, useAgentEvent)
       ↓ reactive refs
Vue components (user's app)
```

### Key files

- `src/composables/useAgent.ts` — Core composable. Creates an HttpAgent, subscribes to events, exposes reactive state (messages, isRunning, error + machine-readable errorCode, streamingContent, and the last run's `lastOutcome`/`usage` from RUN_FINISHED/RUN_ERROR), and owns the shared tool registry (creates it via `createToolRegistry`). `send`/`continueRun` merge all enabled registered tools with any explicit `tools` option. This is the main public API.
  - **Run identity.** `useAgent` owns the `run_id`: it mints one per run (`runIdFactory` ?? UUID) *outside* the retry loop and passes it via `agent.runAgent({ runId, … })`, so an `onError` retry re-sends the same id. `messageRuns`/`runForMessage` report **the run that actually emitted the message** — a fact, not a grouping policy.
    - **Provenance comes from `RunAgentResult.newMessages`, never from scanning `agent.messages`.** `runAgent` snapshots the message ids present before the stream and returns the post-stream diff; `stampRun()` records that diff against the run id. Do **not** "fix" this back into a scan of `agent.messages` for ids missing from the map: `has()` cannot distinguish *never seen* from *seen and knowingly unattributed*, so the next run to stream anything back-stamps every previously-unstamped message — silently re-attributing a legacy-hydrated transcript, `initialMessages`, or a HITL tool result to whichever run fires next. Regression tests: `useAgent.test.ts` → "does not back-stamp …". The user message is stamped directly in `send()` (it is pushed before the pre-run snapshot, so it is excluded from the diff by construction). Consequences, all intended: hydration via `setMessages(msgs, runs?)`, messages added between runs, and a partial message left by an errored/aborted run all report `undefined`; provenance lands when a run resolves, not per token.
    - Provenance is a side-map (copy-on-write `shallowRef<ReadonlyMap>` — *not* mutate+`triggerRef`, because `readonly()` strips the shallow flag and a consumer's plain `watch()` would silently never fire), never a field on `Message` — messages go back to the server verbatim. `setMessages(msgs, runs?)` **replaces** the map unconditionally: omitting `runs` means "no known runs", not "keep the previous conversation's", or a swapped-in transcript would inherit runs it was never part of and the map would grow across switches.
    - **A `run_id` identifies one logical run, not one HTTP request** — the retry reuses it deliberately. So it is not a unique key for a server-side request record, and `onError` returning `{retry:true}` after a *partially streamed* failure re-sends it alongside the partial assistant message; documented on `UseAgentOptions.onError`. Nor is it a unique key for a rendered message: several `TEXT_MESSAGE_START`/`END` pairs per run are protocol-legal (`verifyEvents` only rejects a duplicate *in-progress* messageId), so one run can produce several bubbles while one exchange can span several runs. Per-message durable state (feedback) wants `{threadId, runId, messageId}` — run id as the join to the server's trace/usage record, message id as the identity of the rated content. Resist "just key it on the run".
    - Claims about message-id durability are **backend-dependent**, not protocol facts: the server mints assistant ids in `TEXT_MESSAGE_START`, and `Message` has no run field at all (the schemas are zod `strip`-mode, so a backend cannot smuggle one in — an extra `runId` is silently dropped on parse). A stateless adapter discards its message ids after the stream; a stateful one may keep them. Don't restate "assistant message ids are ephemeral" as universal.
    - **Do not reintroduce a client-side "turn" concept.** An earlier design grouped a `send()` + its continuations under one `turnRunId`, gated by a `registry.hasOpenTurn()` HITL check. It was stripped: AG-UI's [interrupts](https://docs.ag-ui.com/concepts/interrupts) make cross-run correlation protocol-level via `Interrupt.id`, and signal an open exchange via `RUN_FINISHED.outcome.type === 'interrupt'` rather than TOOL_CALL_* bookkeeping. Adopt that instead of inventing a parallel notion.
    - **Interrupts are adopted — exchange grouping still is not.** `useInterrupts` handles the pause/resume lifecycle, but a resume run is just another run with its own `run_id`; cross-run correlation is the consumer's join on `Interrupt.id`. Still do not reinvent `turnRunId`.
  - **Interrupt gate.** `useAgent` owns the run invariant: `send`/`continueRun` call `interruptRegistry.assertRunAllowed(runOptions.resume)` *before* touching the transcript, and refuse with a typed `InterruptError` while interrupts are open and the run's `resume` doesn't answer every one (rules 3, 4), names an unknown id, or answers an expired one with anything but `cancelled` (rule 7). Thrown client-side so it never reaches `onError`/retry — the client's own `AGUIError` from `onInitialize` would. A queued or coordinator-issued `continueRun` is not awaited, so its refusal is caught into `error` (`reportRefusedRun`) rather than becoming an unhandled rejection. `reset()` / `setMessages(msgs, runs, interrupts?)` call `interruptRegistry.restore()`, which writes **both** our reactive list and `agent.pendingInterrupts` — the client gates every run on the latter, so leaving it stale locks the next conversation on the same agent (`useThreads` switches on one agent).
  - `forwardedProps` (AG-UI's run-input escape hatch) is exposed both composable-level (`MaybeRefOrGetter`, resolved per request) and per-run, shallow-merged. `context` follows the same pattern: composable-level `MaybeRefOrGetter<ContextEntry[]>` re-resolved in `runWithRetry` (so continuations, resumes and retries carry it), per-run entries appended. `resolveContext()` rebuilds each entry, unwraps a ref/getter `value` (`toValue`), JSON-serialises non-strings and drops what serialises to `undefined`; that serialisation doubles as the proxy strip, so no `stripState` pass is needed. Note it is **not** the interrupts path — that is the separate top-level `resume?: ResumeEntry[]` on `RunAgentParameters`.
    - **`RunOptions` are per *request*, not per exchange.** `toolRegistry`'s `maybeContinue()` issues the continuation as `continueRun({ tools: mergeTools() })`, so a `context` / `forwardedProps` / `subscriber` passed to `send()` does not carry to the tool round-trip it triggers. Keep it that way — carrying them would re-establish the send-plus-continuations "turn" that was deliberately stripped (see the "do not reintroduce" note above), and re-sending a one-shot parameter such as a LangGraph `command` on a resumed run is wrong more often than right. Composable-level `forwardedProps` and `context` cover every hop, because they are re-resolved per request. Documented on `RunOptions` and in `docs/composables/use-agent.md` → "Backend-specific run parameters".
- `src/composables/toolRegistry.ts` — Shared frontend-tool coordinator, keyed to the agent via a `WeakMap` (`getToolRegistry`/`createToolRegistry`). Owns the single TOOL_CALL_* subscription, dispatches lifecycle (`onStart`/`onArgs`/`onEnd`/`onTerminate`) to registered tools by name, batches their results (`submitResult`), and fires exactly one `continueRun` per turn once the run has finished **with outcome `success`** AND every expected frontend call is resolved. A `cancelled` outcome abandons the turn. An `interrupt` outcome keeps it open but never continues (the client would reject a plain continuation): pending calls stay answerable, their results land in the transcript, and the resume run carries them. `hasUnresolvedCalls()` (reactive) backs `useInterrupts.canResume` and `useAgent`'s run check, which refuses any run carrying `resume` (`frontend-calls-pending`) until they are answered — otherwise the resume run's RUN_STARTED would terminate them and orphan the tool call. A missing outcome counts as success, as the client itself treats it. `mergeTools` dedupes registered + explicit tools by name (explicit wins). Turn-state integrity: `submitResult` drops a result whose id is no longer expected (so a slow handler can't inject into a discarded conversation); `abandonTurn()` (called by `useAgent`'s `reset()`/`abort()`, and internally on RUN_ERROR) dispatches `onTerminate` for unresolved calls then clears turn state; `unregister` submits an error result for a tool's unresolved calls (keeps the continuation protocol-valid) rather than dropping them.
- `src/composables/interruptRegistry.ts` — Interrupt coordinator, sibling of `toolRegistry` and discovered the same way (`WeakMap`, `getInterruptRegistry`). Owns the open interrupts and the staged responses. **Reads interrupts from the `onRunFinishedEvent` params, never `agent.pendingInterrupts`**: the client writes that field only *after* every subscriber has run. Lifecycle mirrors the client: an `interrupt` outcome opens a set (dropping staged answers), `success`/`cancelled` closes it, `RUN_ERROR` keeps it (so a failed resume can be resubmitted). Builds the resume with the client's `buildResumeArray` and checks expiry with `isInterruptExpired`; don't reimplement either. Rule-6 schema validation is a **consumer-supplied hook** (`UseAgentOptions.validateResumePayload`). No validator is bundled, by decision: a hand-rolled subset would be another dialect to maintain and would silently pass unknown keywords, and a real one is many times our bundle size.
- `src/composables/useInterrupts.ts` — Per-interrupt view over the coordinator: `resolve(payload)`/`cancel()` **stage** an answer, which stays revisable until `resumeAll()` sends one `resume[]` covering every open interrupt (the protocol requires that). The send is deliberately explicit rather than auto-firing when the last answer lands, unlike `toolRegistry.maybeContinue`. Reason: approve-with-edits forms want a review step, and with parallel interrupts the click order should not decide when the submit happens. Answers are frozen while a run is in flight, and `resumeAll()` refuses (`run-in-flight`) rather than queuing; `useAgent.continueRun` likewise never queues a run carrying `resume`, since the single-slot queue would replay it stale after the first one settles. A tool-bound interrupt is answered with a decision only. The *server* re-emits the tool result, so never `addMessage(role:"tool")` for it. `AgentInterrupt` and `FrontendToolCall` both extend `PendingDecision` (`kind` discriminant) so one approvals view can render both.
- `src/composables/useReasoning.ts` — Live view of `REASONING_*`. Event-driven like `useToolCalls`: two `shallowRef(Map)`s mutated in place + `triggerRef`, one for **open spans** and one for **reasoning messages**. **Entries themselves are copy-on-write**: a change sets a fresh object (`update()`), never `msg.status = …`. Entries aren't reactive, so a child component given an entry as a prop would see the same identity and an untracked field, and never update. That was the demo's "spinner keeps spinning" bug. Regression test: "a child receiving an entry as a prop sees it complete". They are separate namespaces in 1.0 (a message need not sit in a span, and a span id is not a message id), so never model them as parent/child. Content is `reasoningMessageBuffer + event.delta`: the client hands subscribers the buffer *before* it appends the delta (same for `textMessageBuffer`). Entries remember their run in a private `WeakMap`, so a run's end (`RUN_ERROR` incl. HttpAgent's synthetic abort one, `onRunFailed`, `onRunFinalized`) or the next `RUN_STARTED` closes only that run's leftovers, as `error`. A late abort error therefore can't close the next run's entries. Settled entries whose message leaves `agent.messages` are pruned in `onMessagesChanged`. A streaming one is exempt there (the client adds its message just after `REASONING_MESSAGE_START`), so `closeRun` drops, rather than errors, an entry whose message is already gone. Otherwise a `reset()` mid-thought would leave the old conversation's entry, errored by the late abort, in the fresh one. Mock tests must therefore add streamed messages to `mock.messages`, as the `stream()` helper does. The public type is `ReasoningMessageEntry`, not `Reactive…`, because the entries are deliberately not reactive.
  - **De-duplication decision: there is no live reasoning slot.** Unlike assistant text, the client streams reasoning *into* the message in `agent.messages`, so `AgMessageList`'s `#reasoning` slot is itself the live surface, and `useReasoning` supplies status by id (`getReasoning(msg.id)`). One render path, so no `streamingContent`-style guard is needed. Rendering `reasoningMessages`' text outside the list *and* providing `#reasoning` double-renders by construction; that is documented, not guarded.
  - No `streamingReasoning` on `useAgent`, by decision: it keeps `useAgent` lean, and `useReasoning` is one line away.
- `src/composables/useActivities.ts` — Live view of `ACTIVITY_*`. **Indexes the activity messages in `agent.messages` (on `onMessagesChanged`); it does not apply snapshots or patches itself.** The client already applies `replace` and RFC 6902 (its own `fast-json-patch`). It also clones *every* message on every update, so identity tells us nothing: an untouched activity is a new object on each text token. `sync()` therefore compares a fingerprint (`activityType`, `subagentRunId`, content JSON) and keeps the existing entry when it is equal, so `activities` signals only on a real change and entries keep their identity. `activityList` returns those entries, not the client's latest clones. Regression test (real client): "does not signal when a text token streams …"; `MockHttpAgent` keeps object identity, so it can't catch this. Don't "fix" this into an event-driven copy: a second patch application could diverge from the settled message (e.g. a patch the client rejects with a warning), and it would add a dependency. Activity messages persist via `useThreads` unfiltered, by decision: `prepareRunAgentInput` strips them from every request, so they cost local storage only.
- **Direct `agent.messages` writes notify subscribers.** `useAgent`'s `send`/`setMessages`/`reset` mutate the array in place rather than calling `agent.setMessages`, which the client never reports. `publishMessages()` therefore calls every *other* subscriber's `onMessagesChanged` synchronously. Without it, `useActivities` and `useReasoning` (which hold only the agent) would miss thread switches. `MockHttpAgent.subscribers` mirrors the client's public field for this.
- `src/components/AgInterrupt.ts` — Renderless view over `useInterrupts`: one slot per *open* interrupt (answered ones stay, so answers remain revisable), routed by `reason` with `#default` fallback; slot scope `{ interrupt, args, toolName, resolve, cancel }`, with `args`/`toolName` read from the transcript's tool call (complete by the time the run pauses, and present after hydration — `useToolCalls` would be neither). A `#resume` slot (`canResume`, `resumeAll`, `cancelAll`) renders while paused. It **never auto-sends** — the explicit send from `useInterrupts` (review step for approve-with-edits) applies here too; don't add a "component calls `resumeAll`" shortcut.
- Other renderless components (`src/components/`), all `defineComponent` + render functions so the library build needs no SFC plugin: `AgMessageList` (iterates messages; `#message` slot with a `type` discriminant, plus `#reasoning`, `#streaming`, `#empty`), `AgMessageInput` (input value, attachments, `send`/`abort` emits), `AgThreadList` (`#thread` slot with switch/delete), `AgToolCallStatus` (one slot per tool-call status).
- `src/composables/useThreads.ts` — Multi-conversation management on one injected agent: `useThread` (load/persist one thread) and `useThreads` (list, switch, create, delete). Persistence goes through an async `ThreadStorageAdapter` (`MemoryAdapter`, `LocalStorageAdapter` bundled); a switch swaps messages, state, provenance and interrupts on the same agent, so subscriptions survive. See the `updatedAt` note below.
- `src/composables/useAgentEvent.ts` — Lightweight helper for subscribing to specific AG-UI events with automatic cleanup on scope dispose.
- `src/composables/useToolCalls.ts` — Reactive tracking of tool call lifecycle (start → args → end → result) for real-time progress indicators. Uses a `shallowRef(Map)` + `triggerRef` (mutate in place, signal once per handler) — no per-mutation Map clone.
- `src/composables/useFrontendTool.ts` — Per-tool composable supporting automatic execution and human-in-the-loop (HITL) patterns. Auto-registers with the agent's tool registry on setup, unregisters on scope dispose (no manual `tools` passing). Exposes a per-call `calls` ref (`streaming-args`→`executing`/`pending`→`complete`/`error`), each pending HITL call carrying its own `respond`/`reject`; `isExecuting`/`lastResult`/`lastError`/`pending`/`resolve`/`reject` remain as derived back-compat conveniences. Implements `onTerminate` (flips an abandoned call to `error`, nulls its `respond`/`reject` so the card stops spinning and stale closures die). `calls` only grows — call `clear()` to drop history (no `autoClear`; retention is consumer-managed).
- `src/composables/useAgentState.ts` — Bidirectional shared state synced via STATE_SNAPSHOT and STATE_DELTA events. Returns a writable `reactive()` `state` object: mutate it directly (even deeply / via `v-model`) and a sync-flush deep watch pushes the change to `agent.state`. Inbound snapshot/delta events update the same object in place behind an `applyingRemote` guard to avoid an echo loop. No `setState` — mutation is the sync mechanism.
- `src/composables/useGenerativeUI.ts` — Static GenUI composable: maps tool names to Vue components via a registry. Registers each tool with the shared coordinator as an auto-resolving frontend tool (submits `{ rendered: true }` on `onEnd`); the coordinator does the batching + single `continueRun`. Rendering is built on `useToolCalls`.
- `src/types/index.ts` — Re-exports from @ag-ui/core and @ag-ui/client plus the UseAgentOptions interface.
- `src/types/standard-schema.ts` — Inlined Standard Schema v1 types (used by `useFrontendTool`'s schema inference), so the package needs no runtime dependency on `@standard-schema/spec`.
- `src/index.ts` — Barrel export.
- `src/__tests__/` — Vitest test suite.

## Tech stack

- **Vue 3.3+** (Composition API, `ref`, `readonly`, `onScopeDispose`)
- **@ag-ui/client** — Official AG-UI TypeScript client (HttpAgent, AgentSubscriber)
- **@ag-ui/core** — AG-UI types (Message, ToolCall, BaseEvent, etc.)
- **Vite** — Library mode build
- **vite-plugin-dts** — Declaration file generation with rollup
- **vitest** — Unit test runner
- **happy-dom** — Lightweight DOM environment for tests

## Build & test

```bash
npm install
npm run build        # produces dist/index.js (ESM) and a rolled-up dist/index.d.ts
npm run dev          # watch mode
npm run typecheck    # type checking without emit
npm test             # run tests in watch mode
npm run test:run     # run tests once (CI)
npm run dev:backend     # examples: PydanticAI backend on :8000 (uv)
npm run dev:playground  # examples: playground on :5173, proxies /api to the backend
```

The repo root is an npm workspace containing `examples/playground`. The playground aliases `@and-effect/ag-ui-vue` to `src/index.ts`, so it runs against library source with HMR, and the workspace hoisting gives library and app a single Vue copy. Do not add the library as a `file:` dependency of the playground: that symlinks the root into its own `node_modules`. See `examples/README.md` for how the playground is structured.

Vue, @ag-ui/client, and @ag-ui/core are peer dependencies and externalized from the bundle. Measure the size from `npm run build` (it prints raw and gzipped sizes) rather than quoting a number here.

## Testing approach

Tests live in `src/__tests__/` and cover all composables. Key helpers:

- `src/__tests__/helpers/mockHttpAgent.ts` — `MockHttpAgent` that tracks subscribers and exposes an `emit(eventName, arg)` method for triggering AG-UI events in tests without HTTP. The composables that accept `agent` as a parameter (all except `useAgent`) can be tested by passing a `MockHttpAgent` directly.
- `src/__tests__/helpers/scriptedAgent.ts` — `ScriptedAgent`, a **real** `AbstractAgent` whose run replays a fixed event list through the client's verify/apply pipeline. Use it when the claim is about what the client does (patch application, `replace`, buffers, `encryptedValue`, what `RunAgentInput.messages` contains) rather than how a composable handles one callback.
- `src/__tests__/helpers/withSetup.ts` — Mounts a composable inside a real Vue component (via `createApp`) so unmounting disposes the component's scope and `onScopeDispose` cleanup runs as it would in an app.
- `useAgent` requires `vi.mock('@ag-ui/client')` because it calls `new HttpAgent()` internally. The mock instance is accessed via the returned `agent` ref, which is the same object created by the constructor.

## Design principles

1. **Delegate to @ag-ui/client.** Never reimplement protocol logic. Use HttpAgent's subscriber system, not raw fetch/SSE parsing.
2. **Headless.** No UI components, no CSS, no design system opinions. Works with Vuetify, Quasar, PrimeVue, Tailwind, or plain HTML.
3. **Expose the escape hatch.** The raw `HttpAgent` instance is always accessible via `agent` for middleware, custom subscribers, or direct event stream access.
4. **Readonly by default.** Returned refs are wrapped in `readonly()` so state can only change through explicit actions (send, abort, reset).
5. **Vue lifecycle aware.** Subscriptions are cleaned up with `onScopeDispose`, not `onUnmounted`: identical inside a component, and it also works in a detached `effectScope`. No manual teardown needed.

## Reactivity boundary (deep / shallow / raw)

Vue's deep reactivity and `@ag-ui/client` are in tension: the client uses `structuredClone` on data crossing the protocol boundary, and `structuredClone` throws on Vue reactive proxies. Rather than patch each call site with a `toRaw`/JSON strip, we decide **at the source** how reactive each kind of data should be. There are exactly three tiers:

| Data | Tier | Where | Why |
| --- | --- | --- | --- |
| `state` (`useAgentState`) | **deep-reactive** (`reactive()`) | `useAgentState.ts` | Mutation *is* the sync mechanism — `state.recipe.title = 'x'` → deep watch → `agent.setState`. Nested tracking is the point, so the proxy is intrinsic, not incidental. |
| `messages` | **shallow** (`shallowRef`) | `useAgent.ts` | Always replaced wholesale (`messages.value = [...agent.messages]` on every change). A `shallowRef` gives consumers identical reactivity with no per-token deep-proxy traversal, and keeps the array un-proxied so it crosses into the client cleanly. |
| tool defs, components, handlers | **raw** (`markRaw`) | `useFrontendTool.ts`, `useGenerativeUI.ts`, `AgMessageInput.ts` | Pure data/functions that only ever flow *through* Vue, never need tracking, and must stay plain to cross `structuredClone`. `markRaw` at creation keeps them plain even when collected into a reactive container (e.g. `allTools.value = [t1.tool, t2.tool]`). |

**The rule:** a `toRaw()` or `JSON.parse(JSON.stringify())` strip at a *call site* is a smell — it means the data was deep-proxied at a source where it shouldn't have been. Fix the source (`shallowRef`/`markRaw`), not the site.

**The exceptions** are `state`, `forwardedProps` and interrupt resume payloads — the payloads that are *consumer-supplied, passed through uninterpreted, and JSON-by-protocol*. For those the strip is correct, not a hack, because we don't own the shape of the data and so cannot fix its source.

`state` first. There the proxy is deliberate, so the boundary strip *stays*: AG-UI state is JSON over the wire (STATE_SNAPSHOT, STATE_DELTA, RFC 6902 patches), so `JSON.parse(JSON.stringify(state))` is lossless by construction *and* is the only reliable nested-proxy strip (`structuredClone(toRaw(state))` leaves nested proxies in place and throws). This strip is the `stripState` helper in `useAgentState.ts`, shared by `useAgentState` itself (inbound snapshot/delta events) and `useThreads` (thread hydration on switch), which imports it alongside `replaceInPlace` — the single "adopt external state in place" algorithm, kept with the state composable that owns those semantics. `useThreads` also strips state in `contentPayload()`, which builds both the write and the `lastSavedContent` baseline. Do **not** remove it.

**`updatedAt` means last activity, not last save.** `useThread.persist()` is a dirty check: it compares the serialized payload (messages + state + provenance + interrupts) and the title against the baseline. It skips the write when neither changed, so visiting a thread doesn't write. It re-stamps `updatedAt` only when the content changed, and only after `adapter.save()` resolves. A rename is written without a re-stamp, so it doesn't reorder `threads`. A thread that isn't on disk yet has a `null` baseline, so its first persist creates it. `useThreads.refresh()` lets the adapter's titles win but takes the later `updatedAt` (a list read before a save landed must not reorder), and goes through `useThread.adoptMeta()` for the active thread so the adopted title also becomes the baseline. Otherwise the next save would write the stale local title back over a server-generated one. Don't move the re-stamp back before the save, and don't take the baseline from state alone: the outgoing persist in `doLoad` must still save message-only changes (for example a HITL tool result).

`forwardedProps` is the second caller, on the same grounds: it's an opaque backend payload the consumer will naturally build from a `reactive()` object or a store (`forwardedProps: () => ({ config: settings })`), and `HttpAgent` sends `RunAgentInput` as `JSON.stringify(input)` after `structuredClone`ing it — so the strip is lossless with respect to what the server receives, while its absence is a `DataCloneError` from deep inside the client. `useAgent`'s `resolveForwardedProps()` strips the *merged* object (composable-level defaults + per-run keys), so both entry points are covered; a shallow spread would not be enough, since only nested proxies are the problem. Regression tests: `useAgent.test.ts` → "strips reactive proxies from …", which assert `structuredClone(sent)` does not throw rather than merely comparing equal.

Interrupt resume payloads are the third, on the same grounds: the natural source is a `reactive()` approval form. They are stripped when staged (`interruptRegistry`'s `checkedResolution`, which also snapshots them so later edits to the form can't change a staged answer) and again on the `resume` passed to `runAgent`, which also covers a hand-built `RunOptions.resume`.

**`shallowRef` invariant:** a `shallowRef` only reacts to `.value` reassignment, not in-place mutation. Never write `messages.value.push(...)` or `messages.value[i].content += token` — it would silently freeze the UI mid-stream. Always reassign a fresh array (`messages.value = [...agent.messages]`).

**Mutate+`triggerRef` maps are returned via `shallowReadonly`, not `readonly()`.** `readonly()` drops the ref's shallow flag, so a consumer's plain `watch()` sees the same Map identity and never fires. `shallowReadonly` keeps the flag and doesn't proxy the entries. `useReasoning`/`useActivities` do this, with tests that assert a plain `watch()` fires. `useToolCalls` predates it and still uses `readonly()`.

**`markRaw` + inner refs:** `markRaw` on a container (e.g. a tool object holding a reactive `enabled` ref) stops Vue proxying the *container* only — inner refs still track normally. See the test in `useFrontendTool.test.ts`.

## Common patterns

### Basic usage
```ts
const { messages, isRunning, send, abort } = useAgent({
  url: '/api/agent',
  headers: { Authorization: `Bearer ${token}` },
})
```

### Token refresh on 401 (onError retry hook)
```ts
const { send } = useAgent({
  url: '/api/agent',
  headers: () => ({ Authorization: `Bearer ${token.value}` }),
  onError: async (err) => {
    if (err.status === 401) {
      await refreshSession() // updates the token ref
      return { retry: true } // re-runs once, re-resolving headers/url via toValue()
    }
  },
})
```
`onError` fires for every failed request — including internally-issued ones
(tool-result continuations via `continueRun`). A request is retried at most
once (loop guard); a second failure surfaces as `error`. AbortErrors (user
`abort()`) never trigger it. Implemented in `useAgent.ts`'s `runWithRetry`
helper, which both `send` and `continueRun` delegate to.

### Custom event handling (e.g. backend-specific events)
```ts
const { agent } = useAgent({ url: '/api/agent' })
useAgentEvent(agent, {
  onCustomEvent({ event }) {
    // handle custom events from your backend
  },
})
```

### Adding middleware
```ts
const { agent } = useAgent({ url: '/api/agent' })
agent.use(new FilterToolCallsMiddleware({ allowedToolCalls: ['search'] }))
```

## AG-UI protocol reference

- [AG-UI docs](https://docs.ag-ui.com/)
- [HttpAgent API](https://docs.ag-ui.com/sdk/js/client/http-agent)
- [AgentSubscriber](https://docs.ag-ui.com/sdk/js/client/subscriber) — all available event hooks
- [Event types](https://docs.ag-ui.com/sdk/js/core/events)
- [@ag-ui/client npm](https://www.npmjs.com/package/@ag-ui/client)
- [@ag-ui/core npm](https://www.npmjs.com/package/@ag-ui/core)

## Backend compatibility

Works with any AG-UI compatible backend:
- **PydanticAI** — `AGUIAdapter` ([docs](https://ai.pydantic.dev/ui/ag-ui/))
- **LangGraph** — 1st party AG-UI support
- **Mastra** — `@ag-ui/mastra`
- **CrewAI** — 1st party AG-UI support
- **Custom** — any server emitting AG-UI SSE events

## Things to know when editing

- The `onMessagesChanged` subscriber callback is the key bridge: HttpAgent maintains messages internally, and we copy them into the Vue ref on every change. This is intentional — Vue needs a new array reference to trigger reactivity.
- `streamingContent` is a convenience ref that holds the in-progress message text. It resets to empty string on TEXT_MESSAGE_END and on send/abort. It exists so consumers don't have to scan the messages array to find the streaming message.
- Peer dependencies are intentional. Users must install @ag-ui/client and @ag-ui/core themselves. This avoids version conflicts and keeps the bundle small.
- The package is ESM-only (no CJS build, by decision: a dual package risks the dual-package hazard, which would give each copy its own module-level `WeakMap` tool/interrupt registries, so composables loaded via different copies would not share one coordinator). `vite-plugin-dts` rolls the declarations into one `dist/index.d.ts` with `rollupTypes`; don't add a second declaration step that writes per-file `.d.ts` into `dist/`. The `exports` field has `types` first (required for proper TypeScript resolution).
- Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md): a PR needs an issue a maintainer has agreed to, and targets `main`. Every user-facing change gets a short `## [Unreleased]` entry in CHANGELOG.md, written for library users (not implementation notes), with **BREAKING:** at the start of breaking changes.

## Tool Calls Architecture (Critical!)

**Tool calls exist in TWO places in AG-UI:**

1. **In messages** (via `agent.messages` → `messages` ref):
   - Assistant messages have an optional `toolCalls?: ToolCall[]` array
   - Tool results appear as separate messages with `role: "tool"` and `toolCallId` field
   - HttpAgent automatically populates these from the event stream
   - This is the **source of truth** for completed tool calls

2. **In streaming events** (via `useToolCalls` composable):
   - TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, TOOL_CALL_RESULT events
   - Provide **real-time visibility** of tool execution as it happens
   - Allow showing progress indicators, streaming arguments, etc.
   - These events build up the tool calls that eventually appear in messages

**The correct pattern:**
- Use `useToolCalls` for **active/streaming** tool calls (show spinner, live args)
- Display completed tool calls from **messages** for the conversation history
- Don't duplicate — completed tool calls should come from messages, not from tracking events separately

**Message flow example:**
```
1. User: { role: "user", content: "Search for X" }
2. Assistant (tool calls): { role: "assistant", toolCalls: [{id: "call_123", ...}] }
3. Tool result: { role: "tool", toolCallId: "call_123", content: "[result]" }
4. Assistant (response): { role: "assistant", content: "Based on..." }
```

**Key insight:** HttpAgent does NOT just emit events — it also builds up a proper message history with tool calls embedded. The events are for real-time UX, messages are the canonical history.