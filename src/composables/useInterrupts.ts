import { computed, type ComputedRef } from 'vue'
import type { Interrupt } from '@ag-ui/core'
import type { UseAgentReturn } from './useAgent'
import {
  createInterruptRegistry,
  getInterruptRegistry,
  InterruptError,
  type InterruptRegistry,
} from './interruptRegistry'
import { getToolRegistry } from './toolRegistry'
import type { JsonSchema, PendingDecision, RunOptions } from '../types'

/**
 * Where an interrupt stands: still awaiting an answer, or answered (`resolved`
 * / `cancelled`) and waiting for `resumeAll()` to send the answers.
 */
export type AgentInterruptStatus = 'pending' | 'resolved' | 'cancelled'

/**
 * One interrupt the run paused on, with its own staged answer and the actions
 * to change it. Answers are staged, not sent: the protocol requires a single
 * resume that answers every open interrupt, so nothing reaches the server until
 * `resumeAll()`. Re-answering before then replaces the staged answer.
 */
export interface AgentInterrupt extends PendingDecision {
  kind: 'interrupt'
  /** Interrupt id; what the resume entry answers. */
  id: string
  /**
   * Why the run stopped: `tool_call`, `input_required`, `confirmation`, or any
   * producer-defined string. Render an unknown reason generically from
   * `message` / `responseSchema` / `metadata` — never treat it as an error.
   */
  reason: string
  status: AgentInterruptStatus
  message?: string
  /**
   * For a tool approval, the *server-side* tool call awaiting it. Pair with
   * `useToolCalls` to preview its arguments. On resume the server re-emits the
   * call's result itself — the client only sends a decision.
   */
  toolCallId?: string
  /** Shape of the expected answer; build the resume form from it. */
  responseSchema?: JsonSchema
  /**
   * Whether the answer may carry `editedArgs` (approve-with-edits) — true when
   * `responseSchema` declares that property.
   */
  canEditArgs: boolean
  /** ISO 8601 deadline. An expired interrupt can only be cancelled. */
  expiresAt?: string
  metadata?: Record<string, unknown>
  /** The staged payload, once `resolve`d. */
  payload?: unknown
  /** The interrupt exactly as the protocol delivered it. */
  raw: Interrupt
  /**
   * Stage a `resolved` answer. Rejects with an `InterruptError` if the interrupt
   * has expired, the payload fails `validateResumePayload`, or a run is in
   * flight (`run-in-flight`: answers are frozen until it settles).
   */
  resolve: (payload?: unknown) => Promise<void>
  /**
   * Stage a `cancelled` answer. Allowed once expired too; rejects with a
   * `run-in-flight` `InterruptError` while a run is in flight.
   */
  cancel: () => Promise<void>
}

/** Return type of {@link useInterrupts}. */
export interface UseInterruptsReturn {
  /** The interrupts the thread is paused on, in the order the run reported them. */
  interrupts: ComputedRef<AgentInterrupt[]>
  /** Whether the thread is paused on any interrupt (and so refuses a plain `send`). */
  hasPending: ComputedRef<boolean>
  /**
   * Whether every open interrupt has a staged answer, every frontend tool call
   * from the interrupted run has its result, and no run is in flight.
   */
  canResume: ComputedRef<boolean>
  /**
   * Send every staged answer as one `resume[]` on a new run. Results of
   * frontend tool calls answered meanwhile travel with it in the transcript.
   * Rejects with an `InterruptError` when an interrupt is still unanswered,
   * a frontend tool call is still pending, or a run is already in flight.
   *
   * @param runOptions - Extra parameters for the resume run (context,
   *   forwardedProps, subscriber); `resume` itself is supplied here.
   */
  resumeAll: (runOptions?: Omit<RunOptions, 'resume'>) => Promise<void>
  /**
   * Stage `cancelled` for every open interrupt — e.g. a "dismiss all" action.
   * Rejects with a `run-in-flight` `InterruptError` while a run is in flight.
   */
  cancelAll: () => Promise<void>
}

