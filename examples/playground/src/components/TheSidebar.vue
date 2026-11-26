<template>
  <aside
    class="flex shrink-0 flex-col border-b bg-sidebar transition-[width] duration-200 md:h-full md:border-r md:border-b-0"
    :class="rail ? 'md:w-14' : 'md:w-60'"
  >
    <div
      class="flex items-center justify-between px-4 py-3 md:py-5"
      :class="rail ? 'md:justify-center md:px-0' : 'md:px-5'"
    >
      <RouterLink to="/" class="flex items-center gap-2" aria-label="ag-ui-vue playground">
        <span
          class="grid size-6 shrink-0 place-items-center rounded-md bg-primary font-mono text-[11px] font-semibold text-primary-foreground"
        >
          ag
        </span>
        <template v-if="!rail">
          <span class="text-sm font-semibold tracking-tight">ag-ui-vue</span>
          <span class="text-xs text-muted-foreground">playground</span>
        </template>
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

    <nav
      class="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-5 md:overflow-x-hidden md:overflow-y-auto md:pb-0"
      :class="rail && 'md:px-2'"
    >
      <div v-for="group in groups" :key="group.name" class="contents md:block">
        <!-- In the rail, a hairline separates the groups instead of their names. -->
        <p v-if="!rail" class="hidden px-2 pb-1.5 text-xs font-medium text-muted-foreground md:block">
          {{ group.name }}
        </p>
        <Separator v-else class="mb-2 hidden md:block" />
        <ul class="contents md:flex md:flex-col md:gap-0.5">
          <li v-for="item in group.items" :key="item.path" class="shrink-0">
            <Tooltip :disabled="!rail">
              <TooltipTrigger as-child>
                <RouterLink
                  :to="item.path"
                  class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  :class="rail && 'md:justify-center'"
                  active-class="bg-accent !text-foreground font-medium"
                  :aria-label="rail ? item.title : undefined"
                >
                  <component :is="item.icon" class="size-4 shrink-0" />
                  <span v-if="!rail" class="truncate">{{ item.title }}</span>
                </RouterLink>
              </TooltipTrigger>
              <TooltipContent side="right">{{ item.title }}</TooltipContent>
            </Tooltip>
          </li>
        </ul>
      </div>
    </nav>

    <div
      class="hidden items-center gap-1 border-t px-3 py-3 md:flex"
      :class="rail ? 'md:flex-col md:px-2' : 'justify-between'"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :aria-expanded="!collapsed"
            @click="collapsed = !collapsed"
          >
            <PanelLeftOpen v-if="collapsed" />
            <PanelLeftClose v-else />
          </Button>
        </TooltipTrigger>
        <TooltipContent :side="rail ? 'right' : 'top'">
          {{ collapsed ? 'Expand sidebar' : 'Collapse sidebar' }}
          <kbd class="ml-1.5 font-mono opacity-70">{{ shortcutLabel }}</kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" @click="toggle()">
            <Moon v-if="isDark" />
            <Sun v-else />
          </Button>
        </TooltipTrigger>
        <TooltipContent :side="rail ? 'right' : 'top'">Toggle theme</TooltipContent>
      </Tooltip>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEventListener, useLocalStorage, useMediaQuery } from '@vueuse/core'
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/composables/useTheme'
import { demoRoutes } from '@/router'

const { isDark, toggle } = useTheme()

// Collapsing only applies from `md` up, where the sidebar is a column. Below
// that it is a horizontal strip, which stays as it is.
const collapsed = useLocalStorage('playground-sidebar-collapsed', false)
const isDesktop = useMediaQuery('(min-width: 768px)')
const rail = computed(() => collapsed.value && isDesktop.value)

const isMac = navigator.platform.toUpperCase().includes('MAC')
const shortcutLabel = isMac ? '⌘B' : 'Ctrl+B'

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key.toLowerCase() !== 'b' || !(isMac ? event.metaKey : event.ctrlKey)) return
  if (!isDesktop.value) return
  event.preventDefault()
  collapsed.value = !collapsed.value
})

const groups = computed(() =>
  (['Composables', 'Showcase'] as const).map((name) => ({
    name,
    items: demoRoutes.filter((route) => route.group === name),
  })),
)
</script>
