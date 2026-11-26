/**
 * The Gapminder excerpt shared with the backend (`examples/data/gapminder.json`),
 * plus the dashboard's filter model.
 */
import data from '../../../data/gapminder.json'

export interface GapminderRow {
  country: string
  continent: Continent
  year: number
  life_expectancy: number
  gdp_per_capita: number
  population: number
}

export const CONTINENTS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const
export type Continent = (typeof CONTINENTS)[number]

export const ROWS = data as GapminderRow[]

/** Data exists every five years, 1952–2007. */
export const YEARS = [...new Set(ROWS.map((row) => row.year))].sort((a, b) => a - b)
export const FIRST_YEAR = YEARS[0]
export const LAST_YEAR = YEARS[YEARS.length - 1]

export interface DashboardFilters {
  /** Continents shown; all five means no continent filter. */
  continents: Continent[]
  yearFrom: number
  yearTo: number
}

export const DEFAULT_FILTERS: DashboardFilters = {
  continents: [...CONTINENTS],
  yearFrom: FIRST_YEAR,
  yearTo: LAST_YEAR,
}

export function filterRows(filters: DashboardFilters): GapminderRow[] {
  return ROWS.filter(
    (row) =>
      filters.continents.includes(row.continent) && row.year >= filters.yearFrom && row.year <= filters.yearTo,
  )
}

/**
 * Applies a partial change (from the filter bar or the `set_filters` tool).
 * Years snap to the nearest year with data, and a reversed range is swapped.
 */
export function changeFilters(current: DashboardFilters, change: Partial<DashboardFilters>): DashboardFilters {
  const yearFrom = nearestYear(change.yearFrom ?? current.yearFrom)
  const yearTo = nearestYear(change.yearTo ?? current.yearTo)
  return {
    continents: change.continents
      ? CONTINENTS.filter((continent) => change.continents!.includes(continent))
      : current.continents,
    yearFrom: Math.min(yearFrom, yearTo),
    yearTo: Math.max(yearFrom, yearTo),
  }
}

/** Short label, e.g. "Asia, Europe · 1980–2007". */
export function describeFilters(filters: DashboardFilters): string {
  return `${describeContinents(filters.continents)} · ${filters.yearFrom}–${filters.yearTo}`
}

export function describeContinents(continents: readonly Continent[]): string {
  if (continents.length === CONTINENTS.length) return 'All continents'
  return continents.length ? continents.join(', ') : 'No continents'
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function nearestYear(year: number): number {
  return YEARS.reduce((best, candidate) => (Math.abs(candidate - year) < Math.abs(best - year) ? candidate : best))
}
