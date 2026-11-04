<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    :disabled="!!pending"
    :placeholder="pending ? 'Pick an option above to continue…' : undefined"
    :suggestions="['What time is it in Asia?', 'What time is it in America?']"
    empty-title="Ask about a region instead of a city — the agent will ask you to narrow it down."
    @send="chat.send"
    @abort="chat.abort"
  >
    <div v-if="pending" class="w-full max-w-md rounded-xl border bg-card p-4 shadow-xs">
      <div class="mb-3 flex items-center gap-2">
        <ListChecks class="size-4 text-muted-foreground" />
        <p class="text-sm font-medium">{{ pending.args.question }}</p>
      </div>
      <div class="flex flex-col gap-1.5">
        <Button
          v-for="option in pending.args.options"
          :key="option"
          variant="outline"
          class="justify-start font-normal"
          @click="answer(option)"
        >
          {{ option }}
        </Button>
      </div>
      <form class="mt-3 flex gap-2" @submit.prevent="answer(customAnswer.trim())">
        <Input v-model="customAnswer" placeholder="Or type your own…" class="h-9" />
        <Button type="submit" variant="secondary" :disabled="!customAnswer.trim()">Send</Button>
      </form>
    </div>
  </AppChatPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ListChecks } from '@lucide/vue'
import { useAgent, useFrontendTool } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AppChatPanel from '@/components/AppChatPanel.vue'
import { inspect } from '@/composables/useEventInspector'

const chat = useAgent({ url: '/api/hitl' })
inspect(chat.agent)

// No handler → human in the loop. The run ends with this call unresolved;
// respond() submits the tool result and the agent continues automatically.
// Plain JSON Schema works too — Zod is optional.
const choice = useFrontendTool(chat, {
  name: 'choice',
  description:
    'Present the user with a multiple-choice question and wait for their selection. ' +
    'Use this whenever you need the user to pick one option from a list before proceeding.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: { type: 'array', items: { type: 'string' }, description: 'The list of choices to present' },
    },
    required: ['question', 'options'],
  },
})

const customAnswer = ref('')

const pending = computed(() => choice.calls.value.find((call) => call.status === 'pending'))

function answer(selected: string) {
  customAnswer.value = ''
  pending.value?.respond?.({ selected })
}
</script>
