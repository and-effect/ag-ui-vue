import {
  ref,
  computed,
  watch,
  readonly,
  onScopeDispose,
  type Ref,
  type ComputedRef,
  type DeepReadonly,
} from 'vue'
import type { HttpAgent } from '@ag-ui/client'
import type { Message, ContentPart, Interrupt, TokenUsage } from '@ag-ui/core'
import type { RunOptions } from '../types'
import type { UseAgentReturn, RunOutcome } from './useAgent'
import { useAgentState, isPlainObject, stripState, replaceInPlace } from './useAgentState'

// ─── Thread types ──────────────────────────────────────────────────────────

export interface ThreadMeta {
  id: string
  title: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PersistedThread {
  meta: ThreadMeta
  messages: Message[]
  state: unknown
  /**
   * Message id → the `run_id` of the turn that produced it, so a reloaded
   * thread answers `runForMessage` exactly like a live one. Optional: threads
   * persisted before provenance tracking simply report no run.
   *
   * This map is a **local** index into the transcript stored alongside it: the
   * keys are only meaningful against those `messages`, and the whole map is
   * replaced (never merged) when a thread is hydrated. Whether an assistant
   * message id also means anything *server*-side depends on the backend — the
   * server mints it in `TEXT_MESSAGE_START`, but a stateless adapter usually
   * discards it after the stream while a stateful one may keep it. The `run_id`
   * is the id the server is known to hold either way, so durable server state
   * (feedback, ratings, telemetry) wants it recorded — alongside the message id,
   * not instead of it, since a run can produce several messages.
   */
  messageRuns?: Record<string, string>
  /**
   * Interrupts the thread was paused on when saved, so a reloaded thread can
   * still be resumed (and refuses a plain `send` until it is). Absent when the
   * thread is not paused.
   */
  interrupts?: Interrupt[]
}

/**
 * Storage backend for persisted threads. **All methods are async** so the
 * interface fits a real database (REST call, ORM, IndexedDB) as well as the
 * synchronous in-memory / localStorage backends shipped here.
 *
 * The library ships only `MemoryAdapter` and `LocalStorageAdapter` as reference
 * implementations — consumers implement this interface against their own store.
 *
 * **Consumer contract.** A custom adapter must honor three things the thread
 * layer assumes:
 *
 * 1. `listThreads()` / `load()` resolve with **deserialized** data, including
 *    real `Date` objects on `meta.createdAt` / `meta.updatedAt`. The thread sort
 *    relies on `updatedAt` being a `Date`. (See `LocalStorageAdapter`, which
 *    revives `new Date(...)` from its JSON strings — a DB consumer must do the
 *    equivalent.)
 * 2. `save()` receives a **plain, JSON-safe object** (no Vue reactive proxies —
 *    `useThread` already JSON-strips `state` before calling). No special
 *    handling is needed consumer-side.
 * 3. Methods **may reject**. The thread layer reports rejections (via the
 *    thread's `error`) and stays usable rather than wedging — a failed `load()`
 *    leaves the thread on its default state instead of hanging on `isLoading`.
 *
 * Read path is split deliberately: `listThreads()` returns metadata only (cheap
 * — maps to `SELECT id, title, timestamps`) for rendering the thread list, while
 * `load(id)` fetches a single thread's full payload (messages + state) for
 * hydration. A database adapter should not pull every conversation's transcript
 * into memory just to render a sidebar.
 */
export interface ThreadStorageAdapter {
  /** Metadata for every thread, for listing. Cheap: no messages/state. */
  listThreads(): Promise<ThreadMeta[]>
  /** Full payload for a single thread, or `null` if it does not exist. */
  load(threadId: string): Promise<PersistedThread | null>
  /** Insert or replace a thread. */
  save(thread: PersistedThread): Promise<void>
  /** Remove a thread. */
  delete(threadId: string): Promise<void>
}

// ─── Storage adapters ──────────────────────────────────────────────────────

/**
 * In-memory storage adapter. No persistence — data is lost on page reload.
 * Use for testing and SSR environments where localStorage is unavailable.
 *
 * Clones on save/load (via `structuredClone`) so it behaves like a real
 * serialization boundary: callers never share live references with the store,
 * and `Date` objects on `meta` survive the round-trip.
 */
export class MemoryAdapter implements ThreadStorageAdapter {
  private store = new Map<string, PersistedThread>()

  listThreads(): Promise<ThreadMeta[]> {
    return Promise.resolve(Array.from(this.store.values()).map((t) => structuredClone(t.meta)))
  }

