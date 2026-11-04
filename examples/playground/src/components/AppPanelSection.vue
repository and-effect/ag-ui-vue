<template>
  <section class="border-b px-5 py-5 last:border-b-0">
    <div class="mb-3 flex items-baseline justify-between gap-2">
      <h2 class="text-sm font-medium">{{ title }}</h2>
      <slot name="action" />
    </div>
    <p v-if="description" class="-mt-2 mb-3 text-xs text-muted-foreground">{{ description }}</p>
    <slot />
  </section>
</template>

<script setup lang="ts">
const { title, description } = defineProps<{
  title: string
  description?: string
}>()
</script>
