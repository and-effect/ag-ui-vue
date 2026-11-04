import { reactive, watch, onScopeDispose } from 'vue'
import type { HttpAgent, AgentSubscriber } from '@ag-ui/client'
import type { State, StateSnapshotEvent } from '@ag-ui/core'

// ─── State-adoption helpers ──────────────────────────────────────────────────
// Internal (not re-exported from the public barrel). Shared with `useThreads`,
// which imports them from here so the "adopt external state in place" algorithm
// — and the proxy-strip it depends on — live in one place, alongside the state
// composable that owns those semantics.

/**
 * True for a non-null, non-array object — the only shape that can back a
 * `reactive()` state proxy. Non-object seeds (a `null` persisted state, a
 * primitive) fall through to an empty object at the call site.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Strip Vue reactive proxies (and guarantee plain JSON) via a JSON round-trip.
 *
 * AG-UI state is JSON over the wire (STATE_SNAPSHOT, STATE_DELTA, RFC 6902
 * patches are all JSON), so this round-trip is lossless by construction —
 * anything it would corrupt could not have crossed the protocol anyway. It is
 * also the only reliable proxy strip: `structuredClone(toRaw(state))` leaves
 * nested proxies in place (toRaw only unwraps the top level) and throws.
 *
 * Named for its first caller, but the argument — and so the function — applies
 * to any consumer-supplied payload we pass through uninterpreted and the client
 * `structuredClone`s: `useAgent` uses it for `forwardedProps` on the same
 * grounds (`RunAgentInput` is sent as `JSON.stringify(input)`). Those two are the
 * documented exceptions to the "a strip at a call site is a smell" rule in
 * CLAUDE.md; everywhere else, fix the source with `shallowRef`/`markRaw`.
 */
export function stripState<V>(value: V): V {
  return JSON.parse(JSON.stringify(value)) as V
}

/**
 * Replace `target`'s contents with `source` **in place**: drop keys absent from
 * `source`, then assign. Mutating in place (rather than reassigning `state`)
 * preserves the `reactive()` proxy's identity and keeps its deep watchers wired
 * — the whole point of the writable-state model. A full replace (not a merge)
 * so a stale key from a previous snapshot / thread can never leak through.
 *
 * `source` must already be a plain, proxy-free object (see {@link stripState}).
 */
export function replaceInPlace(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key]
  }
  Object.assign(target, source)
}

export interface UseAgentStateOptions<T extends object = Record<string, any>> {
  /**
   * Initial state before the agent responds.
   * This value is also set on the agent so it will be included in
   * RunAgentInput.state on the first run.
   */
  initialState?: T
}

export interface UseAgentStateReturn<T extends object = Record<string, any>> {
  /**
   * Writable reactive shared state. Mutate it directly — a deep watcher
   * syncs every change to `agent.state` so it is sent on the next run.
   *
   * ```ts
   * state.recipe.title = 'Carbonara'
   * state.recipe.ingredients.push('guanciale')
   * ```
   *
   * Backend `STATE_SNAPSHOT` / `STATE_DELTA` events update this same object
   * in place, without re-triggering the outbound sync.
   */
  state: T
}

/**
 * Reactive shared state composable for AG-UI agents.
 *
 * Returns a writable `reactive()` object. Mutate it directly — even deeply —
 * and a deep watcher syncs the change to `agent.state`, so it is included in
 * `RunAgentInput.state` on the next run. This leans on Vue's ability to observe
 * mutations, which is exactly what React's `useState` setter idiom cannot do.
 *
 * Backend `STATE_SNAPSHOT` and `STATE_DELTA` events update the same object in
 * place. To avoid an echo loop — where applying an inbound event mutates the
 * object, the watcher sees the mutation, and syncs it straight back out — the
 * watcher uses `flush: 'sync'` and an `applyingRemote` guard. The synchronous
 * flush keeps the guard valid for the duration of the callback (the default
 * async flush would run the watcher in a later microtask, after the guard had
 * already been reset, and silently echo). Synchronous flush also guarantees
 * that a mutation reaches `agent.state` before any same-tick `send()`.
 *
 * @param agent - The HttpAgent instance from useAgent
 * @param options - Optional configuration
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAgent, useAgentState } from 'ag-ui-vue'
 *
 * interface RecipeState {
 *   recipe: { title: string; ingredients: string[] } | null
 * }
 *
 * const { agent, send } = useAgent({ url: '/api/agent' })
 * const { state } = useAgentState<RecipeState>(agent, {
 *   initialState: { recipe: null },
 * })
 *
 * // Just mutate — the change syncs to the agent automatically.
 * function rename(title) {
 *   state.recipe.title = title
 * }
 * </script>
 *
 * <template>
 *   <input v-model="state.recipe.title" />
 * </template>
 * ```
 */
export function useAgentState<T extends object = Record<string, any>>(
  agent: HttpAgent,
  options: UseAgentStateOptions<T> = {},
): UseAgentStateReturn<T> {
  const { initialState } = options

  // Seed from options.initialState, then agent.state, then empty object.
  // State must be a plain object so it can back a reactive() proxy; non-object
  // seeds (e.g. a null persisted state) fall through to an empty object.
  const seed = isPlainObject(initialState)
    ? initialState
    : isPlainObject(agent.state)
      ? agent.state
      : {}

  // Writable reactive object. Mutating it (even deeply) syncs to agent.state.
  // Clone the seed so we never hold a live proxy over the caller's object.
  const state = reactive(stripState(seed)) as T

  // When true, an inbound backend event is being applied — the deep watcher
  // must NOT sync it back out. Valid only because the watcher flushes 'sync'.
  let applyingRemote = false

  // Only seed the agent when the caller supplied a real initial object. When we
  // fell back to agent.state there is nothing new to push; when we fell back to
  // an empty object there is nothing meaningful to push.
  if (isPlainObject(initialState)) {
    agent.setState(stripState(state) as State)
  }

  // Outbound: every local mutation syncs to the agent. flush: 'sync' keeps the
  // applyingRemote guard valid and guarantees the write lands before the next run.
  watch(
    state,
    () => {
      if (applyingRemote) return
      agent.setState(stripState(state) as State)
    },
    { deep: true, flush: 'sync' },
  )

  // Inbound: replace the contents of `state` in place. A snapshot (and the full
  // state HttpAgent hands us after applying a delta) fully replaces the object,
  // so stale top-level keys are removed and incoming keys assigned.
  function applyIncoming(incoming: unknown): void {
    if (!isPlainObject(incoming)) return
    applyingRemote = true
    try {
      replaceInPlace(state as Record<string, unknown>, incoming)
    } finally {
      applyingRemote = false
    }
  }

  const subscriber: AgentSubscriber = {
    // Only fires for backend STATE_SNAPSHOT events — never for our own
    // agent.setState() calls (those go through onStateChanged, which we ignore).
    onStateSnapshotEvent({ event }) {
      applyIncoming((event as StateSnapshotEvent).snapshot)
    },
    // Only fires for backend STATE_DELTA events. HttpAgent applies the JSON Patch
    // to agent.state before notifying subscribers, so `state` is already final.
    onStateDeltaEvent({ state: incoming }) {
      applyIncoming(incoming)
    },
  }

  const subscription = agent.subscribe(subscriber)

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  return { state }
}
