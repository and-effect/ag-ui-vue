# ag-ui-vue

ag-ui-vue is a Vue toolkit for building agent-powered UIs. It gives you everything you need to go from a streaming chat interface to a full multi-thread conversation manager with persistent history, frontend tools, shared state, and headless components — without writing the same boilerplate every time.

Built on the open [AG-UI protocol](https://docs.ag-ui.com/), it works with any compatible backend: PydanticAI, LangGraph, Mastra, CrewAI, or anything emitting AG-UI events.

## Why ag-ui-vue?

**Not a React wrapper.** Built from scratch with Vue's reactivity system — `ref`, `computed`, `readonly`, `onScopeDispose` — with a deliberate reactivity boundary: shared `state` is deep-reactive so you mutate it directly (even with `v-model`) and it syncs to the agent, while streamed messages and protocol data stay `shallowRef` / `markRaw` to avoid needless deep-proxying. Everything behaves the way you'd expect in Vue.

**Multi-thread out of the box.** `useThreads` layers a full conversation manager onto your agent — localStorage persistence, auto-generated titles, and a storage adapter interface so you can swap in Pinia or a backend API. Switching swaps the conversation on one stable agent, so tools and middleware keep working across threads. A complete multi-thread chat UI in under 20 lines.

**Agents that act on your UI.** `useFrontendTool` lets agents call functions in the browser — toggle dark mode, update a form, trigger a confirmation dialog. Automatic execution or human-in-the-loop, with no polling or callbacks to wire up.

**Multimodal out of the box.** `send()` accepts `string | ContentPart[]`, so you can attach images, audio, video, and documents alongside text. `AgMessageInput` exposes `onAttach(file)` and `onRemoveAttachment(index)` slot helpers that handle base64 reading, content-type detection, and attachment list management — all without wiring up `FileReader` yourself.

**Generative UI.** `useGenerativeUI` maps tool names to Vue components and renders them inline as the agent calls them. Reactive props stream in as arguments arrive, with an optional loading component while the call is in flight.

**Headless components for the hard parts.** `AgMessageList`, `AgMessageInput`, `AgThreadList`, `AgToolCallStatus`, and `AgInterrupt` handle the interaction logic that's identical in every chat UI — role detection, input state, thread iteration, live tool call progress, approvals. All rendering is yours. Works with Tailwind, Vuetify, Quasar, or plain HTML.

**Backend-agnostic by design.** Switch backends without touching your frontend code.

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Composables](docs/index.md#composables)
  - [useAgent](docs/composables/use-agent.md)
    - [Error codes](docs/composables/use-agent.md#error-codes--errorcode)
    - [Multimodal messages](docs/composables/use-agent.md#multimodal-messages)
    - [Run identity](docs/composables/use-agent.md#run-identity)
    - [Page context](docs/composables/use-agent.md#page-context)
    - [Backend-specific run parameters](docs/composables/use-agent.md#backend-specific-run-parameters)
  - [useThreads](docs/composables/use-threads.md)
  - [useFrontendTool](docs/composables/use-frontend-tool.md)
  - [useInterrupts](docs/composables/use-interrupts.md)
  - [useGenerativeUI](docs/composables/use-generative-ui.md)
  - [useAgentState](docs/composables/use-agent-state.md)
  - [useToolCalls](docs/composables/use-tool-calls.md)
  - [useReasoning](docs/composables/use-reasoning.md)
  - [useActivities](docs/composables/use-activities.md)
  - [useAgentEvent](docs/composables/use-agent-event.md)
- [Headless Components](docs/components.md)
  - [AgMessageList](docs/components.md#agmessagelist)
  - [AgMessageInput](docs/components.md#agmessageinput)
  - [AgThreadList](docs/components.md#agthreadlist)
  - [AgToolCallStatus](docs/components.md#agtoolcallstatus)
  - [AgInterrupt](docs/components.md#aginterrupt)
- [Storage Adapters](docs/storage-adapters.md)
- [Backend Compatibility](#backend-compatibility)
- [Limitations](docs/limitations.md)
- [API Reference](docs/index.md)
- [Development](#development)
- [License](#license)

## Install

```bash
npm install @and-effect/ag-ui-vue @ag-ui/client @ag-ui/core
```

The package is ESM-only and about 15 kB gzipped, not counting its peer dependencies.

### Peer dependencies

`vue`, `@ag-ui/client`, and `@ag-ui/core` are **peer dependencies** — install them in your app (they're not bundled).

| Peer            | Supported range        |
| --------------- | ---------------------- |
| `vue`           | `>=3.3.0`              |
| `@ag-ui/client` | `^1.0.0`               |
| `@ag-ui/core`   | `^1.0.0`               |

See the [playground](./examples) for a working page per feature — run it with `npm run dev:backend` and `npm run dev:playground`.

## Quick Start

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useAgent } from '@and-effect/ag-ui-vue'

const input = ref('')
const { messages, isRunning, error, send, abort } = useAgent({
  url: '/api/agent',
})

function handleSend() {
  send(input.value)
  input.value = ''
}
</script>

<template>
  <div v-for="msg in messages" :key="msg.id">
    <strong>{{ msg.role }}:</strong> {{ msg.content }}
  </div>

  <div v-if="error" style="color: red">{{ error }}</div>

  <input v-model="input" @keydown.enter="handleSend" :disabled="isRunning" />
  <button @click="handleSend" :disabled="isRunning">Send</button>
  <button v-if="isRunning" @click="abort">Stop</button>
</template>
```

Messages stream in reactively as the agent responds. That's the entire setup.

## Backend Compatibility

Works with any AG-UI compatible backend:

- [PydanticAI](https://ai.pydantic.dev/ui/ag-ui/) via `AGUIAdapter`
- [LangGraph](https://langchain-ai.github.io/langgraph/) — first-party AG-UI support
- [Mastra](https://mastra.ai/) via `@ag-ui/mastra`
- [CrewAI](https://www.crewai.com/) — first-party AG-UI support
- Any server emitting AG-UI SSE events

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — [&effect data solutions GmbH](https://and-effect.com)
