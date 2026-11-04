import { defineComponent, h, Fragment, type PropType, type VNode } from 'vue'
import type { DeepReadonly } from 'vue'
import type { ThreadMeta } from '../composables/useThreads'

type AnyThreadMeta = ThreadMeta | DeepReadonly<ThreadMeta>

/**
 * Headless thread list. Iterates threads and delegates rendering entirely to
 * named slots, exposing active state and event handlers per thread item.
 *
 * Slots:
 * - `#thread="{ thread, isActive, onSwitch, onDelete }"` — rendered for each thread
 * - `#empty` — rendered when the threads array is empty
 *
 * Events: `switch(id)`, `create()`, `delete(id)`
 *
 * @example
 * <AgThreadList :threads="threads" :active-thread-id="activeThreadId"
 *               @switch="switchThread" @delete="deleteThread">
 *   <template #thread="{ thread, isActive, onSwitch, onDelete }">
 *     <button @click="onSwitch" :class="{ active: isActive }">
 *       {{ thread.title ?? 'New conversation' }}
 *       <span @click.stop="onDelete">✕</span>
 *     </button>
 *   </template>
 *   <template #empty>No threads yet</template>
 * </AgThreadList>
 */
export const AgThreadList = defineComponent({
  name: 'AgThreadList',
  props: {
    threads: {
      type: Array as PropType<readonly AnyThreadMeta[]>,
      required: true,
    },
    activeThreadId: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
  emits: {
    switch: (_id: string) => true,
    create: () => true,
    delete: (_id: string) => true,
  },
  setup(props, { slots, emit }) {
    return () => {
      const vnodes: VNode[] = []

      if (props.threads.length === 0) {
        vnodes.push(...(slots.empty?.() ?? []))
      } else {
        props.threads.forEach((thread) => {
          vnodes.push(
            ...(slots.thread?.({
              thread,
              isActive: thread.id === props.activeThreadId,
              onSwitch: () => emit('switch', thread.id),
              onDelete: () => emit('delete', thread.id),
            }) ?? []),
          )
        })
      }

      return h(Fragment, vnodes)
    }
  },
})
