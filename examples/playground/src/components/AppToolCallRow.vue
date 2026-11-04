<template>
  <Collapsible class="group/tool w-full max-w-md rounded-lg border bg-card text-sm">
    <CollapsibleTrigger class="flex w-full items-center gap-2 px-3 py-2 text-left">
      <Check v-if="status === 'done'" class="size-3.5 text-success" />
      <Loader2 v-else-if="status === 'running'" class="size-3.5 animate-spin text-muted-foreground" />
      <Clock v-else class="size-3.5 text-warning" />
      <span class="font-mono text-xs">{{ name }}</span>
      <span class="text-xs text-muted-foreground">
        {{ status === 'done' ? 'done' : status === 'running' ? 'running…' : 'waiting' }}
      </span>
      <ChevronRight
        class="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="space-y-2 border-t px-3 py-2.5 font-mono text-xs">
        <div>
          <p class="mb-1 font-sans text-muted-foreground">Arguments</p>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all">{{ prettyArgs }}</pre>
        </div>
        <div v-if="result !== undefined">
          <p class="mb-1 font-sans text-muted-foreground">Result</p>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all">{{ result }}</pre>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronRight, Clock, Loader2 } from '@lucide/vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const { name, args, result, running = false } = defineProps<{
  name: string
  /** Raw JSON arguments, as streamed. */
  args: string
  /** Flattened tool result text, once a tool message for this call exists. */
  result?: string
  /** Whether the run is still in progress (no result yet means "working"). */
  running?: boolean
}>()

const status = computed(() => (result !== undefined ? 'done' : running ? 'running' : 'waiting'))

const prettyArgs = computed(() => {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
})
</script>
