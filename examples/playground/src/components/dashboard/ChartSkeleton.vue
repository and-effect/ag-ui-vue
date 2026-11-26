<template>
  <!-- Shown by useGenerativeUI while the render_chart arguments are still streaming -->
  <div class="flex animate-pulse flex-col gap-3 rounded-xl border bg-card p-4" aria-label="Chart loading">
    <div class="space-y-1.5">
      <div class="h-3.5 w-40 rounded bg-muted" />
      <div class="h-2.5 w-56 rounded bg-muted" />
    </div>
    <div class="flex h-56 items-end gap-3 px-2 pb-2">
      <div v-for="height in BARS" :key="height" class="flex-1 rounded-t bg-muted" :style="{ height: `${height}%` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
// The partial tool arguments are bound as props too; don't let them fall through as attributes.
defineOptions({ inheritAttrs: false })

const BARS = [45, 70, 55, 90, 65, 80]
</script>
