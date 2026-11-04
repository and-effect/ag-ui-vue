import { computed, onScopeDispose, shallowRef, type ComputedRef } from 'vue'
import { buildResumeArray, isInterruptExpired } from '@ag-ui/client'
import type { AbstractAgent, AgentSubscriber } from '@ag-ui/client'
import type { Interrupt, ResumeEntry } from '@ag-ui/core'
import type { JsonSchema, ValidateResumePayload } from '../types'
import { stripState } from './useAgentState'

/** Why a run or a staged interrupt response was refused before reaching the network. */
export type InterruptErrorCode =
  /** A run without `resume` was started while interrupts are open (spec rule 4). */
  | 'interrupts-pending'
  /** A `resume` does not answer every open interrupt (spec rule 3). */
  | 'resume-incomplete'
  /** A `resume` / response names an interrupt that is not open. */
  | 'interrupt-unknown'
  /** An expired interrupt was answered with anything but `cancelled` (spec rule 7). */
  | 'interrupt-expired'
  /** A payload failed `validateResumePayload` against `responseSchema` (spec rule 6). */
  | 'payload-invalid'
  /** A resume was attempted while a run is in flight; it would be stale by the time it ran. */
  | 'run-in-flight'
  /** A frontend tool call from the interrupted run is still unanswered; resuming would orphan it. */
  | 'frontend-calls-pending'

/**
 * Thrown by `send` / `continueRun` / `resumeAll` and by an interrupt's
 * `resolve` when the interrupt lifecycle would be violated. Raised client-side
 * *before* any request, so it never reaches `onError` and never triggers a
 * retry — unlike the `AGUIError` the client itself would throw.
 */
export class InterruptError extends Error {
  override name = 'InterruptError'

