<template>
  <div
    class="w-56 rounded-xl border p-4"
    :class="is_night ? 'border-zinc-800 bg-zinc-950 text-zinc-50' : 'border-sky-100 bg-sky-50 text-sky-950'"
  >
    <div class="flex items-start justify-between">
      <div>
        <p class="text-sm font-medium">{{ city }}</p>
        <p class="font-mono text-[11px] opacity-60">{{ timezone }}</p>
      </div>
      <Moon v-if="is_night" class="size-4 opacity-70" />
      <Sun v-else class="size-4 opacity-70" />
    </div>
    <p class="mt-5 font-mono text-4xl font-medium tracking-tight tabular-nums">{{ time }}</p>
  </div>
</template>

<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'

// Prop names match the tool's JSON Schema — useGenerativeUI binds the parsed
// tool arguments straight onto the component.
const { city, timezone, time, is_night } = defineProps<{
  city: string
  timezone: string
  time: string
  is_night: boolean
}>()
</script>
