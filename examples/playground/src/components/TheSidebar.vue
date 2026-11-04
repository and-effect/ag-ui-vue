<template>
  <aside
    class="flex shrink-0 flex-col border-b bg-sidebar md:h-full md:w-60 md:border-r md:border-b-0"
  >
    <div class="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
      <RouterLink to="/" class="flex items-center gap-2">
        <span
          class="grid size-6 place-items-center rounded-md bg-primary font-mono text-[11px] font-semibold text-primary-foreground"
        >
          ag
        </span>
        <span class="text-sm font-semibold tracking-tight">ag-ui-vue</span>
        <span class="text-xs text-muted-foreground">playground</span>
      </RouterLink>
      <Button
        variant="ghost"
        size="icon-sm"
        class="md:hidden"
        aria-label="Toggle theme"
        @click="toggle()"
      >
        <Moon v-if="isDark" />
        <Sun v-else />
      </Button>
    </div>

    <nav class="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-5 md:pb-0">
      <div v-for="group in groups" :key="group.name" class="contents md:block">
        <p class="hidden px-2 pb-1.5 text-xs font-medium text-muted-foreground md:block">
          {{ group.name }}
        </p>
        <ul class="contents md:flex md:flex-col md:gap-0.5">
          <li v-for="item in group.items" :key="item.path" class="shrink-0">
            <RouterLink
              :to="item.path"
              class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              active-class="bg-accent !text-foreground font-medium"
            >
              <component :is="item.icon" class="size-4" />
              {{ item.title }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <div class="hidden items-center justify-end border-t px-3 py-3 md:flex">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" @click="toggle()">
            <Moon v-if="isDark" />
            <Sun v-else />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Moon, Sun } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/composables/useTheme'
import { demoRoutes } from '@/router'

const { isDark, toggle } = useTheme()

const groups = computed(() =>
  (['Composables', 'Showcase'] as const).map((name) => ({
    name,
    items: demoRoutes.filter((route) => route.group === name),
  })),
)
</script>
