/**
 * The dashboard's four fixed charts, computed from the filtered rows.
 *
 * Each spec carries the ECharts option for the card and a plain-language
 * summary (metric, encoding) that goes to the agent as page context, so it can
 * talk about the charts without receiving their data.
 */
import type { ChartTokens } from '@/lib/chartTheme'
import {
  CONTINENTS,
  filterRows,
  mean,
  YEARS,
  type Continent,
  type DashboardFilters,
  type GapminderRow,
} from '@/lib/gapminder'

export interface FixedChart {
  id: string
  title: string
  description: string
  /** Sent as context: what the chart measures and how it is drawn. */
  summary: { chart: string; metric: string; encoding: string }
  option: Record<string, unknown>
}

const TOP_COUNTRIES = 10

export function fixedCharts(filters: DashboardFilters, tokens: ChartTokens): FixedChart[] {
  const rows = filterRows(filters)
  // A continent keeps its colour when others are filtered out.
  const color = (continent: Continent) => tokens.series[CONTINENTS.indexOf(continent)]
  const latest = rows.filter((row) => row.year === filters.yearTo)
  const continents = CONTINENTS.filter((continent) => filters.continents.includes(continent))
  const years = YEARS.filter((year) => year >= filters.yearFrom && year <= filters.yearTo)

  return [
    {
      id: 'life-expectancy-trend',
      title: 'Life expectancy over time',
      description: `Average across countries, ${filters.yearFrom}–${filters.yearTo}`,
      summary: {
        chart: 'line',
        metric: 'life_expectancy, mean across the countries of each continent',
        encoding: 'x: year; y: years of life expectancy; one line per continent',
      },
      option: {
        tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(1)} years` },
        legend: { bottom: 0 },
        grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
        xAxis: { type: 'category', data: years, boundaryGap: false },
        yAxis: { type: 'value', name: 'years', min: 'dataMin' },
        series: continents.map((continent) => ({
          name: continent,
          type: 'line',
          color: color(continent),
          data: years.map((year) =>
            round(mean(rows.filter((row) => row.continent === continent && row.year === year).map(lifeExpectancy)), 1),
          ),
        })),
      },
    },
    {
      id: 'top-gdp',
      title: `Top ${TOP_COUNTRIES} countries by GDP per capita`,
      description: `In ${filters.yearTo}, coloured by continent`,
      summary: {
        chart: 'horizontal bar',
        metric: `gdp_per_capita in ${filters.yearTo} (the last year of the range), inflation-adjusted US$`,
        encoding: `y: the ${TOP_COUNTRIES} countries with the highest value; x: US$; bar colour: continent`,
      },
      option: {
        tooltip: {
          trigger: 'item',
          formatter: ({ name, value, data }: { name: string; value: number; data: { continent: string } }) =>
            `${name} (${data.continent})<br/>US$ ${Math.round(value).toLocaleString()}`,
        },
        grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', inverse: true, axisTick: { show: false } },
        series: [
          {
            type: 'bar',
            barMaxWidth: 16,
            data: [...latest]
              .sort((a, b) => b.gdp_per_capita - a.gdp_per_capita)
              .slice(0, TOP_COUNTRIES)
              .map((row) => ({
                name: row.country,
                value: round(row.gdp_per_capita, 0),
                continent: row.continent,
                itemStyle: { color: color(row.continent) },
              })),
          },
        ],
      },
    },
    {
      id: 'wealth-vs-health',
      title: 'GDP per capita vs. life expectancy',
      description: `One dot per country in ${filters.yearTo}, sized by population`,
      summary: {
        chart: 'scatter',
        metric: `gdp_per_capita and life_expectancy per country in ${filters.yearTo}`,
        encoding: 'x: GDP per capita (log scale); y: life expectancy; dot size: population; colour: continent',
      },
      option: {
        tooltip: {
          trigger: 'item',
          formatter: ({ data }: { data: [number, number, number, string] }) =>
            `${data[3]}<br/>US$ ${Math.round(data[0]).toLocaleString()} · ${data[1].toFixed(1)} years`,
        },
        legend: { bottom: 0 },
        grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
        xAxis: { type: 'log', name: 'US$', splitLine: { show: false } },
        yAxis: { type: 'value', name: 'years', min: 'dataMin' },
        series: continents.map((continent) => ({
          name: continent,
          type: 'scatter',
          color: color(continent),
          itemStyle: { opacity: 0.8 },
          symbolSize: (point: [number, number, number]) => Math.max(8, Math.sqrt(point[2]) / 800),
          data: latest
            .filter((row) => row.continent === continent)
            .map((row) => [row.gdp_per_capita, row.life_expectancy, row.population, row.country]),
        })),
      },
    },
    {
      id: 'population',
      title: 'Population by continent',
      description: `Total in ${filters.yearTo}`,
      summary: {
        chart: 'bar',
        metric: `population in ${filters.yearTo}, summed per continent`,
        encoding: 'x: continent; y: people',
      },
      option: {
        tooltip: {
          trigger: 'item',
          formatter: ({ name, value }: { name: string; value: number }) => `${name}<br/>${formatPeople(value)}`,
        },
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        xAxis: { type: 'category', axisTick: { show: false } },
        yAxis: { type: 'value', axisLabel: { formatter: formatPeople } },
        series: [
          {
            type: 'bar',
            barMaxWidth: 40,
            data: continents.map((continent) => ({
              name: continent,
              value: sum(latest.filter((row) => row.continent === continent).map((row) => row.population)),
              itemStyle: { color: color(continent) },
            })),
          },
        ],
      },
    },
  ]
}

function lifeExpectancy(row: GapminderRow) {
  return row.life_expectancy
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits))
}

function formatPeople(value: number) {
  return value >= 1e9 ? `${(value / 1e9).toFixed(1)} bn` : `${Math.round(value / 1e6)} m`
}
