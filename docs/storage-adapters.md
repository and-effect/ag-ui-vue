# Storage Adapters

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
