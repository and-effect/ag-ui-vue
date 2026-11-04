<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    :suggestions="['What time is it in Tokyo?', 'Compare the time in New York and Sydney']"
    empty-title="Ask for the time anywhere — the agent calls a tool on the server and answers with the result."
    @send="chat.send"
    @abort="chat.abort"
  />
</template>

<script setup lang="ts">
import { useAgent } from '@and-effect/ag-ui-vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import { inspect } from '@/composables/useEventInspector'

// The simplest setup: no tools registered here. get_current_time is defined and
// executed on the backend; its call and result arrive in `messages`, and
// AppChatPanel renders them as a tool call row.
const chat = useAgent({ url: '/api/backend-tools' })
inspect(chat.agent)
</script>
