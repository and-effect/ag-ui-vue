<template>
  <div class="w-72 rounded-xl border bg-card p-4">
    <div class="flex items-baseline justify-between">
      <p class="text-sm font-medium">{{ city }}</p>
      <p class="text-xs text-muted-foreground">{{ is_night ? 'Night' : 'Day' }} · {{ hour }}:00</p>
    </div>
    <p class="font-mono text-[11px] text-muted-foreground">{{ timezone }}</p>

    <div class="mt-4 flex h-8 items-end gap-0.5" role="img" :aria-label="`Hour ${hour} of 24`">
      <div
        v-for="h in HOURS"
        :key="h"
        class="flex-1 rounded-sm transition-colors"
        :class="[
          h === hour ? 'h-full bg-warning' : 'h-1/2',
          h !== hour && (isNightHour(h) ? 'bg-zinc-800 dark:bg-zinc-600' : 'bg-sky-200 dark:bg-sky-900'),
        ]"
      />
    </div>
    <div class="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
      <span>0</span>
      <span>6</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const { city, timezone, hour, is_night } = defineProps<{
  city: string
  timezone: string
  hour: number
  is_night: boolean
}>()

const HOURS = Array.from({ length: 24 }, (_, h) => h)

function isNightHour(h: number) {
  return h >= 18 || h < 6
}
</script>
