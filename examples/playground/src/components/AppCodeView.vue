<template>
  <div class="flex flex-col bg-background">
    <div class="flex items-center gap-1 overflow-x-auto border-b px-4">
      <button
        v-for="path in sources"
        :key="path"
        class="-mb-px shrink-0 border-b-2 px-3 py-2.5 font-mono text-xs transition-colors"
        :class="
          path === active
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="active = path"
      >
        {{ fileName(path) }}
      </button>
    </div>

    <div class="flex items-center gap-2 px-6 pt-4 pb-2 text-xs text-muted-foreground">
      <span class="font-mono">{{ active }}</span>
      <Badge v-if="isBackend" variant="outline" class="font-mono font-normal">
        POST {{ endpoint }}
      </Badge>
      <Badge v-else-if="isShared" variant="outline" class="font-normal">
        Shared playground component
      </Badge>
      <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Copy" @click="copy(code)">
        <Check v-if="copied" />
        <Copy v-else />
      </Button>
    </div>

    <!-- Shiki output is generated locally from our own source files -->
    <div
      class="min-h-0 flex-1 overflow-auto px-6 pb-6 font-mono text-[13px] leading-relaxed [&_pre]:outline-none"
      v-html="html"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useClipboard } from '@vueuse/core'
import { Check, Copy } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getHighlighter } from '@/lib/highlighter'

const { sources, endpoint } = defineProps<{
  /** Keys of `loaders` below, e.g. `views/ThreadsView.vue` or `backend/routers/hitl.py`. */
  sources: string[]
  endpoint: string
}>()

const { copy, copied } = useClipboard()

const loaders = normalize({
  ...import.meta.glob<string>('../views/*.vue', { query: '?raw', import: 'default' }),
  ...import.meta.glob<string>('./*.vue', { query: '?raw', import: 'default' }),
  ...import.meta.glob<string>('../../../backend/app/**/*.py', { query: '?raw', import: 'default' }),
})

const active = ref(sources[0])
const code = ref('')
const html = ref('')

const isBackend = computed(() => active.value.startsWith('backend/'))
const isShared = computed(() => active.value.startsWith('components/App'))

watchEffect(async () => {
  const path = active.value
  const load = loaders[path]
  if (!load) {
    code.value = html.value = ''
    return
  }
  const [source, highlighter] = await Promise.all([load(), getHighlighter()])
  if (path !== active.value) return
  code.value = source
  html.value = highlighter.codeToHtml(source, {
    lang: path.endsWith('.py') ? 'python' : path.endsWith('.ts') ? 'typescript' : 'vue',
    themes: { light: 'github-light-default', dark: 'github-dark-default' },
    defaultColor: 'light',
  })
})

function normalize(globbed: Record<string, () => Promise<string>>) {
  return Object.fromEntries(
    Object.entries(globbed).map(([key, load]) => [
      key
        .replace(/^\.\.\/views\//, 'views/')
        .replace(/^\.\//, 'components/')
        .replace(/^\.\.\/\.\.\/\.\.\/backend\/app\//, 'backend/'),
      load,
    ]),
  )
}

function fileName(path: string) {
  return path.split('/').pop()
}
</script>
