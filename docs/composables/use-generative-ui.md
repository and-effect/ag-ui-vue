# `useGenerativeUI`

Maps tool names to Vue components and renders them as the agent calls those tools. The composable tracks the tool call lifecycle, passes the parsed args as props once they are complete JSON, and auto-registers its tools with the agent — so a bare `send()` advertises them, with nothing to wire up.

```ts
import { useAgent, useGenerativeUI } from '@and-effect/ag-ui-vue'
import WeatherCard from './WeatherCard.vue'
import RecipeCard from './RecipeCard.vue'
import RecipeSkeleton from './RecipeSkeleton.vue'

const agentCtx = useAgent({ url: '/api/agent' })

const { activeComponents, allComponents } = useGenerativeUI(agentCtx, {
  // Minimal: just a component — description and parameters are auto-filled
  show_weather: WeatherCard,

  // Full: component + tool metadata + optional loading state
  show_recipe: {
    component: RecipeCard,
    loading: RecipeSkeleton,          // shown while args are still streaming
    description: 'Display a recipe',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        ingredients: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
})

// Tools are auto-registered — no need to pass them
agentCtx.send('Show me a pasta recipe')
```

Each item in `activeComponents` (or `allComponents`) is a resolved `ActiveGenUI` object:

```vue
<div v-for="item in allComponents" :key="item.id">
  <component :is="item.component" v-bind="item.props" />
</div>
```

Use `activeComponents` to show only in-flight renders (streaming or awaiting result). Use `allComponents` to keep components visible after the tool call completes — the typical pattern for persistent in-chat widgets.

The `loading` component (if configured) is shown while `item.isStreaming` is true and replaced by the main component once args finish streaming.

By default GenUI items persist across runs (`autoClear: false`). Pass `{ autoClear: true }` to clear them when the next run starts.

## API

### `useGenerativeUI(agentContext, registry, options?)`

```ts
const {
  activeComponents,  // ComputedRef<ActiveGenUI[]> — in-flight renders only
  allComponents,     // ComputedRef<ActiveGenUI[]> — includes completed
  tools,             // Tool[] — auto-registered; returned only as an escape hatch
  resolve,           // (toolName: string) => Component | null
  getProps,          // (tc: ReactiveToolCall) => Record<string, any>
  clear,             // () => void
} = useGenerativeUI(agentCtx, registry, {
  autoClear: false,  // Optional, default false
})
```

Each `ActiveGenUI` item:

```ts
interface ActiveGenUI {
  id: string           // Tool call ID — use as :key in v-for
  name: string         // Tool name
  component: Component // Main component (or loading component while isStreaming)
  props: Record<string, any>  // Parsed tool call args
  isStreaming: boolean // True while args are still arriving
  status: ToolCallStatus      // 'running' | 'awaiting_result' | 'completed' | 'error'
}
```

Registry entries can be a bare component or a full `GenUIEntry`:

```ts
interface GenUIEntry {
  component: Component   // Required
  description?: string   // Tool description sent to the agent
  parameters?: any       // JSON Schema — sent to the agent
  loading?: Component    // Shown while args stream; falls back to component
}
```
