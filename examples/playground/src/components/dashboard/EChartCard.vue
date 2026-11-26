<template>
  <div class="flex min-w-0 flex-col rounded-xl border bg-card">
    <div class="space-y-1 px-4 pt-4">
      <div class="flex items-start gap-2">
        <h3 class="text-sm font-medium">{{ title }}</h3>
        <Badge
          v-if="filtersSnapshot"
          variant="outline"
          class="ml-auto shrink-0 text-[10px] font-normal"
          title="Filters when the chart was created. Generated charts don't follow later changes."
        >
          {{ filtersSnapshot }}
        </Badge>
      </div>
      <p v-if="description" class="text-xs text-muted-foreground">{{ description }}</p>
    </div>

    <div class="relative h-64 p-2">
      <div ref="chartEl" class="size-full" :class="{ invisible: error }" />
      <div
        v-if="error"
        role="alert"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm"
      >
        <CircleAlert class="size-5 text-destructive" />
        <p class="font-medium">This chart could not be drawn</p>
        <p class="line-clamp-3 max-w-sm font-mono text-xs break-words text-muted-foreground">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import * as echarts from 'echarts'
import { CircleAlert } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { toEChartsTheme, useChartTokens } from '@/lib/chartTheme'

// Renders any ECharts option: the four fixed charts pass one they computed,
// generated charts pass the agent's `render_chart` arguments unchanged. An
// option the agent got wrong shows an error in the card; it never throws.
const {
  title = 'Untitled chart',
  description,
  option,
  filtersSnapshot,
} = defineProps<{
  title?: string
  description?: string
  /** An ECharts option. Typed loosely because generated ones are whatever the agent sent. */
  option?: unknown
  /** Filters in effect when a generated chart was created, e.g. "Europe · 1990–2007". */
  filtersSnapshot?: string
}>()

const chartEl = useTemplateRef<HTMLDivElement>('chartEl')
const error = ref<string | null>(null)
const tokens = useChartTokens()
let chart: echarts.ECharts | undefined

onMounted(draw)
onBeforeUnmount(() => chart?.dispose())
watch(() => option, draw)
// The theme is set at init, so a theme switch starts a fresh instance.
watch(tokens, () => {
  dispose()
  draw()
})
useResizeObserver(chartEl, () => {
  try {
    chart?.resize()
  } catch {
    // A chart that fails on resize already showed its error when drawn.
  }
})

function draw() {
  if (!chartEl.value) return
  const problem = checkOption(option)
  if (problem) {
    error.value = problem
    dispose()
    return
  }
  try {
    chart ??= echarts.init(chartEl.value, toEChartsTheme(tokens.value))
    chart.setOption(option as echarts.EChartsOption, { notMerge: true })
    error.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    // A throw inside setOption leaves the instance mid-update, and it rejects
    // every later setOption. Start over on the next draw.
    dispose()
  }
}

function dispose() {
  chart?.dispose()
  chart = undefined
}

function checkOption(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The chart option is not an object.'
  if (!('series' in value)) return 'The chart option has no series.'
  return null
}
</script>