  load(threadId: string): Promise<PersistedThread | null> {
    const thread = this.store.get(threadId)
    return Promise.resolve(thread ? structuredClone(thread) : null)
  }

  save(thread: PersistedThread): Promise<void> {
    this.store.set(thread.meta.id, structuredClone(thread))
    return Promise.resolve()
  }

  delete(threadId: string): Promise<void> {
    this.store.delete(threadId)
    return Promise.resolve()
  }
}

/**
 * localStorage-backed storage adapter. Persists threads across page reloads.
 * All threads are stored as a JSON array under a single namespaced key.
 *
 * @param namespace - Key prefix for localStorage. Defaults to `'ag-ui-threads'`.
 */
export class LocalStorageAdapter implements ThreadStorageAdapter {
  private namespace: string

  constructor(namespace = 'ag-ui-threads') {
    this.namespace = namespace
  }

  private get key(): string {
    return `${this.namespace}:threads`
  }

  /**
   * Read and deserialize every persisted thread, reviving `Date` objects from
   * their JSON string form. Shared by `listThreads`/`load`/`save`/`delete`.
   */
  private readAll(): PersistedThread[] {
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return []
      const parsed = JSON.parse(raw) as PersistedThread[]
      // Restore Date objects from JSON strings
      return parsed.map((p) => ({
        ...p,
        meta: {
          ...p.meta,
          createdAt: new Date(p.meta.createdAt),
          updatedAt: new Date(p.meta.updatedAt),
        },
      }))
    } catch {
      return []
    }
  }

  listThreads(): Promise<ThreadMeta[]> {
    return Promise.resolve(this.readAll().map((p) => p.meta))
  }

  load(threadId: string): Promise<PersistedThread | null> {
    return Promise.resolve(this.readAll().find((p) => p.meta.id === threadId) ?? null)
  }

  save(thread: PersistedThread): Promise<void> {
    const all = this.readAll()
    const idx = all.findIndex((t) => t.meta.id === thread.meta.id)
    if (idx >= 0) {
      all[idx] = thread
    } else {
      all.push(thread)
    }
    localStorage.setItem(this.key, JSON.stringify(all))
    return Promise.resolve()
  }

