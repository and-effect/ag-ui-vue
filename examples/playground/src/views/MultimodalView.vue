<template>
  <AppChatPanel
    :messages="chat.messages.value"
    :streaming-content="chat.streamingContent.value"
    :is-running="chat.isRunning.value"
    :error="chat.error.value"
    attachments
    placeholder="Ask about an attached file, or just chat…"
    empty-title="Attach an image or a document with the paperclip, then ask about it."
    @send="chat.send"
    @abort="chat.abort"
  />
</template>

<script setup lang="ts">
import { useAgent } from '@and-effect/ag-ui-vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import { inspect } from '@/composables/useEventInspector'

const chat = useAgent({ url: '/api/multimodal' })
inspect(chat.agent)

// Nothing multimodal-specific here: AgMessageInput (inside AppComposer)
// turns attached files into ContentPart[] and send() accepts
// `string | ContentPart[]`. AppMessageContent renders the parts back.
</script>
