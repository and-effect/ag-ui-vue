<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    :shows-progress="runningActivities.some((a) => a.content.current)"
    :suggestions="[
      'Find a time for a call between Berlin, New York and Tokyo',
      'Is anyone in London, Singapore or San Francisco still at work right now?',
    ]"
    empty-title="The agent thinks first, then looks up each timezone, and you can watch both while it works. Reasoning needs a model that reasons (see the backend file)."
    @send="chat.send"
    @abort="chat.abort"
  >
    <!-- Reasoning renders in place. The text comes from the message, which the
         client streams into; useReasoning adds status and timing by id. -->
    <template #reasoning="{ msg, content }">
      <AppReasoningPanel :content="content" :live="getReasoning(msg.id)" />
    </template>

    <!-- The exchange in flight shows its activity in the progress row below,
         so the list leaves that one out until the run is over. -->
    <template #activity="{ msg }">
      <div
        v-if="msg.role === 'activity' && msg.activityType === ACTIVITY_TYPE && !runningActivities.some((a) => a.id === msg.id)"
        class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Check class="size-3.5 text-success" />
        <span>Checked {{ msg.content.total }} timezones</span>
        <span v-for="r in msg.content.results" :key="r.timezone" class="rounded-full border px-2 py-0.5 text-xs tabular-nums">
          {{ city(r.timezone) }} {{ r.time }}
        </span>
      </div>
    </template>

    <template #composer>
      <div
        v-for="activity in runningActivities"
        :key="activity.id"
        class="mb-2 rounded-lg border bg-card px-3 py-2 text-sm"
      >
        <div class="flex items-center gap-2">
          <Loader2 v-if="activity.content.current" class="size-3.5 animate-spin text-muted-foreground" />
          <Check v-else class="size-3.5 text-success" />
          <span>{{ activity.content.current ? `Looking up ${city(activity.content.current)}…` : 'All timezones checked' }}</span>
          <span class="ml-auto text-xs text-muted-foreground tabular-nums">
            {{ activity.content.checked }} / {{ activity.content.total }}
          </span>
        </div>
        <div class="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full bg-primary transition-all"
            :style="{ width: `${(100 * activity.content.checked) / Math.max(1, activity.content.total)}%` }"
          />
        </div>
        <div v-if="activity.content.results.length" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="r in activity.content.results"
            :key="r.timezone"
            class="rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums"
          >
            {{ city(r.timezone) }} {{ r.time }}
          </span>
        </div>
      </div>
    </template>
  </AppChatPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Loader2 } from '@lucide/vue'
import { useActivities, useAgent, useReasoning } from '@and-effect/ag-ui-vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppReasoningPanel from '@/components/AppReasoningPanel.vue'
import { inspect } from '@/composables/useEventInspector'

/** The activity type `check_timezones` reports on the backend. */
const ACTIVITY_TYPE = 'timezone-lookup'

const chat = useAgent({ url: '/api/reasoning' })
inspect(chat.agent)

const { getReasoning } = useReasoning(chat.agent)
const { activityList } = useActivities(chat.agent)

// The progress row: activities of the exchange in flight (after the last user
// message), while it is running. Earlier ones stay in the list.
const runningActivities = computed(() => {
  if (!chat.isRunning.value) return []
  const messages = chat.messages.value
  const lastUser = messages.map((m) => m.role).lastIndexOf('user')
  const current = new Set(messages.slice(lastUser + 1).map((m) => m.id))
  return activityList.value.filter((a) => a.activityType === ACTIVITY_TYPE && current.has(a.id))
})

/** 'America/New_York' → 'New York'. */
function city(timezone: string): string {
  return timezone.split('/').at(-1)!.replaceAll('_', ' ')
}
</script>