  constructor(
    readonly code: InterruptErrorCode,
    message: string,
    /** The interrupts concerned. */
    readonly interruptIds: string[] = [],
    /** Validator messages, for `payload-invalid`. */
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

/** A staged answer to one interrupt — the client's `buildResumeArray` input. */
export type InterruptResponse =
  | { status: 'resolved'; payload?: unknown }
  | { status: 'cancelled' }

/**
 * Per-agent interrupt coordinator, the sibling of the tool registry. Holds the
 * interrupts the thread is paused on and the responses staged for them, and
 * guards every run against the AG-UI interrupt rules. `useAgent` creates it;
 * `useInterrupts` discovers it via {@link getInterruptRegistry}.
 */
export interface InterruptRegistry {
  /** Interrupts the thread is paused on, as the protocol sent them. */
  open: ComputedRef<readonly Interrupt[]>
  /** Responses staged so far, by interrupt id. */
  responses: ComputedRef<ReadonlyMap<string, InterruptResponse>>
  /**
   * Stage (or replace) the response to one open interrupt. A `resolved`
   * response is refused for an expired interrupt and validated against its
   * `responseSchema` when a validator is configured.
   */
  stage: (interruptId: string, response: InterruptResponse) => Promise<void>
  /** The `resume[]` answering every open interrupt; throws if any is unstaged. */
  buildResume: () => ResumeEntry[]
  /** Throw unless a run carrying `resume` may start now (rules 3, 4, 7). */
  assertRunAllowed: (resume: ResumeEntry[] | undefined) => void
  /**
   * Replace the open interrupts wholesale — `[]` on reset, the persisted list on
   * hydration — keeping the client's own `pendingInterrupts` gate in step.
   */
  restore: (interrupts: readonly Interrupt[]) => void
}

const registries = new WeakMap<object, InterruptRegistry>()

/** Return the interrupt coordinator bound to `agent`, if one has been created. */
export function getInterruptRegistry(agent: object): InterruptRegistry | undefined {
  return registries.get(agent)
}

/**
 * Create the interrupt coordinator for an agent.
 *
 * **Lifecycle.** A `RUN_FINISHED` with an `interrupt` outcome opens its
 * interrupts and drops any staged responses. A `success` or `cancelled` outcome
 * closes them — matching when the client clears its own `pendingInterrupts`. A
 * `RUN_ERROR` leaves them open, so a failed resume can simply be resubmitted.
 *
 * Interrupts are read from the subscriber params, not `agent.pendingInterrupts`:
 * the client writes that field only after every `onRunFinishedEvent` has run.
 *
 * @param opts.validateResumePayload - Optional schema validator for resolved
 *   payloads. Without it the server is the authority on payload shape.
 */
export function createInterruptRegistry(
  agent: AbstractAgent,
  opts: { validateResumePayload?: ValidateResumePayload } = {},
): InterruptRegistry {
  const open = shallowRef<readonly Interrupt[]>([])
  const responses = shallowRef<ReadonlyMap<string, InterruptResponse>>(new Map())

  function setOpen(interrupts: readonly Interrupt[]) {
    open.value = interrupts
    responses.value = new Map()
  }

  const subscriber: AgentSubscriber = {
    onRunFinishedEvent(params) {
      setOpen(params?.outcome === 'interrupt' ? params.interrupts : [])
    },
  }
  const subscription = agent.subscribe(subscriber)

  const registry: InterruptRegistry = {
    open: computed(() => open.value),
    responses: computed(() => responses.value),

    async stage(interruptId, response) {
      const interrupt = findOpen(interruptId)
      const staged = response.status === 'resolved'
        ? await checkedResolution(interrupt, response.payload, opts.validateResumePayload)
        : response
      // The thread may have moved on while an async validator ran.
      if (!open.value.includes(interrupt)) return
      responses.value = new Map(responses.value).set(interruptId, staged)
    },

    buildResume() {
      const missing = open.value.filter((i) => !responses.value.has(i.id)).map((i) => i.id)
      if (missing.length) {
        throw new InterruptError(
          'resume-incomplete',
          `Cannot resume: no response staged for interrupt(s) ${missing.join(', ')}`,
          missing,
        )
      }
      return buildResumeArray([...open.value], Object.fromEntries(responses.value))
    },

    assertRunAllowed(resume) {
      assertResumeAnswers(open.value, resume)
    },

    restore(interrupts) {
      setOpen([...interrupts])
      agent.pendingInterrupts = [...interrupts]
    },
  }

  function findOpen(interruptId: string): Interrupt {
    const interrupt = open.value.find((i) => i.id === interruptId)
    if (!interrupt) {
      throw new InterruptError('interrupt-unknown', `Interrupt ${interruptId} is not open`, [interruptId])
    }
    return interrupt
  }

  registries.set(agent, registry)
  onScopeDispose(() => {
    subscription.unsubscribe()
    if (registries.get(agent) === registry) registries.delete(agent)
  })

  return registry
}

/**
 * Turn a `resolved` answer into a stageable response, refusing it for an expired
 * interrupt and running the configured validator. The payload is JSON-stripped:
 * like `forwardedProps` it is consumer-supplied, opaque and JSON over the wire,
 * and a natural source is a `reactive()` form object — which would both throw in
 * the client's `structuredClone` and keep changing after it was staged.
 */
async function checkedResolution(
  interrupt: Interrupt,
  payload: unknown,
  validate: ValidateResumePayload | undefined,
): Promise<InterruptResponse> {
  if (isInterruptExpired(interrupt)) {
    throw new InterruptError(
      'interrupt-expired',
      `Interrupt ${interrupt.id} expired at ${interrupt.expiresAt}; it can only be cancelled`,
      [interrupt.id],
    )
  }
  const plain = payload === undefined ? undefined : stripState(payload)
  const issues = validate && interrupt.responseSchema
    ? (await validate(interrupt.responseSchema as JsonSchema, plain, interrupt)) ?? []
    : []
  if (issues.length) {
    throw new InterruptError(
      'payload-invalid',
      `Response to interrupt ${interrupt.id} does not match its responseSchema: ${issues.join('; ')}`,
      [interrupt.id],
      issues,
    )
  }
  return { status: 'resolved', payload: plain }
}

/**
 * Enforce the client-side interrupt rules for a run about to start: with
 * interrupts open, only a run whose `resume` answers every one of them may
 * proceed (rules 3, 4), and an expired one may only be cancelled (rule 7). A
 * `resume` naming an interrupt that is not open is refused as well.
 */
function assertResumeAnswers(open: readonly Interrupt[], resume: ResumeEntry[] | undefined) {
  const openIds = open.map((i) => i.id)
  if (open.length && !resume?.length) {
    throw new InterruptError(
      'interrupts-pending',
      `The thread is paused on interrupt(s) ${openIds.join(', ')}; answer them via resume before starting a new run`,
      openIds,
    )
  }
  const answered = new Map((resume ?? []).map((entry) => [entry.interruptId, entry]))
  const unknown = [...answered.keys()].filter((id) => !openIds.includes(id))
  if (unknown.length) {
    throw new InterruptError('interrupt-unknown', `resume names interrupt(s) that are not open: ${unknown.join(', ')}`, unknown)
  }
  const missing = openIds.filter((id) => !answered.has(id))
  if (missing.length) {
    throw new InterruptError('resume-incomplete', `resume does not answer interrupt(s) ${missing.join(', ')}`, missing)
  }
  const expired = open.filter((i) => isInterruptExpired(i) && answered.get(i.id)?.status !== 'cancelled').map((i) => i.id)
  if (expired.length) {
    throw new InterruptError('interrupt-expired', `Interrupt(s) ${expired.join(', ')} expired and can only be cancelled`, expired)
  }
}
