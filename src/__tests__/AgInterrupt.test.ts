import { vi, describe, it, expect } from 'vitest'
import { createApp, defineComponent, h, nextTick, type VNode } from 'vue'
import type { Interrupt } from '@ag-ui/core'
import { AgInterrupt, type AgInterruptResumeSlotProps, type AgInterruptSlotProps } from '../components/AgInterrupt'
import { useAgent, type UseAgentReturn } from '../composables/useAgent'
import { useFrontendTool } from '../composables/useFrontendTool'
import type { MockHttpAgent } from './helpers/mockHttpAgent'

vi.mock('@ag-ui/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ag-ui/client')>()
  const { MockHttpAgent } = await import('./helpers/mockHttpAgent')
  return { ...actual, HttpAgent: MockHttpAgent }
})

const toolApproval: Interrupt = {
  id: 'pyd_ai_call_1',
  reason: 'tool_call',
  toolCallId: 'call_1',
  message: 'Approve delete_file?',
  responseSchema: { type: 'object', properties: { approved: { type: 'boolean' } } },
}
const confirmation: Interrupt = { id: 'int_2', reason: 'confirmation', message: 'Proceed?' }
const custom: Interrupt = { id: 'int_3', reason: 'vendor:quota', message: 'Over quota' }

/**
 * Mount AgInterrupt on a fresh agent with one slot per name in `slotNames`.
 * Each slot renders a <span data-slot> and records its scope; `scope(id)` returns
 * the latest one an interrupt was rendered with. With `withResume`, a `#resume`
 * slot renders <span data-slot="resume"> and its latest scope is `resumeScope()`.
 */
function mount(
  slotNames: string[],
  { setup, withResume = false }: { setup?: (agentCtx: UseAgentReturn) => void; withResume?: boolean } = {},
) {
  const scopes = new Map<string, AgInterruptSlotProps>()
  let latestResume: AgInterruptResumeSlotProps | undefined
  let agentCtx!: UseAgentReturn

  const slots: Record<string, (props: any) => VNode[]> = Object.fromEntries(
    slotNames.map((name) => [
      name,
      (props: AgInterruptSlotProps) => {
        scopes.set(props.interrupt.id, props)
        return [h('span', { 'data-slot': name }, props.interrupt.id)]
      },
    ]),
  )
  if (withResume) {
    slots.resume = (props: AgInterruptResumeSlotProps) => {
      latestResume = props
      return [h('span', { 'data-slot': 'resume' }, String(props.canResume))]
    }
  }

  const app = createApp(
    defineComponent({
      setup() {
        agentCtx = useAgent({ url: 'http://test' })
        setup?.(agentCtx)
        return () => h(AgInterrupt, { agent: agentCtx }, slots)
      },
    }),
  )
  const host = document.createElement('div')
  app.mount(host)
  const mock = agentCtx.agent as unknown as MockHttpAgent
  const scope = (id: string) => scopes.get(id)!
  const resumeScope = () => latestResume!
  return { host, scope, resumeScope, agentCtx, mock, unmount: () => app.unmount() }
}

function interruptWith(mock: MockHttpAgent, interrupts: Interrupt[]) {
  mock.emit('onRunFinishedEvent', { event: {}, outcome: 'interrupt', interrupts })
}

function texts(host: HTMLElement) {
  return [...host.querySelectorAll('span')].map((el) => `${el.dataset.slot}:${el.textContent}`)
}

