<template>
  <div class="flex flex-col gap-2">
    <template v-for="(part, i) in parts" :key="i">
      <p v-if="part.type === 'text'" class="text-sm leading-relaxed whitespace-pre-wrap">
        {{ part.text }}
      </p>
      <img
        v-else-if="part.type === 'image' && previewSrc(part.source)"
        :src="previewSrc(part.source)!"
        :alt="partLabel(part)"
        class="max-h-56 w-auto rounded-lg border object-contain"
      />
      <span
        v-else
        class="inline-flex w-fit items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
      >
        <FileText class="size-3.5" />
        {{ partLabel(part) }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FileText } from '@lucide/vue'
import type { AnyContentPart } from '@/lib/content'
import { partLabel, previewSrc } from '@/lib/content'

const { content } = defineProps<{
  /** A user message's content: plain text, or multimodal content parts. */
  content: string | readonly AnyContentPart[] | undefined
}>()

const parts = computed<readonly AnyContentPart[]>(() =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []),
)
</script>
