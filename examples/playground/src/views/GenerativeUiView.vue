<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    :suggestions="['What time is it in Tokyo?', 'Is it day or night in New York?', 'Show me London and Berlin']"
    empty-title="Ask about the time anywhere — the agent answers with components, not text."
    @send="chat.send"
    @abort="chat.abort"
  >
    <template #tool-calls="{ toolCalls, results }">
      <div class="flex flex-wrap items-start gap-3">
        <template v-for="tc in toolCalls" :key="tc.id">
          <component
            :is="componentsById.get(tc.id)!.component"
            v-if="componentsById.has(tc.id)"
            v-bind="componentsById.get(tc.id)!.props"
          />
          <!-- Backend tools (get_current_time) keep the default row -->
          <AppToolCallRow
            v-else
            :name="tc.function.name"
            :args="tc.function.arguments"
            :result="results.get(tc.id)"
            :running="chat.isRunning.value"
          />
        </template>
      </div>
    </template>
  </AppChatPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgent, useGenerativeUI } from '@and-effect/ag-ui-vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppToolCallRow from '@/components/AppToolCallRow.vue'
import ClockCard from '@/components/ClockCard.vue'
import DayNightCard from '@/components/DayNightCard.vue'
import GenUiCardSkeleton from '@/components/GenUiCardSkeleton.vue'
import { inspect } from '@/composables/useEventInspector'

const chat = useAgent({ url: '/api/generative-ui' })
inspect(chat.agent)

// Each entry becomes a frontend tool. When the agent calls it, the component
// renders with the tool arguments as props; the tool result `{ rendered: true }`
// is submitted for you so the agent can continue.
const { allComponents } = useGenerativeUI(chat, {
  show_clock: {
    component: ClockCard,
    loading: GenUiCardSkeleton,
    description: 'Render a clock card showing the current time in a location',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Display name for the city or location' },
        timezone: { type: 'string', description: 'IANA timezone identifier' },
        time: { type: 'string', description: 'Formatted time string, e.g. "14:32"' },
        is_night: { type: 'boolean', description: 'Whether it is currently nighttime' },
      },
      required: ['city', 'timezone', 'time', 'is_night'],
    },
  },
  show_day_night: {
    component: DayNightCard,
    loading: GenUiCardSkeleton,
    description: 'Render a day/night indicator card for a location',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Display name for the city or location' },
        timezone: { type: 'string', description: 'IANA timezone identifier' },
        hour: { type: 'number', description: 'Current hour (0–23) in local time' },
        is_night: { type: 'boolean', description: 'Whether it is currently nighttime' },
      },
      required: ['city', 'timezone', 'hour', 'is_night'],
    },
  },
})

// GenUI items are keyed by tool call id, so they can render in place of the
// tool call that produced them.
const componentsById = computed(() => new Map(allComponents.value.map((item) => [item.id, item])))
</script>
