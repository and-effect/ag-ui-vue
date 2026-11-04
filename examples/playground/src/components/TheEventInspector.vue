<template>
  <aside class="flex w-full max-w-sm shrink-0 flex-col border-l bg-sidebar">
    <div class="flex items-center gap-2 border-b px-4 py-2.5">
      <span class="text-sm font-medium">Events</span>
      <span class="text-xs text-muted-foreground tabular-nums">{{ events.length }}</span>
      <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Clear events" @click="clear">
        <Trash2 />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')">
        <X />
      </Button>
    </div>

    <label class="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
      Show streaming chunks
      <Switch v-model="showChunks" />
    </label>

    <div ref="listEl" class="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-xs">
      <p v-if="!visible.length" class="px-4 py-8 text-center font-sans text-muted-foreground">
        Send a message to see the AG-UI event stream.
      </p>
      <div v-for="item in visible" :key="item.seq">
        <button
          class="flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors hover:bg-accent"
          @click="toggle(item.seq)"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="family(item.event.type)" />
          <span class="shrink-0">{{ item.event.type }}</span>
          <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ summary(item) }}</span>
          <span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">{{ time(item.at) }}</span>
        </button>
        <pre
          v-if="expanded.has(item.seq)"
          class="mx-4 mb-2 overflow-x-auto rounded-md bg-muted p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all"
          >{{ detail(item) }}</pre
        >
      </div>
      <p v-if="hiddenCount" class="px-4 py-2 font-sans text-muted-foreground">
        {{ hiddenCount }} streaming chunk(s) hidden
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Trash2, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { InspectedEvent } from '@/composables/useEventInspector'
import { useEventInspector } from '@/composables/useEventInspector'

const emit = defineEmits<{ close: [] }>()

const { events, clear } = useEventInspector()

const showChunks = ref(false)
const expanded = ref(new Set<number>())
const listEl = ref<HTMLElement | null>(null)

// Token-level chunks (one per streamed delta) drown out the lifecycle events.
const CHUNK_TYPES = new Set(['TEXT_MESSAGE_CONTENT', 'TOOL_CALL_ARGS', 'REASONING_MESSAGE_CONTENT'])

const visible = computed(() =>
  showChunks.value ? events.value : events.value.filter((e) => !CHUNK_TYPES.has(e.event.type)),
)
const hiddenCount = computed(() => events.value.length - visible.value.length)

watch(
  () => visible.value.length,
  () =>
    nextTick(() => {
      const el = listEl.value
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
    }),
)

function toggle(seq: number) {
  const next = new Set(expanded.value)
  if (next.has(seq)) next.delete(seq)
  else next.add(seq)
  expanded.value = next
}

function family(type: string) {
  if (type.startsWith('RUN_')) return 'bg-foreground'
  if (type.startsWith('TOOL_CALL')) return 'bg-warning'
  if (type.startsWith('STATE_')) return 'bg-success'
  if (type.startsWith('TEXT_MESSAGE')) return 'bg-muted-foreground'
  return 'bg-border'
}

function summary({ event }: InspectedEvent): string {
  const e = event as unknown as Record<string, unknown>
  if (typeof e.delta === 'string') return JSON.stringify(e.delta)
  if (typeof e.toolCallName === 'string') return e.toolCallName
  if (typeof e.message === 'string') return e.message
  if (e.type === 'STATE_DELTA' && Array.isArray(e.delta)) return `${e.delta.length} patch op(s)`
  return ''
}

function time(at: Date) {
  return at.toLocaleTimeString([], { hour12: false }) + '.' + String(at.getMilliseconds()).padStart(3, '0')
}

function detail({ event }: InspectedEvent) {
  const { type: _type, ...rest } = event as unknown as Record<string, unknown>
  return JSON.stringify(rest, null, 2)
}
</script>
