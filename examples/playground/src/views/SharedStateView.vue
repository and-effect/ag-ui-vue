<template>
  <div class="flex h-full">
    <AppChatPanel
      class="flex-1"
      :messages="chat.messages.value"
      :streaming-content="chat.streamingContent.value"
      :is-running="chat.isRunning.value"
      :error="chat.error.value"
      :suggestions="['What time is it in Tokyo?', 'Remember Berlin as my home timezone', 'What time is it?']"
      empty-title="Ask about timezones and watch the shared state update. Set a preferred one on the right, then ask “what time is it?”."
      @send="chat.send"
      @abort="chat.abort"
    />

    <aside class="hidden w-80 shrink-0 overflow-y-auto border-l lg:block">
      <AppPanelSection title="Preferred timezone" description="Written by you or by the agent.">
        <div class="flex gap-2">
          <!-- v-model straight onto the shared state — that's the whole sync -->
          <Select v-model="state.preferred_timezone">
            <SelectTrigger class="flex-1">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="tz in timezoneOptions" :key="tz" :value="tz">{{ tz }}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            v-if="state.preferred_timezone"
            variant="ghost"
            size="icon"
            aria-label="Clear preferred timezone"
            @click="state.preferred_timezone = null"
          >
            <X />
          </Button>
        </div>
      </AppPanelSection>

      <AppPanelSection title="History" description="Written by the agent on every lookup.">
        <p v-if="!state.timezone_history.length" class="text-xs text-muted-foreground">Nothing yet.</p>
        <ul class="space-y-0.5">
          <li v-for="tz in state.timezone_history" :key="tz">
            <button
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-accent"
              @click="state.preferred_timezone = tz"
            >
              {{ tz }}
              <Star
                v-if="tz === state.preferred_timezone"
                class="ml-auto size-3.5 fill-warning text-warning"
              />
            </button>
          </li>
        </ul>
      </AppPanelSection>

      <AppPanelSection title="State">
        <pre class="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{{ stateJson }}</pre>
      </AppPanelSection>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Star, X } from '@lucide/vue'
import { useAgent, useAgentState } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppPanelSection from '@/components/AppPanelSection.vue'
import { inspect } from '@/composables/useEventInspector'

interface TimezoneState {
  timezone_history: string[]
  preferred_timezone: string | null
}

const COMMON_TIMEZONES = ['Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']

const chat = useAgent({ url: '/api/shared-state' })
inspect(chat.agent)

// `state` is a writable reactive object:
//   agent → you: STATE_SNAPSHOT / STATE_DELTA events update it in place
//   you → agent: mutate it; the change is sent with the next run
const { state } = useAgentState<TimezoneState>(chat.agent, {
  initialState: { timezone_history: [], preferred_timezone: null },
})

const timezoneOptions = computed(() => [...new Set([...state.timezone_history, ...COMMON_TIMEZONES])])
const stateJson = computed(() => JSON.stringify(state, null, 2))
</script>