  delete(threadId: string): Promise<void> {
    const all = this.readAll().filter((t) => t.meta.id !== threadId)
    localStorage.setItem(this.key, JSON.stringify(all))
    return Promise.resolve()
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Default debounce (ms) for persisting direct state mutations. */
const DEFAULT_SAVE_DEBOUNCE_MS = 500

/** Options for switching the active thread on a `useThread`. */
export interface LoadThreadOptions {
  /**
   * Persist the currently-active thread before switching. Defaults to `true`.
   * Set `false` when the outgoing thread is being deleted, so its final write
   * can't race (or lose to) the delete and resurrect it.
   */
  persistOutgoing?: boolean
}

/** The later of two timestamps. `updatedAt` is activity, so it never moves back. */
function latest(a: Date, b: Date): Date {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

// ─── useThread ─────────────────────────────────────────────────────────────

export interface UseThreadOptions {
  /**
   * Initial thread ID to hydrate. Pass `null` for no active thread (the agent
   * stays empty until `load(id)` is called). A standalone `useThread` passes a
   * concrete id here.
   */
  id: string | null
  /** Storage adapter */
  adapter: ThreadStorageAdapter
  /** Auto-generate title from first user message. Default true */
  autoTitle?: boolean
  /** Default state applied to a thread that has no persisted state (new threads) */
  initialState?: unknown
  /**
   * Debounce (ms) before a direct `state` mutation (or `v-model` edit) is
   * persisted to the adapter. Default 500. Set to 0 to persist on the next tick.
   */
  saveDebounceMs?: number
  /** Called when thread metadata changes so the parent can sync its list */
  onMetaChange?: (meta: ThreadMeta) => void
}

export interface UseThreadReturn {
  /** Reactive message array */
  messages: DeepReadonly<Ref<Message[]>>
  /** Message id → the run id of the turn that produced it (live or hydrated) */
  messageRuns: Readonly<Ref<ReadonlyMap<string, string>>>
  /** The run id of the turn that produced a message, if known */
  runForMessage: (messageId: string) => string | undefined
  /** Whether the agent is currently running */
  isRunning: Readonly<Ref<boolean>>
  /** Whether the active thread is still hydrating its persisted state */
  isLoading: Readonly<Ref<boolean>>
  /** Latest error, or null. Combines run errors and storage (load/save) errors. */
  error: Readonly<Ref<string | null>>
  /**
   * Machine-readable code for `error` (see `UseAgentReturn.errorCode`). Follows
   * `error`'s precedence: the run error's code when a run error is shown,
   * `null` for storage (load/save) errors, which carry no code.
   */
  errorCode: Readonly<Ref<string | null>>
  /** How the most recent run ended (see `UseAgentReturn.lastOutcome`). Storage errors don't affect it. */
  lastOutcome: Readonly<Ref<RunOutcome | null>>
  /** Token usage reported for the most recent run (see `UseAgentReturn.usage`). */
  usage: Readonly<Ref<readonly TokenUsage[] | null>>
  /** Live streaming content of the current assistant message */
  streamingContent: Readonly<Ref<string>>
  /**
   * Send a user message and run the agent. Awaits hydration first, so the run
   * always sees the persisted state — never the empty default.
   */
  send: (content: string | ContentPart[], runOptions?: RunOptions) => Promise<void>
  /** Continue a run without adding a new user message. Awaits hydration first. */
  continueRun: (runOptions?: RunOptions) => Promise<void>
  /** Abort the current run */
  abort: () => void
  /** Reset the conversation */
  reset: () => void
  /**
   * Switch the active thread on the *same* agent: persist the outgoing thread
   * (unless opted out), abort its run, then hydrate `id` (or clear when `null`).
   * The single agent instance — and every subscription/middleware attached to
   * it — is preserved across the switch.
   */
  load: (id: string | null, options?: LoadThreadOptions) => Promise<void>
  /** The injected HttpAgent instance, for advanced usage */
  agent: HttpAgent
  /** Writable reactive shared state — mutate it directly to sync to the agent */
  state: any
  /** Active thread metadata (id, title, timestamps), or `null` when no thread is active */
  meta: DeepReadonly<Ref<ThreadMeta | null>>
  /** Set a new title for the active thread */
  updateTitle: (title: string) => Promise<void>
  /**
   * Adopt metadata read back from the adapter for the active thread, e.g. a
   * title the server generated after the first send, so the next save doesn't
   * overwrite it. The adapter's title wins unless a local rename is still
   * unsaved. `updatedAt` only moves forward. Ignored for any other thread id.
   * Returns the resulting meta, or `null` when it was ignored.
   */
  adoptMeta: (meta: ThreadMeta) => ThreadMeta | null
}

/**
 * Single-thread composable. Layers persistence (hydration + saving) and
 * auto-titling onto an **injected** agent — the consumer constructs the
 * `HttpAgent` via `useAgent` and passes the result in, so tools, events, and
 * middleware attach to the same stable instance.
 *
 * State binds **once** to the injected agent (a single `useAgentState`). On a
 * thread switch (`load`) the persisted state is **re-applied** into that same
 * store — never re-instantiated — so the stream is subscribed exactly once and
 * survives switches.
 *
 * Hydration is applied by *mutation*: the loaded state is written into the
 * reactive `state` object, which trips `useAgentState`'s outbound deep watch and
 * pushes it to `agent.setState`. `send` / `continueRun` await hydration so a run
 * never executes against the empty default.
 *
 * @example
 * ```ts
 * const agent = useAgent({ url: '/api/agent' })
 * const thread = useThread(agent, {
 *   id: 'thread_123',
 *   adapter: new LocalStorageAdapter('my-app'),
 * })
 * // thread.send(), thread.messages, thread.load('other-thread'), …
 * ```
 */
export function useThread(
  agentContext: UseAgentReturn,
  options: UseThreadOptions,
): UseThreadReturn {
  const {
    id: initialId,
    adapter,
    autoTitle = true,
    initialState,
    saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
    onMetaChange,
  } = options

  const { agent, isRunning, streamingContent, abort, setMessages } = agentContext
  const messages = agentContext.messages

  // Bind state ONCE to the injected agent. It is re-applied (not re-created) on
  // every switch — see applyState — so the STATE_SNAPSHOT/DELTA subscription is
  // set up a single time and survives thread switches.
  const { state } = useAgentState(agent, { initialState: initialState as any })

  // The active thread id. `null` = no active thread (agent left empty).
  let activeId: string | null = null

  // Meta of the active thread. `null` while no thread is active.
  const meta = ref<ThreadMeta | null>(null)

  // Storage errors (load/save) are surfaced alongside run errors on one ref.
  const storageError = ref<string | null>(null)
  const error = computed(() => agentContext.error.value ?? storageError.value)
  const errorCode = computed(() => (agentContext.error.value != null ? agentContext.errorCode.value : null))

  const isLoading = ref(true)

  // Set when a load() rejects. We then never persist that thread: a write would
  // overwrite an authoritative thread we failed to read with our empty defaults.
  let loadFailed = false

  // Baseline of what is on disk for the active thread: the serialized content
  // (transcript + state + provenance + interrupts) and the title. `persist()`
  // compares against it, so merely visiting a thread, an inbound STATE_DELTA that
  // matches disk, or hydration itself never writes — and never re-stamps
  // `updatedAt`. `null` content = not on disk yet (a never-saved thread).
  let lastSavedContent: string | null = null
  let lastSavedTitle: string | null = null

  /** The persisted payload minus `meta`, for both the write and the baseline. */
  function contentPayload(): Omit<PersistedThread, 'meta'> {
    return {
      messages: [...agent.messages],
      // JSON-strip the (proxy-backed) state. Safe because AG-UI state is JSON
      // over the wire — see stripState.
      state: stripState(state),
      messageRuns: Object.fromEntries(agentContext.messageRuns.value),
      ...(agentContext.interrupts.value.length && { interrupts: [...agentContext.interrupts.value] }),
    }
  }

  /**
   * Replace the reactive `state` in place with the persisted state — or reset it
   * to `initialState` when the thread has none (a new thread persists
   * `state: null`). Full replace, not merge: drop keys the incoming state lacks
   * before assigning, matching `useAgentState`'s adopt-external-state semantics.
   *
   * Critical for switching: with one persistent store, a `null`-state thread
   * MUST reset to the default rather than no-op, or the previous thread's state
   * leaks in (the classic stale-carry-over bug). The mutation trips the outbound
   * deep watch, pushing the applied state to `agent.setState`.
   */
  function applyState(incoming: unknown): void {
    const source = isPlainObject(incoming)
      ? incoming
      : isPlainObject(initialState)
        ? (initialState as Record<string, unknown>)
        : {}
    // stripState clones so we never share references with the caller's object /
    // initialState; replaceInPlace mutates `state` so the outbound deep watch fires.
    replaceInPlace(state as Record<string, unknown>, stripState(source))
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Write the active thread to the adapter if it diverged from the baseline. No-
   * ops when there is no active thread or its load failed (we'd only clobber the
   * real thread with defaults), and when nothing changed since the last write.
   *
   * `updatedAt` means "last activity", not "last saved": it advances only when
   * the content (messages or state) changed — a rename is written without it —
   * and only once the write succeeded, so a failed save never reorders the list.
   */
  async function persist(): Promise<void> {
    if (loadFailed || meta.value === null) return
    const payload = contentPayload()
    const content = JSON.stringify(payload)
    const contentChanged = content !== lastSavedContent
    if (!contentChanged && meta.value.title === lastSavedTitle) return

    const threadId = meta.value.id
    // Spread, never pass `meta.value` itself: it is a reactive proxy, and the
    // adapter may structuredClone what it receives.
    const savedMeta = {
      ...meta.value,
      updatedAt: contentChanged ? new Date() : meta.value.updatedAt,
    }
    try {
      await adapter.save({ meta: savedMeta, ...payload })
    } catch (e) {
      storageError.value = e instanceof Error ? e.message : 'Failed to save thread'
      return
    }
    storageError.value = null
    // A switch may have started while the write was in flight (run-end and
    // debounced saves aren't awaited). The list still learns the new timestamp,
    // but the baseline and `meta` belong to the incoming thread now.
    let listedMeta = savedMeta
    if (activeId === threadId && meta.value?.id === threadId) {
      // Advance the baseline ONLY after a successful write. Doing it before the
      // await would, on a rejected save, mark never-persisted content as saved —
      // the next identical save would then be skipped and lost.
      lastSavedContent = content
      lastSavedTitle = savedMeta.title
      // Keep a title set while the write was in flight; take the new timestamp.
      meta.value = listedMeta = { ...meta.value, updatedAt: savedMeta.updatedAt }
    }
    if (contentChanged) onMetaChange?.(listedMeta)
  }

  // Debounced save for direct state mutations / v-model edits (the v2 primary
  // way state changes), so an edit persists even without a run.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, saveDebounceMs)
  }

  // Persist after each completed run (messages + state may have changed).
  // Suppressed while loading (a switch resets isRunning mid-hydration; without
  // this guard the reset would persist the already-cleared messages).
  watch(isRunning, (running, wasRunning) => {
    if (!running && wasRunning && !isLoading.value && activeId !== null) {
      void persist()
    }
  })

  // Persist direct state edits (debounced). Suppressed until hydration is done
  // so the hydration mutation itself does not schedule a redundant write.
  watch(
    state,
    () => {
      if (isLoading.value || activeId === null) return
      scheduleSave()
    },
    { deep: true },
  )

  // ── Hydration / switching ──────────────────────────────────────────────────

  // Monotonic token guarding against out-of-order loads: a slow adapter.load for
  // thread A must not apply after a newer switch to thread B superseded it.
  let hydrateToken = 0

  // The in-flight (or most recent) hydration. `send`/`continueRun` await it so a
  // run never executes against a half-loaded thread.
  let hydration: Promise<void>

  async function doLoad(id: string | null, opts?: LoadThreadOptions): Promise<void> {
    const token = ++hydrateToken
    // Guard watchers for the whole swap (persist-outgoing + reset + hydrate).
    isLoading.value = true

    // Persist the outgoing thread while its meta/messages are still intact —
    // BEFORE reset() clears them. Skipped for a thread being deleted.
    if (opts?.persistOutgoing !== false && activeId !== null && !loadFailed) {
      // Flush any pending debounced edit so it isn't lost to the timer.
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      // A no-op when the visit changed nothing — see persist().
      await persist()
      if (token !== hydrateToken) return // superseded mid-persist
    }

    // Abort the outgoing run and clear the conversation. Reuses useAgent's
    // reset/invalidate path (bumps its runToken) — never tears down the agent.
    agentContext.reset()
    loadFailed = false
    storageError.value = null
    activeId = id

    if (id === null) {
      // No active thread: reset state to the default and go quiet.
      applyState(null)
      meta.value = null
      lastSavedContent = null
      lastSavedTitle = null
      isLoading.value = false
      return
    }

    // Point the agent at the new thread directly. We bypass useAgent's
    // threadId-option watcher on purpose — it would call reset() and wipe the
    // state we are about to apply. The threads layer owns switching.
    agent.threadId = id

    let onDisk = false
    try {
      const persisted = await adapter.load(id)
      if (token !== hydrateToken) return // superseded by a newer load
      onDisk = persisted !== null
      if (persisted) {
        meta.value = persisted.meta
        // Restore run provenance and open interrupts alongside the transcript, so
        // a reloaded thread answers runForMessage and resumes like a live one.
        if (persisted.messages?.length || persisted.interrupts?.length) {
          setMessages([...(persisted.messages ?? [])], persisted.messageRuns, persisted.interrupts)
        }
        applyState(persisted.state)
      } else {
        meta.value = { id, title: null, createdAt: new Date(), updatedAt: new Date() }
        applyState(null)
      }
    } catch (e) {
      if (token !== hydrateToken) return
      // A failed load leaves the thread usable on its default state rather than
      // hanging on isLoading. Surface the error and block persistence so we
      // don't overwrite the thread we couldn't read.
      loadFailed = true
      storageError.value = e instanceof Error ? e.message : 'Failed to load thread'
    } finally {
      if (token === hydrateToken) {
        // Baseline reflects what is on disk now, so the first real change is
        // what triggers the next save — not the hydration mutation, nor leaving
        // the thread again. A thread not on disk yet keeps a null baseline, so
        // its first persist creates it.
        lastSavedContent = onDisk ? JSON.stringify(contentPayload()) : null
        lastSavedTitle = meta.value?.title ?? null
        isLoading.value = false
      }
    }
  }

  function load(id: string | null, opts?: LoadThreadOptions): Promise<void> {
    hydration = doLoad(id, opts)
    return hydration
  }

  // Hydrate the initial thread. persistOutgoing:false — there is nothing before it.
  hydration = doLoad(initialId, { persistOutgoing: false })

  // ── Actions ──────────────────────────────────────────────────────────────

  async function updateTitle(title: string): Promise<void> {
    await hydration
    if (!meta.value) return
    meta.value = { ...meta.value, title }
    // A rename is not activity: the list updates the title without reordering,
    // and persist() writes it without re-stamping `updatedAt`.
    onMetaChange?.(meta.value)
    await persist()
  }

  function adoptMeta(incoming: ThreadMeta): ThreadMeta | null {
    if (isLoading.value || meta.value?.id !== incoming.id) return null
    // An unsaved local title (auto-title before the run ends, a rename in
    // flight) is about to be written — keep it rather than revert it.
    const titleUnsaved = meta.value.title !== lastSavedTitle
    const title = titleUnsaved ? meta.value.title : incoming.title
    if (!titleUnsaved) lastSavedTitle = incoming.title
    meta.value = {
      ...meta.value,
      title,
      createdAt: incoming.createdAt,
      updatedAt: latest(meta.value.updatedAt, incoming.updatedAt),
    }
    return meta.value
  }

  async function send(content: string | ContentPart[], runOptions?: RunOptions): Promise<void> {
    // Gate: never run before the persisted state has been loaded and applied.
    await hydration
    // Auto-title from the first user message
    if (autoTitle && meta.value && meta.value.title === null) {
      const title =
        typeof content === 'string'
          ? content.trim().slice(0, 60)
          : (content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined)
              ?.text.slice(0, 60) ?? 'Attachment'
      meta.value = { ...meta.value, title }
      onMetaChange?.(meta.value)
    }
    return agentContext.send(content, runOptions)
  }

  async function continueRun(runOptions?: RunOptions): Promise<void> {
    await hydration
    return agentContext.continueRun(runOptions)
  }

  function reset() {
    agentContext.reset()
    if (activeId !== null && !isLoading.value) void persist()
  }

  // Final flush on unmount (replaces the old manual dispose()). The injected
  // agent is owned by the consumer — its own onScopeDispose tears it down.
  onScopeDispose(() => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!isLoading.value && !loadFailed && activeId !== null) void persist()
  })

  return {
    messages,
    messageRuns: agentContext.messageRuns,
    runForMessage: agentContext.runForMessage,
    isRunning,
    isLoading: readonly(isLoading),
    error,
    errorCode,
    lastOutcome: agentContext.lastOutcome,
    usage: agentContext.usage,
    streamingContent,
    send,
    continueRun,
    abort,
    reset,
    load,
    agent,
    state,
    meta: readonly(meta) as DeepReadonly<Ref<ThreadMeta | null>>,
    updateTitle,
    adoptMeta,
  }
}

// ─── useThreads ────────────────────────────────────────────────────────────

export interface UseThreadsOptions {
  /**
   * Storage adapter for persisting threads.
   * Defaults to `new LocalStorageAdapter()`.
   */
  adapter?: ThreadStorageAdapter
  /** Auto-generate title from first user message. Default true */
  autoTitle?: boolean
  /**
   * Default shared state for threads that have no persisted state (i.e. newly
   * created ones). Forwarded to the underlying `useAgentState`. Provide the
   * shape your app mutates (e.g. `{ items: [] }`) so the first nested mutation
   * on a new thread has a key to write into.
   */
  initialState?: unknown
  /** Debounce (ms) before a direct state mutation is persisted. Default 500. */
  saveDebounceMs?: number
  /**
   * Restore a specific thread on init.
   * If omitted, the most-recently-updated thread is restored (or a new one is created).
   */
  initialThreadId?: string
  /**
   * Generate IDs for new threads, applied to **every** creation.
   * A per-call `createThread(id)` argument takes precedence over this. When
   * omitted, IDs default to the built-in `thread_<ts>_<rand>` scheme.
   *
   * @example
   * // All threads are UUIDs — no per-call wiring needed.
   * useThreads(agent, { idFactory: () => crypto.randomUUID() })
   */
  idFactory?: () => string
}

export interface UseThreadsReturn {
  /** All thread metadata, sorted by most-recently-updated first. */
  threads: DeepReadonly<Ref<ThreadMeta[]>>
  /** Currently active thread ID */
  activeThreadId: Readonly<Ref<string | null>>
  /**
   * Metadata of the active thread, or `null` when none is active. Use this for
   * "which conversation is open" rather than `threads[0]`, which is only the
   * one with the most recent activity.
   */
  activeThread: ComputedRef<DeepReadonly<ThreadMeta> | null>
  /**
   * Whether the manager is initializing (loading the thread list) or the active
   * thread is still hydrating its persisted state.
   */
  isLoading: ComputedRef<boolean>

