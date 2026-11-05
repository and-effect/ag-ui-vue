# `useFrontendTool`

Agents can call functions in the browser. Two patterns:

**Automatic execution** — provide a handler and the tool runs immediately.

Pass a [Standard Schema](https://standardschema.dev/) (Zod 4+, ArkType 2+) as `parameters` for automatic type inference and runtime validation. The handler's first argument is fully typed — no explicit generic needed:

```ts
import { z } from 'zod'

const darkMode = useFrontendTool(agentCtx, {
  name: 'setDarkMode',
  description: 'Toggle dark/light theme',
  parameters: z.object({ enabled: z.boolean() }),  // args inferred as { enabled: boolean }
  handler: async ({ enabled }, { signal }) => {     // signal aborts if the agent is stopped
    isDarkMode.value = enabled
    return { success: true }
  },
  followUp: false,  // skip the follow-up LLM turn — this is a pure side-effect
})

// Declaring the tool is enough — it auto-registers, so a bare send() advertises it.
send('Enable dark mode')
```

Raw JSON Schema is still accepted for backward compatibility — `args` becomes `any`:

```ts
const darkMode = useFrontendTool(agentCtx, {
  name: 'setDarkMode',
  description: 'Toggle dark/light theme',
  parameters: {
    type: 'object',
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
  },
  handler: async (args) => {
    isDarkMode.value = args.enabled
    return { success: true }
  },
})
```

The handler receives a second argument `{ toolCallId, signal }`. `signal` is wired to the agent's abort — if the user calls `abort()` while the handler is awaiting, the signal fires so async work (fetch, timers) can be cancelled.

`followUp` (default `true`) controls whether the agent gets a follow-up LLM turn after the tool result is submitted. Pure side-effect tools (dark mode toggle, UI state change) set `followUp: false` to skip the redundant turn. If the handler throws, a follow-up is always forced regardless of `followUp`, so the model can self-correct.

Args are validated against the schema before the handler is called. Validation failures submit a structured error result to the agent (so it can retry with corrected args) — the handler is never invoked with invalid data.

**Human-in-the-loop** — omit the handler and the tool waits for user approval:

```ts
const confirm = useFrontendTool(agentCtx, {
  name: 'confirmAction',
  description: 'Request user confirmation before performing an action',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['action', 'description'],
  },
})
```

```html
<div v-if="confirm.pending.value">
  <p>{{ confirm.pending.value.args.description }}</p>
  <button @click="confirm.resolve({ approved: true })">Approve</button>
  <button @click="confirm.reject('Declined')">Decline</button>
</div>
```

Multiple tools need no wiring — each auto-registers with the agent, and the shared coordinator batches every frontend result from a turn into a single follow-up run. Set `enabled: false` to drop a tool from what's advertised. Per invocation, `calls` exposes independent state (`streaming-args` → `executing`/`pending` → `complete`/`error`), so parallel calls don't clobber each other and each pending HITL call carries its own `respond`/`reject`:

```ts
const t = useFrontendTool(agentCtx, { name: 'a', /* … */ })
// t.calls.value[i] — per-call status, streamed args, and (while pending) respond/reject
// t.clear() — drop tracked calls (calls only grows otherwise)
```

## API

### `useFrontendTool(agentContext, options)`

```ts
const {
  tool,          // Tool — auto-registered; rarely needed directly
  isAutomatic,   // boolean — true if handler was provided
  calls,         // DeepReadonly<Ref<FrontendToolCall[]>> — per-call state, in arrival order
  isExecuting,   // Readonly<Ref<boolean>> — derived
  lastResult,    // Readonly<Ref<any>> — derived
  lastError,     // Readonly<Ref<Error | null>> — derived
  pending,       // Readonly<Ref<PendingToolCall | null>> — derived, oldest pending HITL call
  resolve,       // (result) => Promise<void> — derived, answers oldest pending
  reject,        // (reason?) => Promise<void> — derived, answers oldest pending
  enabled,       // Ref<boolean> — toggle at runtime (false drops it from advertised tools)
  clear,         // () => void — drop tracked calls
  dispose,       // () => void — manual cleanup
} = useFrontendTool(agentCtx, {
  name: 'myTool',
  description: '...',
  parameters: schema,                             // Standard Schema (Zod/ArkType) or raw JSON Schema object
  handler: async (args, { toolCallId, signal }) => { ... },  // Optional — omit for HITL
  followUp: true,                                 // Optional, default true — set false to skip follow-up LLM turn
  enabled: true,                                  // Optional, default true — boolean | ref | getter
})
```

`parameters` accepts either a [Standard Schema](https://standardschema.dev/) (Zod 4+, ArkType 2+) or a raw JSON Schema object. With a Standard Schema, handler args are fully typed (no explicit generic needed) and validated at runtime before the handler is called — validation failures submit a structured error result to the agent instead of invoking the handler.

The handler's second argument `{ toolCallId, signal }` provides the call ID and an `AbortSignal` wired to the agent's abort — pass `signal` to `fetch` or other async work so user-initiated stops cancel in-flight operations.

`followUp` (default `true`) determines whether a follow-up LLM turn fires after the tool result is submitted. Set `false` for pure side-effect tools. Handler errors and validation errors always force a follow-up regardless, so the model can self-correct.

Each `FrontendToolCall` carries `{ id, status, args, result?, error?, respond?, reject? }` — `respond`/`reject` are present only while `status === 'pending'`, so any pending call is resolvable directly (not just the oldest).
