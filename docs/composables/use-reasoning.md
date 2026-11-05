# `useReasoning`

A live view of the agent's reasoning while the run is still going (AG-UI 1.0's `REASONING_*` events). The protocol has two separate things: **spans** (`REASONING_START` / `END`, "the agent is thinking") and **reasoning messages** (the streamed text). A reasoning message does not have to sit inside a span, so both are tracked:

```ts
const { agent, messages } = useAgent({ url: '/api/agent' })
const { isReasoning, getReasoning } = useReasoning(agent)
```

```vue
<AgMessageList :messages="messages">
  <template #reasoning="{ msg, content }">
    <details :open="getReasoning(msg.id)?.status === 'streaming'">
      <summary>{{ getReasoning(msg.id)?.status === 'streaming' ? 'Thinking…' : 'Reasoning' }}</summary>
      {{ content }}
    </details>
  </template>
</AgMessageList>
<p v-if="isReasoning">Thinking…</p>
```

**Render the text in one place.** The client streams reasoning into the message in `messages`, so the `#reasoning` slot is already live. Use `getReasoning(msg.id)` there for status and timing. Render the text from `reasoningMessages` instead only if you leave out `#reasoning`; with both, it shows twice while it streams.

Entries belong to the current run (`autoClear`, default `true`). An entry still open when its run ends (an error, `abort()`, the next run starting) gets status `error`, so a thinking indicator never sticks. A settled entry whose message leaves the conversation (thread switch, `reset()`) is dropped.

## API

### `useReasoning(agent, options?)`

```ts
const {
  reasoningMessages,  // Ref<ReadonlyMap<string, ReasoningMessageEntry>> — keyed by message id
  openSpans,          // Ref<ReadonlyMap<string, ReasoningSpan>> — open spans only, keyed by span id
  streamingMessages,  // ComputedRef<ReasoningMessageEntry[]>
  isReasoning,        // ComputedRef<boolean> — a span is open or a message is streaming
  getReasoning,       // (messageId) => ReasoningMessageEntry | undefined
  clear,              // () => void
} = useReasoning(agent, { autoClear: true })
```

Each `ReasoningMessageEntry` carries `id`, `content` (accumulated), `status` (`'streaming' | 'complete' | 'error'`), `startedAt` / `completedAt` / `duration`, and, when present, `subagentRunId` and `encryptedValue`. A `ReasoningSpan` carries `id`, `startedAt` and, when present, `subagentRunId`. `subagentRunId` is exposed as-is; entries are not grouped by it. Entries are plain objects: a change replaces the entry rather than editing it, so passing one as a prop updates the child.
