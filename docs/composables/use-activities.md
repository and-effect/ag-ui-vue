# `useActivities`

A live view of the agent's activities (`ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`): structured progress such as "checked 3 of 4 registers". Each entry is the activity message itself, with `activityType` to branch on and `content` as an object with every snapshot and patch applied.

```ts
const { agent, isRunning } = useAgent({ url: '/api/agent' })
const { activityList } = useActivities(agent)
```

```vue
<template v-if="isRunning">
  <div v-for="a in activityList" :key="a.id">
    <span v-if="a.activityType === 'records-search'">Checked {{ a.content.checked }} of {{ a.content.total }}</span>
  </div>
</template>
```

The client applies snapshots (`replace` included) and JSON Patch deltas to the message in `messages`. This composable indexes those messages rather than applying anything itself, so it always matches what `#activity` shows. Activity messages are also persisted by `useThreads`. The client never sends them back to the server.

## API

### `useActivities(agent)`

```ts
const {
  activities,    // Ref<ReadonlyMap<string, ActivityMessage>> — keyed by message id
  activityList,  // ComputedRef<ActivityMessage[]> — in conversation order
  getActivity,   // (messageId) => ActivityMessage | undefined
} = useActivities(agent)
```

An `ActivityMessage` carries `id`, `activityType`, `content` (an object) and, when present, `subagentRunId`. `activities` changes only when an activity does, not on every streamed token, and an unchanged entry keeps its identity.
