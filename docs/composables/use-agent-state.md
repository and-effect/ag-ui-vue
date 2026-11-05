# `useAgentState`

Bidirectional JSON state synced via `STATE_SNAPSHOT` and `STATE_DELTA` events. Updates live as the agent streams.

`state` is a writable `reactive()` object — mutate it directly (even deeply, or via `v-model`) and a deep watcher syncs the change to `agent.state`, so it is sent in `RunAgentInput.state` on the next run. There is no `setState`; mutation is the sync mechanism.

```ts
interface RecipeState {
  recipe: { title: string; ingredients: string[]; instructions: string[] } | null
}

const { agent, send, isRunning } = useAgent({ url: '/api/agent' })
const { state } = useAgentState<RecipeState>(agent, {
  initialState: { recipe: null },
})

// Write from the frontend by mutating directly — the change syncs to the agent
state.recipe = null
state.recipe?.ingredients.push('guanciale')
```

```html
<div v-if="state.recipe">
  <h2>{{ state.recipe.title }}</h2>
  <ul><li v-for="step in state.recipe.instructions" :key="step">{{ step }}</li></ul>
</div>
<input v-model="state.recipe.title" />
<button @click="send('Generate a pasta recipe')" :disabled="isRunning">Generate</button>
```

## API

### `useAgentState<T>(agent, options?)`

```ts
const {
  state,       // T — writable reactive() object; updates on STATE_SNAPSHOT / STATE_DELTA
} = useAgentState<MyState>(agent, {
  initialState: { ... },
})
```

`state` is a writable `reactive()` object. Mutate it directly (even deeply, or via `v-model`) — a deep watcher syncs the change to `agent.state`, so it is sent in `RunAgentInput.state` on the next run. There is no `setState`; mutation is the sync mechanism. Inbound `STATE_SNAPSHOT` / `STATE_DELTA` events update the same object in place.
