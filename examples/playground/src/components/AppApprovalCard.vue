<template>
  <div class="w-full max-w-md rounded-xl border bg-card shadow-xs">
    <div class="flex items-start gap-3 p-4">
      <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
        <component :is="icon" class="size-4" />
      </span>
      <div class="min-w-0 flex-1 space-y-1">
        <p class="text-sm font-medium">{{ title }}</p>
        <div class="text-sm text-muted-foreground">
          <slot />
        </div>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" size="sm" :disabled="settled" @click="settle('reject')">
        {{ rejectLabel }}
      </Button>
      <Button size="sm" :disabled="settled" @click="settle('approve')">
        {{ approveLabel }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { ref } from 'vue'
import { Hand } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const {
  title,
  icon = Hand,
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
} = defineProps<{
  title: string
  icon?: Component
  approveLabel?: string
  rejectLabel?: string
}>()

const emit = defineEmits<{ approve: []; reject: [] }>()

// Guards against a double click submitting the same tool result twice.
const settled = ref(false)

function settle(action: 'approve' | 'reject') {
  if (settled.value) return
  settled.value = true
  if (action === 'approve') emit('approve')
  else emit('reject')
}
</script>
