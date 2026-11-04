<template>
  <Collapsible v-model:open="open" class="group/reasoning w-full text-sm">
    <CollapsibleTrigger class="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
      <Loader2 v-if="streaming" class="size-3.5 animate-spin" />
      <Brain v-else class="size-3.5" />
      <span>{{ label }}</span>
      <ChevronRight class="size-3.5 transition-transform group-data-[state=open]/reasoning:rotate-90" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <p class="mt-2 border-l-2 pl-3 whitespace-pre-wrap text-muted-foreground">{{ content }}</p>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Brain, ChevronRight, Loader2 } from '@lucide/vue'
import type { ReasoningMessageEntry } from '@and-effect/ag-ui-vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const { content, live } = defineProps<{
  /** The reasoning text, from the message in the list (it streams in place). */
  content: string
  /** The live entry from `useReasoning`, absent for reasoning from an earlier run. */
  live?: ReasoningMessageEntry
}>()

const streaming = computed(() => live?.status === 'streaming')

const label = computed(() => {
  if (streaming.value) return 'Thinking…'
  if (live?.duration != null) return `Thought for ${Math.max(1, Math.round(live.duration / 1000))}s`
  return 'Reasoning'
})

// Open while the agent is thinking, then fold away once the answer is coming.
const open = ref(streaming.value)
watch(streaming, (now) => (open.value = now))
</script>
