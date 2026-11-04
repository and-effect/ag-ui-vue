<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    :disabled="hasPending"
    :placeholder="hasPending ? 'Answer the approvals above to continue…' : undefined"
    :suggestions="['What is on my calendar?', 'Cancel the standup and book a retro on Friday at 15:00']"
    empty-title="Ask the agent to change the calendar — it pauses for your approval before any booking or cancellation."
    @send="chat.send"
    @abort="chat.abort"
  >
    <!-- AgInterrupt renders no wrapper of its own; the layout is ours. -->
    <div v-if="hasPending" class="flex flex-col gap-3">
      <AgInterrupt :agent="chat">
        <template #default="{ interrupt, toolName, args }">
          <AppInterruptCard
            :interrupt
            :tool-name
            :args
            :locked="chat.isRunning.value"
          />
        </template>
        <template #resume="{ canResume, resumeAll }">
          <Button class="self-start" size="sm" :disabled="!canResume" @click="resumeAll()">
            Continue
          </Button>
        </template>
      </AgInterrupt>
    </div>
  </AppChatPanel>
</template>

<script setup lang="ts">
import { AgInterrupt, useAgent, useInterrupts } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppInterruptCard from '@/components/AppInterruptCard.vue'
import { inspect } from '@/composables/useEventInspector'

const chat = useAgent({ url: '/api/interrupts' })
inspect(chat.agent)

// The tools live on the server and are declared requires_approval there, so
// nothing is registered here. A run that calls one ends with an interrupt
// outcome; AgInterrupt renders a card per interrupt, each card stages an
// answer, and Continue sends them all as one resume.
const { hasPending } = useInterrupts(chat)
</script>
