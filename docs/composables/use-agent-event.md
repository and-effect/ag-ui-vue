# `useAgentEvent`

Low-level event subscription with automatic cleanup on scope dispose.

```ts
const { agent } = useAgent({ url: '/api/agent' })

useAgentEvent(agent, {
  onToolCallStartEvent({ event }) {
    console.log('Tool called:', event.toolCallName)
  },
  onCustomEvent({ event }) {
    // Handle custom backend events
  },
})
```

## API

### `useAgentEvent(agent, subscriber)`

```ts
useAgentEvent(agent, {
  onToolCallStartEvent({ event }) { ... },
  onToolCallEndEvent({ event }) { ... },
  onCustomEvent({ event }) { ... },
  // Any AgentSubscriber method
})
```
