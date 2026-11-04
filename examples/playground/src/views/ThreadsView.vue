<template>
  <div class="flex h-full">
    <aside class="hidden w-64 shrink-0 flex-col border-r sm:flex">
      <div class="p-3">
        <Button variant="outline" class="w-full justify-start" @click="createThread()">
          <Plus />
          New thread
        </Button>
      </div>
      <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        <AgThreadList
          :threads="threads"
          :active-thread-id="activeThreadId"
          @switch="switchThread"
          @delete="deleteThread"
        >
          <template #thread="{ thread, isActive, onSwitch, onDelete }">
            <div
              :key="thread.id"
              class="group/thread relative rounded-md transition-colors"
              :class="isActive ? 'bg-accent' : 'hover:bg-accent/50'"
            >
              <button class="w-full px-3 py-2 pr-9 text-left" @click="onSwitch">
                <p class="truncate text-sm" :class="isActive && 'font-medium'">
                  {{ thread.title ?? 'New conversation' }}
                </p>
                <p class="text-xs text-muted-foreground">{{ relativeTime(thread.updatedAt) }}</p>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/thread:opacity-100 focus-visible:opacity-100"
                aria-label="Delete thread"
                @click="onDelete"
              >
                <Trash2 />
              </Button>
            </div>
          </template>
          <template #empty>
            <p class="px-3 py-6 text-center text-xs text-muted-foreground">No threads yet.</p>
          </template>
        </AgThreadList>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-12 shrink-0 items-center border-b px-6">
        <input
          v-if="isEditingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="w-full bg-transparent text-sm font-medium outline-none"
          @keydown.enter="commitTitle"
          @keydown.escape="isEditingTitle = false"
          @blur="commitTitle"
        />
        <button
          v-else
          class="truncate text-sm font-medium disabled:text-muted-foreground"
          :disabled="!activeThreadId"
          title="Click to rename"
          @click="startEditingTitle"
        >
          {{ activeThreadId ? (activeTitle ?? 'New conversation') : 'No thread selected' }}
        </button>
      </div>
      <AppChatPanel
        class="min-h-0 flex-1"
        :messages="messages"
        :streaming-content="streamingContent"
        :is-running="isRunning"
        :error="error"
        :suggestions="['What time is it in Sydney?', 'Set Europe/Paris as my timezone']"
        empty-title="Each thread keeps its own messages and state. Reload the page — they're still here."
        @send="onSend"
        @abort="abort"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'
import type { ContentPart } from '@and-effect/ag-ui-vue'
import { AgThreadList, LocalStorageAdapter, useAgent, useThreads } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import AppChatPanel from '@/components/AppChatPanel.vue'
import { inspect } from '@/composables/useEventInspector'

// One agent; the threads layer swaps conversations on it. Tools, events and
// middleware attach to this same instance and survive thread switches.
const chat = useAgent({ url: '/api/threads' })
inspect(chat.agent)

const {
  threads,
  activeThreadId,
  messages,
  isRunning,
  error,
  streamingContent,
  send,
  abort,
  createThread,
  switchThread,
  deleteThread,
  updateTitle,
} = useThreads(chat, {
  adapter: new LocalStorageAdapter('ag-ui-vue-playground-threads'),
})

const isEditingTitle = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)
const titleDraft = ref('')

const activeTitle = computed(() => threads.value.find((t) => t.id === activeThreadId.value)?.title ?? null)

async function onSend(content: string | ContentPart[]) {
  // Start a thread on the first message rather than requiring "New" first.
  if (!activeThreadId.value) await createThread()
  await send(content)
}

async function startEditingTitle() {
  if (!activeThreadId.value) return
  titleDraft.value = activeTitle.value ?? ''
  isEditingTitle.value = true
  await nextTick()
  titleInput.value?.select()
}

function commitTitle() {
  if (!isEditingTitle.value) return
  isEditingTitle.value = false
  const title = titleDraft.value.trim()
  if (title && activeThreadId.value) updateTitle(activeThreadId.value, title)
}

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(date).toLocaleDateString()
}
</script>
