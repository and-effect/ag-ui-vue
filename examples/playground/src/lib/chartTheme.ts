import { shallowRef } from 'vue'
import { createGlobalState, useMutationObserver } from '@vueuse/core'

/** Chart colours, read from the `--chart-*` tokens in `styles/main.css`. */
export interface ChartTokens {
  /** Categorical slots, in fixed order. */
  series: string[]
  text: string
  grid: string
  axis: string
  tooltip: string
  tooltipText: string
}

/**
 * The current chart tokens. Re-read when the `dark` class on `<html>` toggles,
 * so every chart follows the playground's theme switch.
 */
export const useChartTokens = createGlobalState(() => {
  const tokens = shallowRef(readTokens())
  useMutationObserver(document.documentElement, () => (tokens.value = readTokens()), {
    attributes: true,
    attributeFilter: ['class'],
  })
  return tokens
})

/** An ECharts theme object: chrome in the playground's inks, series in the categorical slots. */
export function toEChartsTheme(tokens: ChartTokens): Record<string, unknown> {
  const axis = {
    axisLine: { lineStyle: { color: tokens.axis } },
    axisTick: { lineStyle: { color: tokens.axis } },
    axisLabel: { color: tokens.text },
    nameTextStyle: { color: tokens.text },
    splitLine: { lineStyle: { color: tokens.grid } },
  }
  return {
    color: tokens.series,
    backgroundColor: 'transparent',
    textStyle: { color: tokens.text, fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif' },
    title: { textStyle: { color: tokens.tooltipText }, subtextStyle: { color: tokens.text } },
    legend: { textStyle: { color: tokens.text }, pageTextStyle: { color: tokens.text } },
    tooltip: {
      backgroundColor: tokens.tooltip,
      borderColor: tokens.axis,
      textStyle: { color: tokens.tooltipText },
    },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    line: { symbolSize: 6, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: 4 } },
  }
}

function readTokens(): ChartTokens {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(`--chart-${name}`).trim()
  return {
    series: [1, 2, 3, 4, 5].map((slot) => token(String(slot))),
    text: token('text'),
    grid: token('grid'),
    axis: token('axis'),
    tooltip: token('tooltip'),
    tooltipText: token('tooltip-text'),
  }
}