  // ── Re-exported from the active thread ──
  messages: ComputedRef<Message[]>
  /** Message id → the run id of the turn that produced it (live or hydrated) */
  messageRuns: Readonly<Ref<ReadonlyMap<string, string>>>
  /** The run id of the turn that produced a message, if known */
  runForMessage: (messageId: string) => string | undefined
  isRunning: ComputedRef<boolean>
  error: ComputedRef<string | null>
  /** Machine-readable code for `error`; `null` for storage errors. */
  errorCode: ComputedRef<string | null>
  /** How the most recent run ended (see `UseAgentReturn.lastOutcome`). */
  lastOutcome: ComputedRef<RunOutcome | null>
  /** Token usage reported for the most recent run (see `UseAgentReturn.usage`). */
  usage: ComputedRef<readonly TokenUsage[] | null>
  streamingContent: ComputedRef<string>
  /**
   * Writable reactive state of the active thread.
   * Mutate it directly to sync to the agent.
   */
  state: ComputedRef<any>
  send: (content: string | ContentPart[], runOptions?: RunOptions) => Promise<void>
  continueRun: (runOptions?: RunOptions) => Promise<void>
  abort: () => void
  reset: () => void

  // ── Thread management ──
  /**
   * Create a new thread, switch to it, and resolve with its ID. Pass an `id` to
   * use it as-is; otherwise the configured `idFactory` (or the built-in default)
   * generates one.
   */
  createThread: (id?: string) => Promise<string>
  /** Switch the active thread (the new thread hydrates asynchronously) */
  switchThread: (id: string) => void
  /** Delete a thread (switches to another thread if it was active) */
  deleteThread: (id: string) => Promise<void>
  /** Update the title of any thread by ID */
  updateTitle: (id: string, title: string) => Promise<void>
  /**
   * Re-read the thread list from the adapter, e.g. to pick up a title the
   * server generated after the first send or threads created elsewhere. The
   * adapter's titles win and `updatedAt` only moves forward. The active thread,
   * and any thread still being created, stay listed even if the adapter doesn't
   * list them (yet). Rejects when `listThreads()` does, leaving the list as is.
   */
  refresh: () => Promise<void>
}

/**
 * Multi-thread manager composable, built on an **injected** agent.
 *
 * The consumer constructs the agent (`useAgent`) and passes it in; `useThreads`
 * layers thread management beside it. Only one live conversation exists at a
 * time — switching swaps the conversation's contents on that one stable
 * instance rather than recreating it, so tools / events / middleware wired
 * against the agent keep working across switches.
 *
 * Initialization is asynchronous (the thread list is loaded from the adapter),
 * so `threads` / `activeThreadId` populate after the returned object is created.
 * Observe `isLoading` for the in-flight window.
 *
 * > `threadId` is owned by this layer while it is in use — do **not** also pass
 * > a reactive `threadId` to the `useAgent` that backs it.
 *
 * @example
 * ```ts
 * const agent = useAgent({ url: '/api/agent' })
 * const {
 *   threads, activeThreadId, isLoading,
 *   messages, isRunning, send, abort,
 *   createThread, switchThread, deleteThread,
 * } = useThreads(agent, { adapter: new LocalStorageAdapter('my-app') })
 * ```
 */
export function useThreads(
  agentContext: UseAgentReturn,
  options: UseThreadsOptions = {},
): UseThreadsReturn {
  const {
    adapter = new LocalStorageAdapter(),
    autoTitle = true,
    initialState,
    saveDebounceMs,
    initialThreadId,
    idFactory,
  } = options

  // Resolve the ID for a new thread. Precedence:
  // 1) explicit per-call arg  2) configured idFactory  3) built-in fallback.
  function nextThreadId(explicitId?: string): string {
    return (
      explicitId ?? idFactory?.() ?? `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    )
  }

  const threads = ref<ThreadMeta[]>([])
  const activeThreadId = ref<string | null>(null)
  // True while loading the thread list during init.
  const initializing = ref(true)

  function sortByUpdated(metas: ThreadMeta[]): ThreadMeta[] {
    return [...metas].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }

  function syncMetaInList(newMeta: ThreadMeta) {
    const idx = threads.value.findIndex((t) => t.id === newMeta.id)
    if (idx >= 0) {
      const updated = [...threads.value.slice(0, idx), newMeta, ...threads.value.slice(idx + 1)]
      threads.value = sortByUpdated(updated)
    }
  }

  // One stable thread bound to the injected agent for the whole lifetime.
  const thread = useThread(agentContext, {
    id: null,
    adapter,
    autoTitle,
    initialState,
    saveDebounceMs,
    onMetaChange: syncMetaInList,
  })

  // Threads listed locally whose initial save hasn't resolved yet. refresh()
  // keeps them even though the adapter can't list them yet.
  const creating = new Set<string>()
  // Threads deleted while the current refresh() was in flight. Its list may have
  // been read before the delete; re-adding them would let a later visit's save
  // write them back to the adapter.
  const deletedSinceRefresh = new Set<string>()

  async function createThread(id?: string): Promise<string> {
    const newId = nextThreadId(id)
    const meta: ThreadMeta = {
      id: newId,
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    threads.value = [meta, ...threads.value]
    creating.add(newId)
    try {
      // Persist before switching so the thread's own load() finds it.
      await adapter.save({ meta, messages: [], state: null })
    } finally {
      creating.delete(newId)
    }
    switchThread(newId)
    return newId
  }

  function switchThread(id: string) {
    if (activeThreadId.value === id) return
    // Highlight immediately; the conversation hydrates in the background.
    activeThreadId.value = id
    void thread.load(id)
  }

  async function deleteThread(id: string): Promise<void> {
    if (activeThreadId.value === id) {
      // Switch away FIRST (skipping the outgoing save — this thread is doomed),
      // then delete. Ordering delete last means no save can resurrect it.
      const next = threads.value.find((t) => t.id !== id)?.id ?? null
      activeThreadId.value = next
      await thread.load(next, { persistOutgoing: false })
    }
    await adapter.delete(id)
    deletedSinceRefresh.add(id)
    threads.value = threads.value.filter((t) => t.id !== id)
  }

  async function updateTitle(id: string, title: string): Promise<void> {
    if (activeThreadId.value === id) {
      await thread.updateTitle(title)
    } else {
      const persisted = await adapter.load(id)
      if (persisted) {
        const updated: PersistedThread = {
          ...persisted,
          // A rename is not activity — keep `updatedAt` so the list doesn't reorder.
          meta: { ...persisted.meta, title },
        }
        await adapter.save(updated)
        syncMetaInList(updated.meta)
      }
    }
  }

  // Monotonic token: an older refresh() resolving late must not overwrite a newer one.
  let refreshToken = 0

  async function refresh(): Promise<void> {
    const token = ++refreshToken
    deletedSinceRefresh.clear()
    const listed = (await adapter.listThreads()).filter((t) => !deletedSinceRefresh.has(t.id))
    if (token !== refreshToken) return

    const local = new Map(threads.value.map((t) => [t.id, t]))
    const merged = listed.map((incoming) => {
      if (incoming.id === activeThreadId.value) {
        const adopted = thread.adoptMeta(incoming)
        if (adopted) return adopted
      }
      const known = local.get(incoming.id)
      return known
        ? { ...incoming, updatedAt: latest(known.updatedAt, incoming.updatedAt) }
        : incoming
    })
    const listedIds = new Set(listed.map((t) => t.id))
    const kept = threads.value.filter(
      (t) => !listedIds.has(t.id) && (t.id === activeThreadId.value || creating.has(t.id)),
    )
    threads.value = sortByUpdated([...merged, ...kept])
  }

  // Initialize asynchronously: load the thread list, then restore the specified
  // thread, the most-recent one, or create a fresh thread.
  async function init(): Promise<void> {
    try {
      threads.value = sortByUpdated(await adapter.listThreads())
    } catch {
      // A failed list load starts empty; createThread below recovers.
      threads.value = []
    }

    if (initialThreadId && threads.value.some((t) => t.id === initialThreadId)) {
      switchThread(initialThreadId)
    } else if (threads.value.length > 0) {
      switchThread(threads.value[0].id)
    } else {
      await createThread()
    }
    initializing.value = false
  }
  void init()

  return {
    threads: readonly(threads),
    activeThreadId: readonly(activeThreadId),
    activeThread: computed(() => {
      const active = threads.value.find((t) => t.id === activeThreadId.value)
      return active ? readonly(active) : null
    }),
    isLoading: computed(() => initializing.value || thread.isLoading.value),

    messages: computed(() => thread.messages.value as Message[]),
    messageRuns: thread.messageRuns,
    runForMessage: thread.runForMessage,
    isRunning: computed(() => thread.isRunning.value),
    error: computed(() => thread.error.value),
    errorCode: computed(() => thread.errorCode.value),
    lastOutcome: computed(() => thread.lastOutcome.value),
    usage: computed(() => thread.usage.value),
    streamingContent: computed(() => thread.streamingContent.value),
    state: computed(() => thread.state),

    send: (content, runOptions) =>
      activeThreadId.value === null ? Promise.resolve() : thread.send(content, runOptions),
    continueRun: (runOptions) =>
      activeThreadId.value === null ? Promise.resolve() : thread.continueRun(runOptions),
    abort: () => thread.abort(),
    reset: () => thread.reset(),

    createThread,
    switchThread,
    deleteThread,
    updateTitle,
    refresh,
  }
}
