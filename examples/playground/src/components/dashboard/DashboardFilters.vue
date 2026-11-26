<template>
  <div class="flex flex-wrap items-end gap-3">
    <div class="space-y-1.5">
      <span id="filter-continents" class="text-xs text-muted-foreground">Continents</span>
      <Select
        :model-value="filters.continents"
        multiple
        @update:model-value="update({ continents: $event as Continent[] })"
      >
        <SelectTrigger class="w-60" aria-labelledby="filter-continents">
          <span class="truncate">{{ continentLabel }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="continent in CONTINENTS" :key="continent" :value="continent">
            {{ continent }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="space-y-1.5">
      <span id="filter-years" class="text-xs text-muted-foreground">Years</span>
      <div class="flex items-center gap-2" aria-labelledby="filter-years" role="group">
        <Select :model-value="filters.yearFrom" @update:model-value="update({ yearFrom: Number($event) })">
          <SelectTrigger class="w-24" aria-label="From">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="year in YEARS" :key="year" :value="year" :disabled="year > filters.yearTo">
              {{ year }}
            </SelectItem>
          </SelectContent>
        </Select>
        <span class="text-muted-foreground">–</span>
        <Select :model-value="filters.yearTo" @update:model-value="update({ yearTo: Number($event) })">
          <SelectTrigger class="w-24" aria-label="To">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="year in YEARS" :key="year" :value="year" :disabled="year < filters.yearFrom">
              {{ year }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <Button variant="ghost" size="sm" :disabled="isDefault" @click="filters = { ...DEFAULT_FILTERS }">
      Reset
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  changeFilters,
  CONTINENTS,
  DEFAULT_FILTERS,
  describeContinents,
  describeFilters,
  YEARS,
  type Continent,
  type DashboardFilters,
} from '@/lib/gapminder'

const filters = defineModel<DashboardFilters>({ required: true })

const continentLabel = computed(() => describeContinents(filters.value.continents))
const isDefault = computed(() => describeFilters(filters.value) === describeFilters(DEFAULT_FILTERS))

function update(change: Partial<DashboardFilters>) {
  filters.value = changeFilters(filters.value, change)
}
</script>
