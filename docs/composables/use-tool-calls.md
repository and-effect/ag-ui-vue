# `useToolCalls`

Optional observability composable for showing live tool execution progress. Not required for tool execution — `useFrontendTool` handles that. Pair with `AgToolCallStatus` to render without manual branching:

```ts
const { activeToolCalls } = useToolCalls(agent)
```

```vue
<AgToolCallStatus :tool-calls="activeToolCalls">
  <template #running="{ name }">⚙️ {{ name }}…</template>
  <template #completed="{ name, duration }">✅ {{ name }} ({{ duration }}ms)</template>
</AgToolCallStatus>
```

## API

### `useToolCalls(agent, options?)`

```ts
const {
  activeToolCalls,     // ComputedRef<ReactiveToolCall[]>
  completedToolCalls,  // ComputedRef<ReactiveToolCall[]>
  getToolCall,         // (id) => ReactiveToolCall | undefined
  getToolResult,       // (toolCallId, messages) => Message | undefined
  markCompleted,       // (toolCallId, result?) => void
  clear,               // () => void
} = useToolCalls(agent, { autoClear: true })
```

Each `ReactiveToolCall` carries `id`, `name`, `args` (raw, streaming), `parsedArgs`, `status`, `startedAt` / `completedAt` / `duration`, and two result fields. **`result`** is the result as text — since AG-UI 1.0 a tool result may be multimodal, so this is the flattened text and drops any media parts. **`resultContent`** holds the unflattened `string | ContentPart[]`; read it if your tools return images or other media.
