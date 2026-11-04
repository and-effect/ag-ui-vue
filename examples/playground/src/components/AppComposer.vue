<template>
  <!-- AgMessageInput owns the text + attachment state and builds the
       string | ContentPart[] payload; this component is only its look. -->
  <AgMessageInput
    v-slot="{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, attachments: files, canSend }"
    :is-running="isRunning"
    :disabled="disabled"
    @send="emit('send', $event)"
    @abort="emit('abort')"
  >
    <form
      class="rounded-2xl border bg-card shadow-xs transition-shadow focus-within:ring-3 focus-within:ring-ring/25"
      @submit.prevent="onSubmit"
    >
      <div v-if="files.length" class="flex flex-wrap gap-2 px-3 pt-3">
        <div v-for="(file, i) in files" :key="i" class="group/file relative">
          <img
            v-if="file.type === 'image' && previewSrc(file.source)"
            :src="previewSrc(file.source)!"
            :alt="partLabel(file)"
            class="size-14 rounded-lg border object-cover"
          />
          <span
            v-else
            class="flex h-14 max-w-40 items-center gap-1.5 rounded-lg border bg-muted px-3 text-xs text-muted-foreground"
          >
            <FileText class="size-4 shrink-0" />
            <span class="truncate">{{ partLabel(file) }}</span>
          </span>
          <button
            type="button"
            class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background opacity-0 shadow-xs transition-opacity group-hover/file:opacity-100 focus-visible:opacity-100"
            :aria-label="`Remove ${partLabel(file)}`"
            @click="onRemoveAttachment(i)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <textarea
        :value="value"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        class="block max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 text-sm outline-none field-sizing-content placeholder:text-muted-foreground disabled:cursor-not-allowed"
        @input="onInput"
        @keydown="onKeydown($event, onSubmit)"
      />

      <div class="flex items-center justify-between px-2 pb-2">
        <div>
          <template v-if="attachments">
            <input
              ref="fileInput"
              type="file"
              multiple
              class="hidden"
              accept="image/*,audio/*,video/*,.pdf,.txt,.md,.csv,.docx"
              @change="onFileChange($event, onAttach)"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="rounded-full text-muted-foreground"
              aria-label="Attach file"
              :disabled="disabled"
              @click="fileInput?.click()"
            >
              <Paperclip />
            </Button>
          </template>
        </div>
        <Button
          v-if="!isRunning"
          type="submit"
          size="icon-sm"
          class="rounded-full"
          aria-label="Send"
          :disabled="!canSend"
        >
          <ArrowUp />
        </Button>
        <Button
          v-else
          type="button"
          size="icon-sm"
          class="rounded-full"
          aria-label="Stop"
          @click="onAbort"
        >
          <Square class="fill-current" />
        </Button>
      </div>
    </form>
  </AgMessageInput>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUp, FileText, Paperclip, Square, X } from '@lucide/vue'
import type { ContentPart } from '@and-effect/ag-ui-vue'
import { AgMessageInput } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import { partLabel, previewSrc } from '@/lib/content'

const {
  isRunning,
  disabled = false,
  placeholder = 'Send a message…',
  attachments = false,
} = defineProps<{
  isRunning: boolean
  disabled?: boolean
  placeholder?: string
  /** Show the attach button (images, audio, video, documents). */
  attachments?: boolean
}>()

const emit = defineEmits<{
  send: [content: string | ContentPart[]]
  abort: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function onKeydown(event: KeyboardEvent, submit: () => void) {
  // Enter sends, Shift+Enter adds a newline; never send mid IME composition.
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

async function onFileChange(event: Event, attach: (file: File) => Promise<void>) {
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) await attach(file)
  // Reset so picking the same file again still fires `change`.
  input.value = ''
}
</script>
