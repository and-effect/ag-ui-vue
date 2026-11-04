<template>
  <div class="flex h-full min-h-0 flex-col">
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto" @scroll="onScroll">
      <div ref="contentEl" class="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8">
        <AgMessageList :messages="messages" :streaming-content="streamingContent">
          <template #user="{ msg }">
            <div class="flex justify-end">
              <div class="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5">
                <AppMessageContent :content="msg.content" />
              </div>
            </div>
          </template>

          <template #assistant="{ msg, content }">
            <div v-if="content" class="flex flex-col gap-2">
              <AppMarkdown :source="content" />
              <slot name="message-actions" :msg="msg" />
            </div>
          </template>

          <template #assistant-tool-calls="{ msg, toolCalls }">
            <div class="flex flex-col gap-2">
              <AppMarkdown v-if="msg.content" :source="msg.content" />
              <slot name="tool-calls" :tool-calls="toolCalls" :results="toolResults">
                <AppToolCallRow
                  v-for="tc in toolCalls"
                  :key="tc.id"
                  :name="tc.function.name"
                  :args="tc.function.arguments"
                  :result="toolResults.get(tc.id)"
                  :running="isRunning"
                />
              </slot>
              <slot v-if="msg.content" name="message-actions" :msg="msg" />
            </div>
          </template>

          <!-- #tool-result intentionally omitted: results render inside their tool call row -->

          <!-- Reasoning and activity render only for demos that provide these slots. -->
          <template v-if="$slots.reasoning" #reasoning="{ msg, content }">
            <slot name="reasoning" :msg="msg" :content="content ?? ''" />
          </template>

          <template v-if="$slots.activity" #activity="{ msg }">
            <slot name="activity" :msg="msg" />
          </template>

          <template #streaming="{ content }">
            <AppMarkdown :source="content" streaming />
          </template>

          <template #empty>
            <div class="flex flex-col items-center gap-4 py-16 text-center">
              <p class="text-sm text-muted-foreground">{{ emptyTitle }}</p>
              <div v-if="suggestions.length" class="flex flex-wrap justify-center gap-2">
                <button
                  v-for="suggestion in suggestions"
                  :key="suggestion"
                  class="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
                  :disabled="disabled"
                  @click="emit('send', suggestion)"
                >
                  {{ suggestion }}
                </button>
              </div>
            </div>
          </template>
        </AgMessageList>

        <slot />

        <div v-if="isThinking" class="flex gap-1 py-2" aria-label="Thinking">
          <span
            v-for="i in 3"
            :key="i"
            class="size-1.5 animate-pulse rounded-full bg-muted-foreground"
            :style="{ animationDelay: `${i * 150}ms` }"
          />
        </div>

        <div
          v-if="error"
          class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <CircleAlert class="mt-0.5 size-4 shrink-0" />
          {{ error }}
        </div>
      </div>
    </div>

    <div class="mx-auto w-full max-w-2xl px-4 pb-4">
      <slot name="composer" />
      <AppComposer
        :is-running="isRunning"
        :disabled="disabled"
        :placeholder="placeholder"
        :attachments="attachments"
        @send="emit('send', $event)"
        @abort="emit('abort')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeepReadonly } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { contentToText } from '@ag-ui/core'
import { CircleAlert } from '@lucide/vue'
import type { ContentPart, Message, ToolCall } from '@and-effect/ag-ui-vue'
import { AgMessageList } from '@and-effect/ag-ui-vue'
import AppComposer from '@/components/AppComposer.vue'
import AppMarkdown from '@/components/AppMarkdown.vue'
import AppMessageContent from '@/components/AppMessageContent.vue'
import AppToolCallRow from '@/components/AppToolCallRow.vue'

const {
  messages,
  streamingContent,
  isRunning,
  error,
  placeholder,
  disabled = false,
  attachments = false,
  emptyTitle = 'Start a conversation',
  suggestions = [],
  showsProgress = false,
} = defineProps<{
  messages: readonly (Message | DeepReadonly<Message>)[]
  streamingContent: string
  isRunning: boolean
  error: string | null
  placeholder?: string
  disabled?: boolean
  attachments?: boolean
  emptyTitle?: string
  /** Example prompts shown in the empty state; clicking one sends it. */
  suggestions?: string[]
  /** The view shows its own progress indicator right now (e.g. a progress row); hides the thinking dots. */
  showsProgress?: boolean
}>()

const emit = defineEmits<{
  send: [content: string | ContentPart[]]
  abort: []
}>()

defineSlots<{
  /** Replaces the default tool-call rows (e.g. to render generative UI). */
  'tool-calls'?: (props: {
    toolCalls: readonly (ToolCall | DeepReadonly<ToolCall>)[]
    results: ReadonlyMap<string, string>
  }) => unknown
  /** Below each finished assistant reply that has text (e.g. feedback buttons). */
  'message-actions'?: (props: { msg: Message | DeepReadonly<Message> }) => unknown
  /** A `reasoning` message, in place (AgMessageList's #reasoning). */
  reasoning?: (props: { msg: Message | DeepReadonly<Message>; content: string }) => unknown
  /** An `activity` message, in place (AgMessageList's #activity). */
  activity?: (props: { msg: Message | DeepReadonly<Message> }) => unknown
  /** Rendered after the messages — the place for human-in-the-loop cards. */
  default?: () => unknown
  /** Extra content above the input (e.g. hints). */
  composer?: () => unknown
}>()

const scrollEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)

// Tool results arrive as separate `role: 'tool'` messages. Index them by call
// id so each tool call row can show its own result instead of an extra bubble.
const toolResults = computed(
  () =>
    new Map(
      messages.flatMap((m) =>
        m.role === 'tool' ? [[m.toolCallId, contentToText(m.content as string | ContentPart[])] as const] : [],
      ),
    ),
)

// Show a thinking indicator until the first token, tool call or reasoning of a
// run lands (a reasoning panel is its own indicator), or while the view shows
// its own progress.
const isThinking = computed(
  () =>
    isRunning &&
    !showsProgress &&
    !streamingContent &&
    !['assistant', 'reasoning'].includes(messages.at(-1)?.role ?? ''),
)

// Follow new content (tokens, tool rows, approval cards) while the user is at
// the bottom; stop following once they scroll up to read.
useResizeObserver(contentEl, () => {
  if (stickToBottom.value) scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight })
})

function onScroll() {
  const el = scrollEl.value
  if (el) stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}
</script>