/**
 * Human-in-the-loop for **server-defined** pauses (AG-UI interrupts).
 *
 * A run can end with `RUN_FINISHED.outcome = interrupt`: the server needs an
 * approval, an edit or an answer before it continues. This composable lists
 * those interrupts, lets each be answered independently, and resumes the run
 * with one `resume[]` covering all of them.
 *
 * Not to be confused with a HITL **frontend** tool (`useFrontendTool` without a
 * handler): there the client *executes* the tool and returns its result; here
 * the client *authorizes* the server to proceed. Both expose the
 * {@link PendingDecision} shape so one approvals view can render either.
 *
 * Any number of `useInterrupts` on one agent share the same staged answers.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const agentCtx = useAgent({ url: '/api/agent' })
 * const { interrupts, canResume, resumeAll } = useInterrupts(agentCtx)
 * </script>
 *
 * <template>
 *   <div v-for="i in interrupts" :key="i.id">
 *     <p>{{ i.message }}</p>
 *     <button @click="i.resolve({ approved: true })">Approve</button>
 *     <button @click="i.resolve({ approved: false })">Deny</button>
 *   </div>
 *   <button :disabled="!canResume" @click="resumeAll()">Continue</button>
 * </template>
 * ```
 *
 * @see https://docs.ag-ui.com/concepts/interrupts
 */
export function useInterrupts(agentContext: UseAgentReturn): UseInterruptsReturn {
  // useAgent creates the coordinator; the fallback covers a bare/mocked context.
  const registry = getInterruptRegistry(agentContext.agent) ?? createInterruptRegistry(agentContext.agent)

  const interrupts = computed(() =>
    registry.open.value.map((raw) => toAgentInterrupt(raw, registry, isLocked)),
  )
  const hasPending = computed(() => registry.open.value.length > 0)
  // A frontend tool call from the interrupted run (e.g. an unanswered HITL
  // card) must be answered first: its result travels with the resume run, and
  // resuming without it would leave the tool call dangling in the transcript.
  const hasPendingFrontendCalls = () =>
    getToolRegistry(agentContext.agent)?.hasUnresolvedCalls() ?? false
  const canResume = computed(
    () =>
      hasPending.value &&
      !agentContext.isRunning.value &&
      !hasPendingFrontendCalls() &&
      registry.open.value.every((i) => registry.responses.value.has(i.id)),
  )

  // Answers are frozen once the resume run is in flight: the thread either
  // moves on or (on error) keeps them for a resubmit.
  function isLocked(): boolean {
    return agentContext.isRunning.value
  }

  async function resumeAll(runOptions?: Omit<RunOptions, 'resume'>): Promise<void> {
    if (!hasPending.value) {
      throw new InterruptError('interrupt-unknown', 'There are no open interrupts to resume')
    }
    // Refuse rather than queue: a second click would re-send the same answers,
    // which by the time they ran are either already applied or being retried.
    if (agentContext.isRunning.value) {
      throw new InterruptError('run-in-flight', 'A run is already in flight; resume once it settles')
    }
    // useAgent refuses a resume while a frontend call is pending ('frontend-calls-pending').
    await agentContext.continueRun({ ...runOptions, resume: registry.buildResume() })
  }

  async function cancelAll(): Promise<void> {
    await Promise.all(interrupts.value.map((i) => i.cancel()))
  }

  return { interrupts, hasPending, canResume, resumeAll, cancelAll }
}

function toAgentInterrupt(
  raw: Interrupt,
  registry: InterruptRegistry,
  isLocked: () => boolean,
): AgentInterrupt {
  const response = registry.responses.value.get(raw.id)
  const responseSchema = raw.responseSchema as JsonSchema | undefined
  return {
    kind: 'interrupt',
    id: raw.id,
    reason: raw.reason,
    status: response?.status ?? 'pending',
    message: raw.message,
    toolCallId: raw.toolCallId,
    responseSchema,
    canEditArgs: !!responseSchema?.properties?.editedArgs,
    expiresAt: raw.expiresAt,
    metadata: raw.metadata,
    payload: response?.status === 'resolved' ? response.payload : undefined,
    raw,
    resolve: async (payload) => {
      assertUnlocked(isLocked)
      await registry.stage(raw.id, { status: 'resolved', payload })
    },
    cancel: async () => {
      assertUnlocked(isLocked)
      await registry.stage(raw.id, { status: 'cancelled' })
    },
  }
}

function assertUnlocked(isLocked: () => boolean) {
  if (isLocked()) {
    throw new InterruptError('run-in-flight', 'A run is in flight; answers are frozen until it settles')
  }
}
