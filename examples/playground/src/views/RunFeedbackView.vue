<template>
  <div class="flex h-full">
    <AppChatPanel
      class="flex-1"
      :messages="chat.messages.value"
      :streaming-content="chat.streamingContent.value"
      :is-running="chat.isRunning.value"
      :error="chat.error.value"
      :suggestions="['What time is it in Tokyo?', 'Tell me a fun fact about clocks']"
      empty-title="Rate a reply and watch it land on the server's trace for the run that produced it."
      @send="chat.send"
      @abort="chat.abort"
    >
      <template #message-actions="{ msg }">
        <div class="flex items-center gap-0.5 text-muted-foreground">
          <Button
            v-for="option in RATINGS"
            :key="option.value"
            variant="ghost"
            size="icon-xs"
            :aria-label="option.label"
            :aria-pressed="ratings[msg.id] === option.value"
            :disabled="!chat.runForMessage(msg.id)"
            :class="ratings[msg.id] === option.value && 'text-foreground'"
            @click="rate(msg.id, option.value)"
          >
            <component :is="option.icon" :class="ratings[msg.id] === option.value && 'fill-current'" />
          </Button>
          <Tooltip v-if="chat.runForMessage(msg.id)">
            <TooltipTrigger as-child>
              <span class="ml-1.5 cursor-default font-mono text-[11px]">
                run {{ shortId(chat.runForMessage(msg.id)!) }}
              </span>
            </TooltipTrigger>
            <TooltipContent class="font-mono">{{ chat.runForMessage(msg.id) }}</TooltipContent>
          </Tooltip>
        </div>
      </template>
    </AppChatPanel>

    <aside class="hidden w-80 shrink-0 overflow-y-auto border-l lg:block">
      <AppPanelSection
        title="Request settings"
        description="Sent as forwardedProps on every request, read fresh each time."
      >
        <div class="space-y-3">
          <label class="flex items-center justify-between gap-3 text-sm">
            Tone
            <Select v-model="tone">
              <SelectTrigger class="w-36" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="pirate">Pirate</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            Creativity
            <Select v-model="creativity">
              <SelectTrigger class="w-36" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="precise">Precise</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="creative">Creative</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </AppPanelSection>

      <AppPanelSection
        title="Server traces"
        description="The backend's record of each run, keyed by the run id the client minted."
      >
        <p v-if="!traces.length" class="text-xs text-muted-foreground">No runs yet.</p>
        <ul class="space-y-2">
          <li v-for="trace in traces" :key="trace.run_id" class="rounded-lg border p-3 text-xs">
            <div class="flex items-center gap-2">
              <span class="font-mono">run {{ shortId(trace.run_id) }}</span>
              <span class="ml-auto flex items-center gap-2 text-muted-foreground">
                <span v-if="count(trace, 'up')" class="flex items-center gap-1">
                  <ThumbsUp class="size-3" />{{ count(trace, 'up') }}
                </span>
                <span v-if="count(trace, 'down')" class="flex items-center gap-1">
                  <ThumbsDown class="size-3" />{{ count(trace, 'down') }}
                </span>
              </span>
            </div>
            <p class="mt-1.5 text-muted-foreground">
              {{ trace.tone }} · temperature {{ trace.temperature }}
            </p>
            <p class="text-muted-foreground">
              {{ messagesPerRun.get(trace.run_id) ?? 0 }} message(s) ·
              {{ trace.input_tokens }} in / {{ trace.output_tokens }} out tokens
            </p>
          </li>
        </ul>
      </AppPanelSection>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ThumbsDown, ThumbsUp } from '@lucide/vue'
import { useAgent } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppPanelSection from '@/components/AppPanelSection.vue'
import { inspect } from '@/composables/useEventInspector'
import type { Rating, Trace } from '@/types/feedback'

const RATINGS = [
  { value: 'up', label: 'Good response', icon: ThumbsUp },
  { value: 'down', label: 'Bad response', icon: ThumbsDown },
] as const

const tone = ref('concise')
const creativity = ref('balanced')

// useAgent mints a run_id per run and stamps every message the run produced
// with it (runForMessage). forwardedProps is a getter, so each request —
// including tool-result continuations — sends the current settings.
const chat = useAgent({
  url: '/api/feedback-chat',
  forwardedProps: () => ({ tone: tone.value, creativity: creativity.value }),
})
inspect(chat.agent)

const ratings = ref<Record<string, Rating>>({})
const traces = ref<Trace[]>([])

// One run can produce several messages (tool call, tool result, reply), so a
// run id is not a message key. messageRuns is the message id → run id map.
const messagesPerRun = computed(() => {
  const counts = new Map<string, number>()
  for (const runId of chat.messageRuns.value.values()) counts.set(runId, (counts.get(runId) ?? 0) + 1)
  return counts
})

// Run provenance lands when a run resolves, so refresh traces then.
watch(chat.isRunning, (running) => {
  if (!running) refreshTraces()
})

async function rate(messageId: string, rating: Rating) {
  const runId = chat.runForMessage(messageId)
  if (!runId) return
  // Clicking the active rating again clears it.
  const next = ratings.value[messageId] === rating ? null : rating
  if (next) ratings.value[messageId] = next
  else delete ratings.value[messageId]

  // Feedback is keyed by message, joined to the server's trace by run id.
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId: chat.agent.threadId, runId, messageId, rating: next }),
  })
  await refreshTraces()
}

async function refreshTraces() {
  const response = await fetch(`/api/feedback/traces?thread_id=${encodeURIComponent(chat.agent.threadId)}`)
  if (response.ok) traces.value = await response.json()
}

function count(trace: Trace, rating: Rating) {
  return Object.values(trace.ratings).filter((r) => r === rating).length
}

function shortId(id: string) {
  return id.slice(0, 8)
}
</script>
