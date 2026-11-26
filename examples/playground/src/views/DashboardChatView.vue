<template>
  <div class="flex h-full flex-col lg:flex-row">
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <DashboardFilters v-model="filters" />

        <div class="grid gap-4 xl:grid-cols-2">
          <EChartCard
            v-for="chart in charts"
            :key="chart.id"
            :title="chart.title"
            :description="chart.description"
            :option="chart.option"
          />
        </div>

        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-medium">Generated charts</h2>
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto"
              :disabled="!allComponents.length"
              @click="clearGenerated"
            >
              Clear
            </Button>
          </div>
          <!-- Generative UI outside the chat: render_chart calls render here, keyed by tool call id. -->
          <div v-if="allComponents.length" class="grid gap-4 xl:grid-cols-2">
            <component
              :is="item.component"
              v-for="item in allComponents"
              :key="item.id"
              v-bind="item.props"
              :filters-snapshot="snapshots.get(item.id)"
            />
          </div>
          <p v-else class="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Ask the assistant for a chart. It appears here, with the filters it was made under.
          </p>
        </section>

        <p class="text-xs text-muted-foreground">
          Data: Gapminder excerpt via the
          <a class="underline underline-offset-4" href="https://github.com/jennybc/gapminder">gapminder</a>
          R package. Based on free material from
          <a class="underline underline-offset-4" href="https://www.gapminder.org/data/">www.gapminder.org</a>,
          CC-BY licence.
        </p>
      </div>
    </div>

    <div class="flex h-[55dvh] shrink-0 flex-col border-t bg-sidebar lg:h-auto lg:w-[420px] lg:border-t-0 lg:border-l">
      <!-- The default tool-call rows stay: query_data, set_filters and render_chart each show as a row. -->
      <AppChatPanel
        :messages="chat.messages.value"
        :streaming-content="chat.streamingContent.value"
        :is-running="chat.isRunning.value"
        :error="chat.error.value"
        :suggestions="[
          'Which continent had the highest life expectancy in 2007?',
          'Only show Asia and Europe from 1980',
          'Show me GDP per capita over time for Germany, France and Sweden',
        ]"
        empty-title="Ask about the charts, change the filters, or ask for a new chart."
        @send="chat.send"
        @abort="chat.abort"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { z } from 'zod'
import { useAgent, useAgentEvent, useFrontendTool, useGenerativeUI, type ContextEntry } from '@and-effect/ag-ui-vue'
import { Button } from '@/components/ui/button'
import AppChatPanel from '@/components/AppChatPanel.vue'
import ChartSkeleton from '@/components/dashboard/ChartSkeleton.vue'
import DashboardFilters from '@/components/dashboard/DashboardFilters.vue'
import EChartCard from '@/components/dashboard/EChartCard.vue'
import { inspect } from '@/composables/useEventInspector'
import { useChartTokens } from '@/lib/chartTheme'
import { fixedCharts } from '@/lib/dashboardCharts'
import {
  changeFilters,
  CONTINENTS,
  DEFAULT_FILTERS,
  describeFilters,
  FIRST_YEAR,
  LAST_YEAR,
  type DashboardFilters as Filters,
} from '@/lib/gapminder'

// The app's own state. The chat reads it as context and changes it only via set_filters.
const filters = ref<Filters>({ ...DEFAULT_FILTERS })
const tokens = useChartTokens()
const charts = computed(() => fixedCharts(filters.value, tokens.value))

// What the agent sees: the filters and what each chart shows, never the rows.
// For numbers it calls the backend's query_data tool. Re-read before every
// request, so the follow-up run after set_filters already has the new filters.
const context = computed<ContextEntry[]>(() => [
  {
    description: 'Dashboard filters currently set by the user',
    value: { continents: filters.value.continents, yearFrom: filters.value.yearFrom, yearTo: filters.value.yearTo },
  },
  {
    description: 'Fixed charts on the dashboard, all drawn from the filtered data',
    value: charts.value.map((chart) => ({ title: chart.title, ...chart.summary })),
  },
])

const chat = useAgent({ url: '/api/dashboard-chat', context })
inspect(chat.agent)

// A frontend tool rather than shared state: the change is an explicit tool
// call you can see in the chat and the Events tab.
useFrontendTool(chat, {
  name: 'set_filters',
  description:
    'Change the dashboard filters. Omitted fields stay as they are. The four fixed charts re-render; generated charts keep the filters they were made with.',
  parameters: z.object({
    continents: z
      .array(z.enum(CONTINENTS))
      .optional()
      .describe('Continents to show. Pass all five to remove the continent filter.'),
    yearFrom: z
      .number()
      .int()
      .optional()
      .describe(`First year shown, ${FIRST_YEAR}–${LAST_YEAR}. Data exists every 5 years; other years snap to the nearest.`),
    yearTo: z.number().int().optional().describe(`Last year shown, ${FIRST_YEAR}–${LAST_YEAR}.`),
  }),
  handler: async (change) => {
    filters.value = changeFilters(filters.value, change)
    return { filters: filters.value }
  },
})

// Generated charts: each render_chart call renders an EChartCard in the
// dashboard (not in the chat). The skeleton shows while the arguments stream.
const { allComponents, clear } = useGenerativeUI(chat, {
  render_chart: {
    component: EChartCard,
    loading: ChartSkeleton,
    description:
      'Add a chart to the dashboard. Call query_data first and use only the numbers it returned.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short chart title' },
        description: { type: 'string', description: 'One line on what the chart shows, incl. unit and years' },
        option: {
          // Deliberately loose: the full ECharts schema is far too large to send.
          type: 'object',
          description:
            'An Apache ECharts option object, as plain JSON. No functions (formatters, callbacks), no colours or ' +
            'backgroundColor: the dashboard themes the chart. Put the rows from query_data into ' +
            'dataset.source unchanged and map columns with series[].encode (e.g. {"x": "year", "y": "Germany"}). ' +
            'Must have a series array; set xAxis/yAxis for cartesian charts, and a legend for more than one series.',
        },
      },
      required: ['title', 'option'],
    },
  },
})

// A generated chart is a snapshot. Its props come only from the tool
// arguments, so the filters it was made under are kept in a side map,
// captured when the render_chart call starts.
const snapshots = reactive(new Map<string, string>())
useAgentEvent(chat.agent, {
  onToolCallStartEvent({ event }) {
    if (event.toolCallName === 'render_chart') snapshots.set(event.toolCallId, describeFilters(filters.value))
  },
})

function clearGenerated() {
  clear()
  snapshots.clear()
}
</script>
