<template>
  <div class="w-full max-w-md rounded-xl border bg-card shadow-xs">
    <div class="flex items-start gap-3 p-4">
      <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
        <ShieldQuestion class="size-4" />
      </span>
      <div class="min-w-0 flex-1 space-y-3">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium">{{ title }}</p>
          <Badge v-if="interrupt.status !== 'pending'" variant="secondary" class="ml-auto">
            {{ statusLabel }}
          </Badge>
        </div>

        <!-- Tool-bound: the proposed arguments, editable when the schema allows editedArgs. -->
        <form v-if="draft" class="space-y-2" @submit.prevent="approve">
          <label v-for="(_, key) in draft" :key="key" class="block space-y-1">
            <span class="font-mono text-xs text-muted-foreground">{{ key }}</span>
            <Input
              v-model="draft[key]"
              class="h-8"
              :disabled="!interrupt.canEditArgs || locked"
            />
          </label>
        </form>
        <p v-else-if="interrupt.message" class="text-sm text-muted-foreground">
          {{ interrupt.message }}
        </p>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t px-4 py-3">
      <template v-if="interrupt.reason === 'tool_call'">
        <Button variant="outline" size="sm" :disabled="locked" @click="deny">Deny</Button>
        <Button size="sm" :disabled="locked" @click="approve">
          {{ isEdited ? 'Approve with edits' : 'Approve' }}
        </Button>
      </template>
      <!-- Unknown reasons render generically; the only safe answer without a form is to cancel. -->
      <Button v-else variant="outline" size="sm" :disabled="locked" @click="interrupt.cancel()">
        Dismiss
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ShieldQuestion } from '@lucide/vue'
import type { AgentInterrupt } from '@and-effect/ag-ui-vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const { interrupt, toolName, args, locked = false } = defineProps<{
  interrupt: AgentInterrupt
  /** For a tool approval: the server tool awaiting it. */
  toolName?: string
  /** For a tool approval: the arguments the model proposed. */
  args?: Record<string, unknown> | null
  /** Answers can't change while the resume run is in flight. */
  locked?: boolean
}>()

// The proposal as the text inputs show it: strings as-is, anything else as JSON
// (parsed back on approve, so a number stays a number).
const proposed = args
  ? Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
    )
  : null
// A local copy the user can edit; compared against the proposal on approve.
const draft = ref<Record<string, string> | null>(proposed ? { ...proposed } : null)

const title = computed(() => (toolName ? `Run ${toolName}?` : (interrupt.message ?? interrupt.reason)))
const isEdited = computed(
  () => !!draft.value && Object.entries(draft.value).some(([key, value]) => value !== proposed?.[key]),
)
const statusLabel = computed(() => {
  if (interrupt.status === 'cancelled') return 'Cancelled'
  return (interrupt.payload as { approved?: boolean })?.approved ? 'Approved' : 'Denied'
})

function approve() {
  // PydanticAI's responseSchema: { approved, editedArgs?, reason? }.
  interrupt.resolve({ approved: true, ...(isEdited.value && { editedArgs: editedArgs() }) })
}

// Back to the proposal's types: unchanged values verbatim, edited non-strings
// parsed as JSON (kept as text if they no longer parse).
function editedArgs(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(draft.value ?? {}).map(([key, text]) => {
      const original = args?.[key]
      if (text === proposed?.[key]) return [key, original]
      if (typeof original === 'string') return [key, text]
      try {
        return [key, JSON.parse(text)]
      } catch {
        return [key, text]
      }
    }),
  )
}

function deny() {
  interrupt.resolve({ approved: false, reason: 'The user declined.' })
}
</script>
