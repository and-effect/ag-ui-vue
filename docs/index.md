# ag-ui-vue documentation

Guides and API reference for `@and-effect/ag-ui-vue`. For installation and a first chat, start with the [README](../README.md).

Each composable page starts with a guide and ends with an **API** section listing the exact options, return values and types.

## Composables

| Page | What it's for |
| --- | --- |
| [`useAgent`](composables/use-agent.md) | Connect to an AG-UI backend and stream messages into reactive refs. Error handling and retries, run identity, page context, multimodal messages. |
| [`useThreads`](composables/use-threads.md) | Several persisted conversations on one agent (also covers `useThread`). |
| [`useFrontendTool`](composables/use-frontend-tool.md) | Tools the agent calls in the browser, executed automatically or approved by the user. |
| [`useInterrupts`](composables/use-interrupts.md) | Approve, edit or answer server-side tool calls when a run pauses. |
| [`useGenerativeUI`](composables/use-generative-ui.md) | Render Vue components for tool calls as the agent makes them. |
| [`useAgentState`](composables/use-agent-state.md) | Shared state, synced both ways between UI and agent. |
| [`useToolCalls`](composables/use-tool-calls.md) | Live progress of tool calls. |
| [`useReasoning`](composables/use-reasoning.md) | Live view of the agent's reasoning. |
| [`useActivities`](composables/use-activities.md) | Live view of structured progress updates. |
| [`useAgentEvent`](composables/use-agent-event.md) | Subscribe to raw AG-UI events. |

## More

- [Headless components](components.md): `AgMessageList`, `AgMessageInput`, `AgThreadList`, `AgToolCallStatus`, `AgInterrupt`
- [Storage adapters](storage-adapters.md): where `useThreads` persists conversations, and how to write your own adapter
- [Limitations](limitations.md)
