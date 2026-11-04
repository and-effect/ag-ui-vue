import { vi, describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import type { Interrupt } from '@ag-ui/core'
import { withSetup } from './helpers/withSetup'
import { useAgent } from '../composables/useAgent'
import { useInterrupts } from '../composables/useInterrupts'
import { useFrontendTool } from '../composables/useFrontendTool'
import { InterruptError } from '../composables/interruptRegistry'
import type { UseAgentOptions } from '../types'
import type { MockHttpAgent } from './helpers/mockHttpAgent'

vi.mock('@ag-ui/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ag-ui/client')>()
  const { MockHttpAgent } = await import('./helpers/mockHttpAgent')
  return { ...actual, HttpAgent: MockHttpAgent }
})

/** Shape of PydanticAI's tool-approval `responseSchema`. */
const APPROVAL_SCHEMA = {
  type: 'object',
  properties: { approved: { type: 'boolean' }, editedArgs: { type: 'object' }, reason: { type: 'string' } },
  required: ['approved'],
}

const toolApproval: Interrupt = {
  id: 'pyd_ai_call_1',
  reason: 'tool_call',
  toolCallId: 'call_1',
  message: 'Approve delete_file({"path":"a.txt"})?',
  responseSchema: APPROVAL_SCHEMA,
}
const confirmation: Interrupt = { id: 'int_2', reason: 'confirmation', message: 'Proceed?' }

function setup(options: Partial<UseAgentOptions> = {}) {
  const [ctx, unmount] = withSetup(() => {
    const agentCtx = useAgent({ url: 'http://test', ...options })
    return { agentCtx, ...useInterrupts(agentCtx) }
  })
  const mock = ctx.agentCtx.agent as unknown as MockHttpAgent
  return { ...ctx, mock, unmount }
}

/** Finish a run on an interrupt outcome, as the real client reports it to subscribers. */
function interruptWith(mock: MockHttpAgent, interrupts: Interrupt[]) {
  mock.emit('onRunFinishedEvent', { event: {}, outcome: 'interrupt', interrupts })
}

/** The `resume` the nth (0-based) runAgent call carried. */
function sentResume(mock: MockHttpAgent, call: number) {
  return mock.runAgent.mock.calls[call][0].resume
}

async function expectInterruptError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (e) => e)
  expect(error).toBeInstanceOf(InterruptError)
  expect(error.code).toBe(code)
}

