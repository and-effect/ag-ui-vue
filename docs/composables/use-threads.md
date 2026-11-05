# `useThreads`

Manages a collection of persisted conversations on top of an **injected** agent. You construct the agent with `useAgent`; the threads layer swaps conversation contents on that one stable instance when you switch — so tools, events, and middleware wired to the agent keep working across switches. See [Storage Adapters](../storage-adapters.md) for persistence options.

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

Threads are persisted after every completed run. Titles are auto-generated from the first user message. See [`examples/playground/src/views/ThreadsView.vue`](../../examples/playground/src/views/ThreadsView.vue) for a full sidebar demo with inline title editing, delete buttons, and timestamps.

`url`, `headers`, and `onError` are configured on the `useAgent` call — pass a `headers` getter for a token that refreshes mid-session, and an `onError` hook to recover a failed run (e.g. `401` → refresh → `{ retry: true }`). See [`useAgent`](use-agent.md) and [Handling failed requests](use-agent.md#handling-failed-requests--onerror-token-refresh--retry).

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

## API

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

The first argument is the return value of [`useAgent`](use-agent.md) — configure `url` / `headers` / `onError` there. The threads layer owns `threadId`; don't also pass a reactive `threadId` to that `useAgent`.

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
