import { shallowRef, shallowReadonly, triggerRef, computed, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import type { HttpAgent, AgentSubscriber } from '@ag-ui/client'
import type { ActivityMessage } from '@ag-ui/core'

export interface UseActivitiesReturn {
  /**
   * Every activity message in the conversation, keyed by message id. Each entry
   * is the `ActivityMessage` as the client holds it: `activityType` to branch
   * on, `content` as the structured object with all snapshots and deltas
   * applied, and `subagentRunId` when a subagent produced it (exposed, not grouped).
   */
  activities: Readonly<Ref<ReadonlyMap<string, Readonly<ActivityMessage>>>>
  /** The activities in conversation order. */
  activityList: ComputedRef<Readonly<ActivityMessage>[]>
  /** Look up an activity by message id. */
  getActivity: (messageId: string) => Readonly<ActivityMessage> | undefined
}

/**
 * Live view of an agent's activities (AG-UI 1.0 `ACTIVITY_SNAPSHOT` /
 * `ACTIVITY_DELTA`): structured progress such as "searched 3 of 12 sources".
 *
 * The client already applies both events to the activity message in
 * `agent.messages` — a snapshot seeds or replaces the content (unless
 * `replace: false`), and a delta applies its JSON Patch. This composable
 * indexes those messages rather than applying the events again, so an entry
 * can never disagree with the message it describes. It updates as soon as
 * each event is applied, and follows thread switches and `reset()`.
 *
 * Activity messages also render in `AgMessageList`'s `#activity` slot, live
 * as well. Use this composable for a surface outside the list, such as a
 * progress row above the input, and leave out `#activity` if you do not want
 * both.
 *
 * @param agent - The HttpAgent instance from useAgent
 *
 * @example
 * ```vue
 * <script setup>
 * const { agent, isRunning } = useAgent({ url: '/api/agent' })
 * const { activityList } = useActivities(agent)
 * </script>
 *
 * <template>
 *   <template v-if="isRunning">
 *     <div v-for="a in activityList" :key="a.id">
 *       <span v-if="a.activityType === 'search'">
 *         Searched {{ a.content.done }} of {{ a.content.total }} sources
 *       </span>
 *     </div>
 *   </template>
 * </template>
 * ```
 */
export function useActivities(agent: HttpAgent): UseActivitiesReturn {
  // shallowRef + plain Map, synced in place with one triggerRef per change.
  const activities: Ref<Map<string, ActivityMessage>> = shallowRef(new Map())
  // The serialised form of each indexed entry, to compare against.
  const fingerprints = new Map<string, string>()

  const fingerprint = (msg: ActivityMessage) =>
    JSON.stringify([msg.activityType, msg.subagentRunId ?? null, msg.content])

  /**
   * Bring the index in line with agent.messages. Runs on every messages change
   * (once per streamed token), and signals only when an activity changed.
   * Identity is not enough to tell: the client clones every message on every
   * update, so an untouched activity is a new object on each text token. An
   * entry is therefore replaced only when its content differs, and otherwise
   * keeps its identity, so a component given it as a prop does not re-render.
   */
  function sync() {
    const map = activities.value
    let changed = false
    let seen = 0
    for (const msg of agent.messages) {
      if (msg.role !== 'activity') continue
      seen++
      if (map.get(msg.id) === msg) continue
      const print = fingerprint(msg)
      if (fingerprints.get(msg.id) === print) continue
      map.set(msg.id, msg)
      fingerprints.set(msg.id, print)
      changed = true
    }
    if (seen !== map.size) {
      const present = new Set(agent.messages.map((m) => m.id))
      for (const id of map.keys()) {
        if (present.has(id)) continue
        map.delete(id)
        fingerprints.delete(id)
      }
      changed = true
    }
    if (changed) triggerRef(activities)
  }

  const subscriber: AgentSubscriber = {
    onMessagesChanged: sync,
  }

  sync() // pick up activities already in the transcript (initialMessages, a hydrated thread)
  const subscription = agent.subscribe(subscriber)

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  function getActivity(messageId: string): Readonly<ActivityMessage> | undefined {
    return activities.value.get(messageId)
  }

  // A new id can land mid-transcript (a hydrated thread), so order comes from
  // agent.messages rather than the Map's insertion order. The items are the
  // indexed entries, not the client's latest clones, so they share identity
  // with getActivity().
  const activityList = computed(() => {
    const map = activities.value
    return agent.messages.flatMap((m) => {
      const entry = m.role === 'activity' ? map.get(m.id) : undefined
      return entry ? [entry] : []
    })
  })

  return {
    // shallowReadonly keeps the shallow flag so a plain watch() fires on triggerRef.
    activities: shallowReadonly(activities),
    activityList,
    getActivity,
  }
}
