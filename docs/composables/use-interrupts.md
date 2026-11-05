# `useInterrupts`

Human in the loop for tools that live **on the server**. When a backend needs approval, an edit or an answer before it continues, the run ends with an AG-UI [interrupt](https://docs.ag-ui.com/concepts/interrupts) (`RUN_FINISHED.outcome = interrupt`) and the thread pauses until a new run answers it via `RunAgentInput.resume`. `useInterrupts` lists the open interrupts, lets you answer each one, and sends the resume:

```ts
const agentCtx = useAgent({ url: '/api/agent' })
const { interrupts, hasPending, canResume, resumeAll } = useInterrupts(agentCtx)
```

```html
<div v-for="i in interrupts" :key="i.id">
  <p>{{ i.message }}</p>
  <button @click="i.resolve({ approved: true })">Approve</button>
  <button @click="i.resolve({ approved: false, reason: 'Not now' })">Deny</button>
</div>
<button :disabled="!canResume" @click="resumeAll()">Continue</button>
```

- **Answers are staged, then sent together.** The protocol requires one resume that answers *every* open interrupt, so `resolve(payload)` / `cancel()` only record the answer for that interrupt (and can be changed until you resume). `resumeAll()` sends them all in one new run. `canResume` turns true once every interrupt has an answer. `resumeAll()` rejects with `code: 'run-in-flight'` while a run is in progress, so a double-click on Continue doesn't send the answers twice. `resolve()` / `cancel()` / `cancelAll()` reject the same way: answers are frozen while the resume run is in flight.
- **The payload is whatever the interrupt's `responseSchema` describes.** For a PydanticAI tool approval that is `{ approved, editedArgs?, reason? }`. `canEditArgs` is true when the schema declares `editedArgs`, so you can show an edit form: `resolve({ approved: true, editedArgs: { … } })` runs the tool with your arguments instead of the model's.
- **Tool approvals are answered by the server.** A `tool_call` interrupt carries the `toolCallId` of a server tool call that is already in `messages`; read its arguments from there (or from `useToolCalls` while it streams). After the resume the *server* runs the tool and emits its result. The client sends only the decision, never a tool message.
- **While paused, a plain run is refused.** `send()` / `continueRun()` without a `resume` covering every open interrupt reject with an `InterruptError` (`code: 'interrupts-pending'`) before any request is made, so it never reaches `onError`. `send(text, { resume })` is allowed if you want to answer and add a message at once.
- **Expiry.** An interrupt whose `expiresAt` has passed can only be cancelled: `resolve()` rejects with `code: 'interrupt-expired'`. Nothing is cancelled for you, so show the deadline and let the user dismiss it.
- **Unknown reasons are not errors.** `reason` is an open string. Render anything you don't recognise from `message`, `responseSchema` and `metadata`, or offer `cancel()`.
- **Threads.** `useThreads` saves the open interrupts with the thread, so a paused thread can still be resumed after a reload, and switching to another thread is never blocked by it.

**Validating payloads.** No JSON Schema validator ships with ag-ui-vue. To check answers against `responseSchema` before they are staged, plug in the one you use. A rejected payload makes `resolve()` reject with `code: 'payload-invalid'` and the `issues` you returned:

```ts
import { Validator } from '@cfworker/json-schema'

useAgent({
  url: '/api/agent',
  validateResumePayload: (schema, payload) =>
    new Validator(schema).validate(payload).errors.map((e) => e.error),
})
```

Without a validator the server decides. PydanticAI, for one, treats any approval payload that fails its own validation as a denial.

**Interrupts vs. HITL frontend tools.** A frontend tool without a handler (`useFrontendTool`) is a tool *you execute*: its answer goes back as a tool result. An interrupt is a step you *authorize the server to take*: your answer goes back on the next run's `resume`. They are separate mechanisms, but both `FrontendToolCall` and `AgentInterrupt` implement `PendingDecision` (`kind`, `id`, `status`, `message?`, `responseSchema?`), so one approvals list can render both.

The two can also arrive together. If the model calls a HITL frontend tool and a server tool that needs approval in the same step, the run pauses with the frontend call still open. Its card stays answerable, and its result is sent with the resume run. Until it is answered, `canResume` stays false, and any run carrying a `resume` (`resumeAll()`, or a hand-built `send`/`continueRun`) rejects with `code: 'frontend-calls-pending'`, because resuming without it would leave the tool call unanswered in the transcript.

## API

### `useInterrupts(agentContext)`

```ts
const {
  interrupts,   // ComputedRef<AgentInterrupt[]> — open interrupts, in the order the run reported them
  hasPending,   // ComputedRef<boolean> — the thread is paused
  canResume,    // ComputedRef<boolean> — every interrupt and pending frontend tool call answered, no run in flight
  resumeAll,    // (runOptions?) => Promise<void> — send every answer as one resume[]
  cancelAll,    // () => Promise<void> — answer every interrupt with `cancelled`
} = useInterrupts(agentCtx)

interface AgentInterrupt extends PendingDecision {
  kind: 'interrupt'
  id: string
  reason: string                    // 'tool_call' | 'input_required' | 'confirmation' | any string
  status: 'pending' | 'resolved' | 'cancelled'
  message?: string
  toolCallId?: string               // for tool approvals: the server tool call awaiting it
  responseSchema?: JsonSchema
  canEditArgs: boolean              // responseSchema declares editedArgs
  expiresAt?: string
  metadata?: Record<string, unknown>
  payload?: unknown                 // the staged answer
  raw: Interrupt                    // as the protocol delivered it
  resolve: (payload?) => Promise<void>  // rejects 'run-in-flight' while a run is in progress
  cancel: () => Promise<void>           // likewise
}
```

`InterruptError` (`code`: `'interrupts-pending' | 'resume-incomplete' | 'interrupt-unknown' | 'interrupt-expired' | 'payload-invalid' | 'run-in-flight' | 'frontend-calls-pending'`, plus `interruptIds` and `issues`) is thrown before any request is made.
