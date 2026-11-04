<template>
  <div class="prose-chat" :class="streaming && 'prose-chat--streaming'" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const { source, streaming = false } = defineProps<{
  source: string
  /** Shows a caret after the last block while tokens are still arriving. */
  streaming?: boolean
}>()

// Model output is untrusted: always sanitize before v-html.
const html = computed(() => DOMPurify.sanitize(marked.parse(source, { async: false, breaks: true })))
</script>

<style scoped>
.prose-chat--streaming :deep(> :last-child)::after {
  content: '';
  display: inline-block;
  width: 0.5ch;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  animation: caret 1s steps(2) infinite;
}

@keyframes caret {
  50% {
    opacity: 0;
  }
}
</style>
