import { onScopeDispose, ref } from 'vue'
import { randomUUID } from '@ag-ui/client'
import type { HttpAgent, AgentSubscriber } from '@ag-ui/client'
import type { Tool, Message } from '@ag-ui/core'
import type {
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from '@ag-ui/core'

/**
 * A frontend tool registered with the shared coordinator. The owning composable
 * (`useFrontendTool` / `useGenerativeUI`) supplies the tool definition, a fresh
 * read of its enabled state, and lifecycle callbacks the coordinator dispatches
 * as the matching tool call streams in.
 */
export interface RegisteredTool {
  /** The AG-UI tool definition (a `markRaw`'d plain object). */
  tool: Tool
  /** Reads the tool's current enabled state. Checked on every TOOL_CALL_START. */
  isEnabled: () => boolean
  /** A matching tool call started streaming. */
  onStart?: (id: string) => void
  /** An args delta arrived; receives the full accumulated raw string so far. */
  onArgs?: (id: string, args: string) => void
  /** Args finished streaming; receives the parsed args (`{}` if unparseable). */
  onEnd?: (id: string, parsedArgs: any) => void
  /**
   * A tracked call is being abandoned without the tool resolving it — the run
   * errored, the conversation was reset/aborted, or a result arrived elsewhere.
   * The owner should finalize that call's UI (e.g. flip it out of a spinner).
   */
  onTerminate?: (id: string) => void
  /**
   * Whether resolving this tool should trigger a follow-up LLM turn via
   * `continueRun`. Default: `true`.
   *
   * Set to `false` for pure UI side-effect tools (e.g. `setDarkMode`) that
   * don't need the model to respond after execution. When every tool resolved
   * in a turn is `followUp: false`, `continueRun` is not called — saving an
   * unnecessary round-trip. A validation-error result always forces the
   * follow-up regardless of this setting (so the model can self-correct).
   */
  followUp?: boolean
}

type ContinueRun = (runOptions?: { tools?: any[]; context?: any[] }) => void

/**
 * The shared frontend-tool coordinator. Owns the single TOOL_CALL_* subscription
 * for an agent, dispatches lifecycle to registered tools by name, batches their
 * results, and fires exactly one `continueRun` per turn.
 */
export interface ToolRegistry {
  /** Register a tool; returns an unregister function. */
  register: (entry: RegisteredTool) => () => void
  /** Enabled registered tool definitions, as a fresh plain array. */
  enabledTools: () => Tool[]
  /**
   * Merge enabled registered tools with an explicit list. Explicit entries
   * override registered ones of the same name (escape hatch / extension).
   */
  mergeTools: (explicit?: Tool[]) => Tool[]
  /**
   * Submit a tool result for a call id and re-evaluate the continue gate. Owns
   * the `agent.addMessage` so result submission flows through one place.
   *
   * @param opts.forceFollowUp - Force a follow-up LLM turn even if the tool's
   *   `followUp` is `false`. Used for validation errors so the model can
   *   self-correct regardless of the tool's normal follow-up setting.
   */
  submitResult: (id: string, content: string, error?: string, opts?: { forceFollowUp?: boolean }) => void
  /** Whether a result already exists for the id (dedupe guard). */
  hasResult: (id: string) => boolean
  /**
   * Abandon the current turn: terminate every unresolved call (so owners can
   * finalize their UI) and clear turn state. Called by `useAgent` on
   * `reset()`/`abort()` so an in-flight handler can't write into a discarded
   * conversation.
   */
  abandonTurn: () => void
  /**
   * Whether a frontend call of the current turn still awaits its result (e.g.
   * an unanswered HITL call). After an `interrupt` outcome the turn stays open,
   * so `useInterrupts` holds the resume until these are answered. Reactive:
   * safe to read inside a `computed`.
   */
  hasUnresolvedCalls: () => boolean
  /** Tear down the coordinator's event subscription. */
  dispose: () => void
}

/**
 * Registries are keyed by agent so sibling composables that only receive the
 * agent (via the `useAgent` return) discover the same coordinator without it
 * being threaded through the public return type.
 */
const registries = new WeakMap<object, ToolRegistry>()

/** Return the coordinator bound to `agent`, if one has been created. */
export function getToolRegistry(agent: object): ToolRegistry | undefined {
  return registries.get(agent)
}

/**
 * Create the shared frontend-tool coordinator for an agent and attach it so
 * sibling composables (`useFrontendTool`, `useGenerativeUI`) discover it via
 * {@link getToolRegistry}.
 *
 * **Coordination model.** Per turn the coordinator tracks every registered,
 * enabled tool call it sees (`expected`, recorded on START) and every call
 * whose result has been submitted (`resolved`). It fires exactly one
 * `continueRun` when **both** the run has finished **and** every `expected` id
 * is `resolved` — whichever becomes true last triggers it. Automatic and GenUI
 * tools resolve synchronously at run-finish; HITL tools resolve later (when the
 * user responds), so the gate naturally waits for the human before continuing.
 *
 * Normally `useAgent` creates this eagerly; the get-or-create in the tool
 * composables only fires when a tool is used against a bare/mocked context.
 *
 * @param agent - The HttpAgent to coordinate.
 * @param opts.continueRun - Called once per turn to resume the run.
 */
export function createToolRegistry(
  agent: HttpAgent,
  opts: { continueRun: ContinueRun },
): ToolRegistry {
  const tools = new Map<string, RegisteredTool>()

  // --- Per-turn coordination state (plain, non-reactive) ---
  const callName = new Map<string, string>() // call id → tool name (registered calls only)
  const callArgs = new Map<string, string>() // call id → accumulated raw args
  const callFollowUp = new Map<string, boolean>() // call id → followUp value captured at START
  const expected = new Set<string>() // registered+enabled call ids seen this turn
  const resolved = new Set<string>() // ids whose result has been submitted
  const needsFollowUp = new Set<string>() // resolved ids that want a continueRun

  let runFinished = false
  let continued = false

  // The one reactive mirror of turn state: whether any expected call is still
  // unresolved, so `useInterrupts.canResume` can track it. Re-synced wherever
  // `expected`/`resolved` change.
  const unresolved = ref(false)
  function syncUnresolved() {
    unresolved.value = [...expected].some((id) => !resolved.has(id))
  }

  function resetTurn() {
    callName.clear()
    callArgs.clear()
    callFollowUp.clear()
    expected.clear()
    resolved.clear()
    needsFollowUp.clear()
    runFinished = false
    continued = false
    syncUnresolved()
  }

  // Tell owners to finalize each still-unresolved call, then drop turn state.
  // Used both when a turn is explicitly abandoned (run error, reset, abort) and
  // at every RUN_STARTED boundary: a new run that begins while a prior call is
  // still unresolved (e.g. an unanswered HITL call the user left pending and
  // then sent a fresh message) must terminate that call rather than silently
  // dropping it — otherwise its card stays stuck pending and a late response is
  // swallowed by submitResult's expected-id guard. When the prior turn resolved
  // cleanly (the normal case), the loop finds nothing to terminate and this is
  // equivalent to a bare reset.
  function abandonTurn() {
    for (const id of expected) {
      if (!resolved.has(id)) tools.get(callName.get(id) ?? '')?.onTerminate?.(id)
    }
    resetTurn()
  }

  function enabledTools(): Tool[] {
    const out: Tool[] = []
    for (const entry of tools.values()) if (entry.isEnabled()) out.push(entry.tool)
    return out
  }

  function mergeTools(explicit?: Tool[]): Tool[] {
    // Last write wins by name, so an explicit entry overrides a registered one.
    const byName = new Map<string, Tool>()
    for (const t of enabledTools()) byName.set(t.name, t)
    if (explicit) for (const t of explicit) byName.set(t.name, t)
    return [...byName.values()]
  }

  // The single continue gate: run finished AND every expected call resolved.
  // Only fires continueRun when at least one resolved call wants a follow-up
  // (i.e. needsFollowUp is non-empty). A turn where every tool is followUp:false
  // submits results and stops without triggering another LLM turn.
  function maybeContinue() {
    if (continued || !runFinished || expected.size === 0) return
    for (const id of expected) if (!resolved.has(id)) return
    continued = true
    if (needsFollowUp.size > 0) {
      opts.continueRun({ tools: mergeTools() })
    }
  }

  function hasResult(id: string): boolean {
    return (
      resolved.has(id) ||
      agent.messages.some((m) => m.role === 'tool' && (m as any).toolCallId === id)
    )
  }

  function submitResult(
    id: string,
    content: string,
    error?: string,
    submitOpts?: { forceFollowUp?: boolean },
  ) {
    if (resolved.has(id)) return
    // Drop results for a call whose turn was abandoned (reset/abort/error): the
    // id is no longer expected, so a slow handler or late HITL response can't
    // inject a message into a discarded conversation.
    if (!expected.has(id)) return
    const msg: any = {
      id: randomUUID(),
      role: 'tool',
      content,
      toolCallId: id,
    }
    if (error) msg.error = error
    agent.addMessage(msg as Message)
    resolved.add(id)
    syncUnresolved()
    // Determine whether this resolved call should trigger a follow-up LLM turn.
    // forceFollowUp wins (used for validation errors so the model can self-correct),
    // otherwise fall back to the tool's registered followUp setting (default: true).
    if (submitOpts?.forceFollowUp || (callFollowUp.get(id) ?? true)) {
      needsFollowUp.add(id)
    }
    maybeContinue()
  }

  const subscriber: AgentSubscriber = {
    onRunStartedEvent() {
      // Terminate any call the previous turn left unresolved before starting
      // fresh (see abandonTurn). A clean prior turn has nothing to terminate, so
      // this degrades to a plain resetTurn.
      abandonTurn()
    },

    onToolCallStartEvent({ event }) {
      const e = event as ToolCallStartEvent
      const entry = tools.get(e.toolCallName)
      // A disabled tool is neither advertised nor tracked — incoming calls for
      // it are ignored entirely (it never made it into RunAgentInput.tools).
      if (!entry || !entry.isEnabled()) return
      callName.set(e.toolCallId, e.toolCallName)
      callArgs.set(e.toolCallId, '')
      callFollowUp.set(e.toolCallId, entry.followUp ?? true)
      expected.add(e.toolCallId)
      syncUnresolved()
      entry.onStart?.(e.toolCallId)
    },

    onToolCallArgsEvent({ event }) {
      const e = event as ToolCallArgsEvent
      const name = callName.get(e.toolCallId)
      if (!name) return
      const acc = (callArgs.get(e.toolCallId) ?? '') + e.delta
      callArgs.set(e.toolCallId, acc)
      tools.get(name)?.onArgs?.(e.toolCallId, acc)
    },

    onToolCallEndEvent({ event }) {
      const e = event as ToolCallEndEvent
      const name = callName.get(e.toolCallId)
      if (!name) return
      // If a result already exists (e.g. the backend produced one), don't
      // double-execute. Tell the owner to finalize the call's UI, then drop the
      // expectation so the gate isn't blocked.
      if (hasResult(e.toolCallId)) {
        tools.get(name)?.onTerminate?.(e.toolCallId)
        expected.delete(e.toolCallId)
        syncUnresolved()
        return
      }
      const raw = callArgs.get(e.toolCallId) ?? ''
      let parsed: any = {}
      try {
        parsed = raw ? JSON.parse(raw) : {}
      } catch {
        parsed = {}
      }
      tools.get(name)?.onEnd?.(e.toolCallId, parsed)
    },

    onRunFinishedEvent(params) {
      // Only a successful run may be continued. An absent outcome is a pre-1.0
      // plain completion — the client reports it as `success` too.
      const outcome = params?.outcome ?? 'success'
      // After an `interrupt` outcome the client refuses any run whose `resume[]`
      // doesn't answer the open interrupts, so a plain continueRun would throw.
      // Keep the turn open instead: pending frontend calls stay answerable,
      // their results land in the transcript, and the resume run carries them.
      // runFinished stays false, so submitResult never fires a continuation.
      if (outcome === 'interrupt') return
      // A `cancelled` run has nothing to continue: abandon, finalizing pending calls.
      if (outcome !== 'success') {
        abandonTurn()
        return
      }
      runFinished = true
      maybeContinue()
    },

    onRunErrorEvent() {
      // The run failed mid-flight — abandon, finalizing any pending/HITL calls
      // so their cards don't spin and stale respond/reject closures go dead.
      abandonTurn()
    },
  }

  const subscription = agent.subscribe(subscriber)

  const registry: ToolRegistry = {
    register(entry) {
      tools.set(entry.tool.name, entry)
      return () => {
        if (tools.get(entry.tool.name) === entry) tools.delete(entry.tool.name)
        // A tool whose component unmounted mid-call can't resolve it. Submit an
        // error result rather than dropping the expectation: continuing without
        // a tool-result message for a tool_call is rejected by most backends.
        // submitResult also advances the gate via maybeContinue.
        for (const [id, n] of [...callName]) {
          if (n === entry.tool.name && !resolved.has(id)) {
            submitResult(id, JSON.stringify({ error: 'Tool unregistered' }), 'Tool unregistered')
          }
        }
      }
    },
    enabledTools,
    mergeTools,
    submitResult,
    hasResult,
    abandonTurn,
    hasUnresolvedCalls: () => unresolved.value,
    dispose() {
      subscription.unsubscribe()
    },
  }

  registries.set(agent, registry)
  onScopeDispose(() => {
    subscription.unsubscribe()
    if (registries.get(agent) === registry) registries.delete(agent)
  })

  return registry
}