describe('AgInterrupt', () => {
  describe('rendering', () => {
    it('renders nothing while the thread is not paused', async () => {
      const { host, unmount } = mount(['default'])
      await nextTick()
      expect(host.innerHTML).toBe('')
      unmount()
    })

    it('routes each interrupt to the slot named by its reason, falling back to #default', async () => {
      const { host, mock, unmount } = mount(['tool_call', 'confirmation', 'default'])
      interruptWith(mock, [toolApproval, confirmation, custom])
      await nextTick()

      expect(texts(host)).toEqual(['tool_call:pyd_ai_call_1', 'confirmation:int_2', 'default:int_3'])
      unmount()
    })

    it('routes an interrupt whose reason is a reserved slot name to #default', async () => {
      const { host, mock, unmount } = mount(['default'], { withResume: true })
      interruptWith(mock, [{ id: 'int_4', reason: 'resume' }])
      await nextTick()

      expect(texts(host)).toEqual(['default:int_4', 'resume:false'])
      unmount()
    })

    it('skips an interrupt with neither a matching slot nor #default', async () => {
      const { host, mock, unmount } = mount(['confirmation'])
      interruptWith(mock, [toolApproval, confirmation])
      await nextTick()

      expect(texts(host)).toEqual(['confirmation:int_2'])
      unmount()
    })

    it('exposes the tool call arguments and name of a tool-bound interrupt', async () => {
      const { scope, mock, agentCtx, unmount } = mount(['default'])
      agentCtx.setMessages([
        {
          id: 'a1',
          role: 'assistant',
          toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'delete_file', arguments: '{"path":"a.txt"}' } }],
        },
      ])
      interruptWith(mock, [toolApproval, confirmation])
      await nextTick()

      const tool = scope('pyd_ai_call_1')
      const plain = scope('int_2')
      expect(tool.args).toEqual({ path: 'a.txt' })
      expect(tool.toolName).toBe('delete_file')
      expect(plain.args).toBeNull()
      expect(plain.toolName).toBeUndefined()
      unmount()
    })

    it('keeps an answered interrupt in the list, with its staged answer, so it can be revised', async () => {
      const { host, scope, mock, unmount } = mount(['default'])
      interruptWith(mock, [toolApproval, confirmation])
      await nextTick()

      await scope('pyd_ai_call_1').resolve({ approved: true })
      await nextTick()

      expect(texts(host)).toEqual(['default:pyd_ai_call_1', 'default:int_2'])
      expect(scope('pyd_ai_call_1').interrupt.status).toBe('resolved')
      expect(scope('pyd_ai_call_1').interrupt.payload).toEqual({ approved: true })

      await scope('pyd_ai_call_1').cancel()
      await nextTick()

      expect(scope('pyd_ai_call_1').interrupt.status).toBe('cancelled')
      unmount()
    })
  })

  describe('#resume slot', () => {
    it('renders after the interrupts only while the thread is paused', async () => {
      const { host, mock, unmount } = mount(['default'], { withResume: true })
      await nextTick()
      expect(host.innerHTML).toBe('')

      interruptWith(mock, [confirmation])
      await nextTick()
      expect(texts(host)).toEqual(['default:int_2', 'resume:false'])

      mock.emit('onRunFinishedEvent', { event: {}, outcome: 'success' })
      await nextTick()
      expect(host.innerHTML).toBe('')
      unmount()
    })

    it('never sends on its own: the resume goes out only via resumeAll()', async () => {
      const { scope, resumeScope, mock, unmount } = mount(['default'], { withResume: true })
      interruptWith(mock, [toolApproval, confirmation])
      await nextTick()

      await scope('pyd_ai_call_1').resolve({ approved: true })
      await scope('int_2').cancel()
      await nextTick()

      expect(resumeScope().canResume).toBe(true)
      expect(mock.runAgent).not.toHaveBeenCalled()

      await resumeScope().resumeAll()

      expect(mock.runAgent).toHaveBeenCalledOnce()
      expect(mock.runAgent.mock.calls[0][0].resume).toEqual([
        { interruptId: 'pyd_ai_call_1', status: 'resolved', payload: { approved: true } },
        { interruptId: 'int_2', status: 'cancelled' },
      ])
      unmount()
    })

    it('keeps canResume false while a frontend tool call from the same run is pending', async () => {
      let confirm!: ReturnType<typeof useFrontendTool>
      const { scope, resumeScope, mock, unmount } = mount(['default'], {
        withResume: true,
        setup: (agentCtx) => {
          confirm = useFrontendTool(agentCtx, {
            name: 'confirm_action',
            description: 'Confirm',
            parameters: { type: 'object', properties: {} },
          })
        },
      })
      mock.emit('onToolCallStartEvent', { event: { toolCallId: 'fe_1', toolCallName: 'confirm_action' } })
      mock.emit('onToolCallEndEvent', { event: { toolCallId: 'fe_1' } })
      interruptWith(mock, [confirmation])
      await nextTick()

      await scope('int_2').resolve()
      await nextTick()
      expect(resumeScope().canResume).toBe(false)

      await confirm.calls.value[0].respond!('ok')
      await nextTick()
      expect(resumeScope().canResume).toBe(true)
      unmount()
    })

    it('exposes cancelAll() to dismiss every open interrupt', async () => {
      const { scope, resumeScope, mock, unmount } = mount(['default'], { withResume: true })
      interruptWith(mock, [toolApproval, confirmation])
      await nextTick()

      await resumeScope().cancelAll()
      await nextTick()

      expect(scope('pyd_ai_call_1').interrupt.status).toBe('cancelled')
      expect(scope('int_2').interrupt.status).toBe('cancelled')
      expect(mock.runAgent).not.toHaveBeenCalled()
      unmount()
    })
  })
})