describe('useInterrupts', () => {
  describe('surfacing', () => {
    it('surfaces interrupts from an interrupt outcome with their protocol fields', () => {
      const { interrupts, hasPending, agentCtx, mock, unmount } = setup()

      interruptWith(mock, [toolApproval, confirmation])

      expect(hasPending.value).toBe(true)
      expect(agentCtx.interrupts.value).toEqual([toolApproval, confirmation])
      expect(interrupts.value[0]).toMatchObject({
        kind: 'interrupt',
        id: 'pyd_ai_call_1',
        reason: 'tool_call',
        toolCallId: 'call_1',
        status: 'pending',
        canEditArgs: true,
        raw: toolApproval,
      })
      expect(interrupts.value[1]).toMatchObject({ id: 'int_2', status: 'pending', canEditArgs: false })
      unmount()
    })

    it('surfaces an unknown reason like any other', () => {
      const { interrupts, mock, unmount } = setup()

      interruptWith(mock, [{ id: 'x', reason: 'needs_budget_signoff', metadata: { amount: 3 } }])

      expect(interrupts.value[0]).toMatchObject({ reason: 'needs_budget_signoff', metadata: { amount: 3 } })
      unmount()
    })

    it.each([
      ['success', { outcome: 'success', pendingToolCallIds: [] }],
      ['cancelled', { outcome: 'cancelled' }],
    ])('closes them when a later run finishes with %s', (_, params) => {
      const { hasPending, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      mock.emit('onRunFinishedEvent', { event: {}, ...params })

      expect(hasPending.value).toBe(false)
      unmount()
    })

    it('keeps them open after a RUN_ERROR so a failed resume can be resubmitted', () => {
      const { hasPending, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      mock.emit('onRunErrorEvent', { event: { message: 'boom' }, input: {} })

      expect(hasPending.value).toBe(true)
      unmount()
    })

    it('drops staged answers when a new interrupt outcome replaces the open set', async () => {
      const { interrupts, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      await interrupts.value[0].resolve('yes')

      interruptWith(mock, [{ ...confirmation, id: 'int_3' }])

      expect(interrupts.value).toHaveLength(1)
      expect(interrupts.value[0]).toMatchObject({ id: 'int_3', status: 'pending' })
      unmount()
    })
  })

  describe('rule 4: no plain run while paused', () => {
    it('refuses send() with a typed error, before any request or transcript change', async () => {
      const onError = vi.fn()
      const { agentCtx, mock, unmount } = setup({ onError })
      interruptWith(mock, [confirmation])

      await expectInterruptError(agentCtx.send('hello'), 'interrupts-pending')

      expect(mock.runAgent).not.toHaveBeenCalled()
      expect(agentCtx.messages.value).toEqual([])
      expect(agentCtx.isRunning.value).toBe(false)
      expect(onError).not.toHaveBeenCalled()
      unmount()
    })

    it('refuses a plain continueRun()', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      await expectInterruptError(agentCtx.continueRun(), 'interrupts-pending')
      expect(mock.runAgent).not.toHaveBeenCalled()
      unmount()
    })

    it('allows a send() that carries a complete resume', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      await agentCtx.send('and also…', { resume: [{ interruptId: 'int_2', status: 'cancelled' }] })

      expect(sentResume(mock, 0)).toEqual([{ interruptId: 'int_2', status: 'cancelled' }])
      unmount()
    })

    it('refuses a resume naming an interrupt that is not open', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      await expectInterruptError(
        agentCtx.continueRun({
          resume: [
            { interruptId: 'int_2', status: 'cancelled' },
            { interruptId: 'ghost', status: 'cancelled' },
          ],
        }),
        'interrupt-unknown',
      )
      unmount()
    })

    it('reports a continuation queued during the interrupted run on `error`, not as an unhandled rejection', async () => {
      const { agentCtx, mock, unmount } = setup()
      mock.runAgent.mockImplementationOnce(async () => {
        void agentCtx.continueRun() // queued: a run is in flight
        interruptWith(mock, [confirmation])
        return {}
      })

      await agentCtx.send('go')
      await Promise.resolve()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(agentCtx.error.value).toMatch(/paused on interrupt/)
      expect(agentCtx.errorCode.value).toBe('interrupts-pending')
      unmount()
    })

    it('sends no resume field at all when the thread is not paused', async () => {
      const { agentCtx, mock, unmount } = setup()

      await agentCtx.send('hi')

      expect(mock.runAgent.mock.calls[0][0]).not.toHaveProperty('resume')
      unmount()
    })
  })

  describe('answering and resuming', () => {
    it('resolves and cancels parallel interrupts independently, then resumes once with both', async () => {
      const { interrupts, canResume, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [toolApproval, confirmation])

      await interrupts.value[1].cancel()
      expect(canResume.value).toBe(false)
      await interrupts.value[0].resolve({ approved: true })
      expect(interrupts.value.map((i) => i.status)).toEqual(['resolved', 'cancelled'])
      expect(canResume.value).toBe(true)

      await resumeAll()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(sentResume(mock, 0)).toEqual([
        { interruptId: 'pyd_ai_call_1', status: 'resolved', payload: { approved: true } },
        { interruptId: 'int_2', status: 'cancelled' },
      ])
      unmount()
    })

    it('sends composable-level context on the resume run', async () => {
      let page = 'files'
      const { interrupts, resumeAll, mock, unmount } = setup({
        context: () => [{ description: 'Page', value: page }],
      })
      interruptWith(mock, [confirmation])
      page = 'settings' // the user navigated while the interrupt was open

      await interrupts.value[0].resolve(true)
      await resumeAll()

      expect(mock.runAgent.mock.calls[0][0].context).toEqual([{ description: 'Page', value: 'settings' }])
      unmount()
    })

    it('rejects resumeAll() while an interrupt is unanswered (rule 3)', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [toolApproval, confirmation])
      await interrupts.value[0].resolve({ approved: true })

      await expectInterruptError(resumeAll(), 'resume-incomplete')
      expect(mock.runAgent).not.toHaveBeenCalled()
      unmount()
    })

    it('lets an answer be revised before resuming', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      await interrupts.value[0].resolve('yes')
      await interrupts.value[0].cancel()
      await resumeAll()

      expect(sentResume(mock, 0)).toEqual([{ interruptId: 'int_2', status: 'cancelled' }])
      unmount()
    })

    it('round-trips editedArgs for approve-with-edits', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [toolApproval])

      await interrupts.value[0].resolve({ approved: true, editedArgs: { path: 'b.txt' } })
      await resumeAll()

      expect(sentResume(mock, 0)[0].payload).toEqual({ approved: true, editedArgs: { path: 'b.txt' } })
      unmount()
    })

    it('does not answer a tool-bound interrupt with a tool message — the server emits the result', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [toolApproval])

      await interrupts.value[0].resolve({ approved: true })
      await resumeAll()

      expect(mock.addMessage).not.toHaveBeenCalled()
      expect(mock.messages).toEqual([])
      unmount()
    })

    it('snapshots a reactive payload into plain JSON the client can structuredClone', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [toolApproval])
      const form = reactive({ approved: true, editedArgs: { path: 'b.txt' } })

      await interrupts.value[0].resolve(form)
      form.editedArgs.path = 'changed-after-staging.txt'
      await resumeAll()

      const resume = sentResume(mock, 0)
      expect(() => structuredClone(resume)).not.toThrow()
      expect(resume[0].payload.editedArgs.path).toBe('b.txt')
      unmount()
    })

    it('passes extra run options through on the resume run', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      await interrupts.value[0].cancel()

      await resumeAll({ forwardedProps: { mode: 'fast' } })

      expect(mock.runAgent.mock.calls[0][0].forwardedProps).toEqual({ mode: 'fast' })
      unmount()
    })

    it('refuses answers while the resume run is in flight', async () => {
      const { interrupts, resumeAll, cancelAll, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      await interrupts.value[0].resolve('yes')
      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles

      void resumeAll()
      await expectInterruptError(interrupts.value[0].cancel(), 'run-in-flight')
      await expectInterruptError(interrupts.value[0].resolve('no'), 'run-in-flight')
      await expectInterruptError(cancelAll(), 'run-in-flight')

      expect(interrupts.value[0].status).toBe('resolved')
      expect(interrupts.value[0].payload).toBe('yes')
      unmount()
    })

    it('refuses a second resumeAll() while the first is in flight, sending once', async () => {
      const { agentCtx, interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      await interrupts.value[0].resolve('yes')
      mock.runAgent.mockReturnValueOnce(new Promise(() => {})) // never settles

      void resumeAll()
      await expectInterruptError(resumeAll(), 'run-in-flight')

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(agentCtx.error.value).toBeNull()
      unmount()
    })

    it('does not replay a resume after it succeeded (no stale error)', async () => {
      const { agentCtx, interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      await interrupts.value[0].resolve('yes')
      let finish!: () => void
      mock.runAgent.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = () => {
            mock.emit('onRunFinishedEvent', { event: {}, outcome: 'success' })
            resolve({})
          }
        }),
      )

      const first = resumeAll()
      await resumeAll().catch(() => {})
      finish()
      await first
      await Promise.resolve()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(agentCtx.error.value).toBeNull()
      unmount()
    })

    it('refuses to queue a hand-built resume behind a run in flight', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [confirmation])
      mock.runAgent.mockReturnValueOnce(new Promise(() => {}))
      const resume = [{ interruptId: 'int_2', status: 'cancelled' as const }]

      void agentCtx.continueRun({ resume })
      await expectInterruptError(agentCtx.continueRun({ resume }), 'run-in-flight')

      expect(mock.runAgent).toHaveBeenCalledOnce()
      unmount()
    })

    it('treats an empty resume as no resume', async () => {
      const { agentCtx, mock, unmount } = setup()
      let finish!: () => void
      mock.runAgent.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({}) }))

      void agentCtx.continueRun()
      // In flight: queued like a plain run, not refused as a resume.
      await agentCtx.continueRun({ resume: [] })
      finish()
      await vi.waitFor(() => expect(mock.runAgent).toHaveBeenCalledTimes(2))

      expect(mock.runAgent.mock.calls[1][0]).not.toHaveProperty('resume')
      unmount()
    })

    it('still refuses an empty resume while interrupts are open', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      await expectInterruptError(agentCtx.continueRun({ resume: [] }), 'interrupts-pending')
      expect(mock.runAgent).not.toHaveBeenCalled()
      unmount()
    })

    it('stages cancelled for every interrupt via cancelAll()', async () => {
      const { interrupts, cancelAll, canResume, mock, unmount } = setup()
      interruptWith(mock, [toolApproval, confirmation])

      await cancelAll()

      expect(interrupts.value.map((i) => i.status)).toEqual(['cancelled', 'cancelled'])
      expect(canResume.value).toBe(true)
      unmount()
    })
  })

  describe('alongside a HITL frontend tool in the same run', () => {
    function setupWithHitl() {
      const [ctx, unmount] = withSetup(() => {
        const agentCtx = useAgent({ url: 'http://test' })
        const confirm = useFrontendTool(agentCtx, {
          name: 'confirm_action',
          description: 'Ask the user to confirm',
          parameters: { type: 'object', properties: { action: { type: 'string' } } },
        })
        return { agentCtx, confirm, ...useInterrupts(agentCtx) }
      })
      const mock = ctx.agentCtx.agent as unknown as MockHttpAgent
      // One step: the model calls the HITL tool and a server tool needing approval.
      mock.emit('onToolCallStartEvent', { event: { toolCallId: 'fe_1', toolCallName: 'confirm_action' } })
      mock.emit('onToolCallArgsEvent', { event: { toolCallId: 'fe_1', delta: '{"action":"x"}' } })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'fe_1' } })
      interruptWith(mock, [toolApproval])
      return { ...ctx, mock, unmount }
    }

    it('keeps the HITL card answerable and holds the resume until it is answered', async () => {
      const { confirm, interrupts, canResume, resumeAll, mock, unmount } = setupWithHitl()
      await interrupts.value[0].resolve({ approved: true })

      expect(confirm.calls.value[0].status).toBe('pending')
      expect(canResume.value).toBe(false)
      await expectInterruptError(resumeAll(), 'frontend-calls-pending')
      expect(mock.runAgent).not.toHaveBeenCalled()

      await confirm.calls.value[0].respond!('approved')

      expect(canResume.value).toBe(true)
      unmount()
    })

    it('refuses a hand-built resume that would orphan the HITL call', async () => {
      const { agentCtx, confirm, mock, unmount } = setupWithHitl()
      const resume = [{ interruptId: 'pyd_ai_call_1', status: 'cancelled' as const }]

      await expectInterruptError(agentCtx.continueRun({ resume }), 'frontend-calls-pending')
      await expectInterruptError(agentCtx.send('also…', { resume }), 'frontend-calls-pending')

      expect(mock.runAgent).not.toHaveBeenCalled()
      expect(mock.messages.some((m) => m.role === 'user')).toBe(false)
      expect(confirm.calls.value[0].status).toBe('pending')
      unmount()
    })

    it('keeps the HITL card and the resume guard through an idle abort()', async () => {
      const { agentCtx, confirm, interrupts, canResume, resumeAll, mock, unmount } = setupWithHitl()
      await interrupts.value[0].resolve({ approved: true })

      agentCtx.abort()

      expect(confirm.calls.value[0].status).toBe('pending')
      expect(canResume.value).toBe(false)
      await expectInterruptError(resumeAll(), 'frontend-calls-pending')
      expect(mock.runAgent).not.toHaveBeenCalled()

      await confirm.calls.value[0].respond!('approved')
      await resumeAll()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(mock.messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'fe_1' }))
      unmount()
    })

    it('treats an empty resume as a plain run, not one that would orphan the HITL call', async () => {
      const { agentCtx, mock, unmount } = setupWithHitl()
      interruptWith(mock, []) // paused run superseded: no interrupts open, HITL call still pending

      await agentCtx.continueRun({ resume: [] })

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(mock.runAgent.mock.calls[0][0]).not.toHaveProperty('resume')
      unmount()
    })

    it('sends the HITL result in the transcript of the single resume run', async () => {
      const { confirm, interrupts, resumeAll, mock, unmount } = setupWithHitl()
      await confirm.calls.value[0].respond!('approved')
      await interrupts.value[0].resolve({ approved: true })
      await Promise.resolve()

      // Answering the card must not fire a plain continuation the client would refuse.
      expect(mock.runAgent).not.toHaveBeenCalled()

      await resumeAll()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(sentResume(mock, 0)).toEqual([
        { interruptId: 'pyd_ai_call_1', status: 'resolved', payload: { approved: true } },
      ])
      expect(mock.messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'fe_1' }))
      unmount()
    })
  })

  describe('rule 7: expiry', () => {
    const expired: Interrupt = { ...confirmation, expiresAt: '2000-01-01T00:00:00Z' }

    it('refuses to resolve an expired interrupt', async () => {
      const { interrupts, mock, unmount } = setup()
      interruptWith(mock, [expired])

      await expectInterruptError(interrupts.value[0].resolve('yes'), 'interrupt-expired')
      expect(interrupts.value[0].status).toBe('pending')
      unmount()
    })

    it('still lets an expired interrupt be cancelled and resumed', async () => {
      const { interrupts, resumeAll, mock, unmount } = setup()
      interruptWith(mock, [expired])

      await interrupts.value[0].cancel()
      await resumeAll()

      expect(sentResume(mock, 0)).toEqual([{ interruptId: 'int_2', status: 'cancelled' }])
      unmount()
    })

    it('refuses a hand-built resume that answers an expired interrupt', async () => {
      const { agentCtx, mock, unmount } = setup()
      interruptWith(mock, [expired])

      await expectInterruptError(
        agentCtx.continueRun({ resume: [{ interruptId: 'int_2', status: 'resolved', payload: 'yes' }] }),
        'interrupt-expired',
      )
      unmount()
    })
  })

  describe('rule 6: validateResumePayload', () => {
    it('refuses a payload the validator rejects, leaving the interrupt pending', async () => {
      const validateResumePayload = vi.fn((_schema: unknown, payload: any) =>
        typeof payload?.approved === 'boolean' ? [] : ['approved is required'],
      )
      const { interrupts, mock, unmount } = setup({ validateResumePayload })
      interruptWith(mock, [toolApproval])

      const error = await interrupts.value[0].resolve({ editedArgs: {} }).catch((e) => e)

      expect(error).toBeInstanceOf(InterruptError)
      expect(error).toMatchObject({ code: 'payload-invalid', issues: ['approved is required'] })
      expect(validateResumePayload).toHaveBeenCalledWith(APPROVAL_SCHEMA, { editedArgs: {} }, toolApproval)
      expect(interrupts.value[0].status).toBe('pending')
      unmount()
    })

    it('stages a payload the (async) validator accepts', async () => {
      const { interrupts, mock, unmount } = setup({ validateResumePayload: async () => [] })
      interruptWith(mock, [toolApproval])

      await interrupts.value[0].resolve({ approved: true })

      expect(interrupts.value[0].status).toBe('resolved')
      unmount()
    })

    it('skips validation for an interrupt without a responseSchema', async () => {
      const validateResumePayload = vi.fn(() => ['never'])
      const { interrupts, mock, unmount } = setup({ validateResumePayload })
      interruptWith(mock, [confirmation])

      await interrupts.value[0].resolve('anything')

      expect(validateResumePayload).not.toHaveBeenCalled()
      unmount()
    })

    it('sends payloads unchecked when no validator is configured', async () => {
      const { interrupts, mock, unmount } = setup()
      interruptWith(mock, [toolApproval])

      await interrupts.value[0].resolve('not even an object')

      expect(interrupts.value[0].status).toBe('resolved')
      unmount()
    })
  })

  describe('leaving the paused conversation', () => {
    it('reset() closes the interrupts so the fresh conversation can send', async () => {
      const { agentCtx, hasPending, mock, unmount } = setup()
      interruptWith(mock, [confirmation])

      agentCtx.reset()
      await agentCtx.send('fresh start')

      expect(hasPending.value).toBe(false)
      expect(mock.pendingInterrupts).toEqual([])
      expect(mock.runAgent).toHaveBeenCalledOnce()
      unmount()
    })

    it('setMessages() restores persisted interrupts into both the gate and the client', async () => {
      const { agentCtx, interrupts, mock, unmount } = setup()

      agentCtx.setMessages([{ id: 'm1', role: 'user', content: 'delete a.txt' }], undefined, [toolApproval])

      expect(interrupts.value.map((i) => i.id)).toEqual(['pyd_ai_call_1'])
      expect(mock.pendingInterrupts).toEqual([toolApproval])
      await expectInterruptError(agentCtx.send('hello'), 'interrupts-pending')
      unmount()
    })
  })
})
