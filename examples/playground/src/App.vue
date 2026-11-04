<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex h-dvh flex-col overflow-hidden md:flex-row">
      <TheSidebar />

      <main class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          v-if="demo"
          class="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b px-4 py-4 md:px-6"
        >
          <div class="min-w-0 flex-1 basis-80">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-base font-semibold tracking-tight">{{ demo.title }}</h1>
              <Badge
                v-for="api in demo.apis"
                :key="api"
                variant="secondary"
                class="font-mono text-[11px] font-normal"
              >
                {{ api }}
              </Badge>
            </div>
            <p class="mt-1 hidden text-sm text-muted-foreground sm:block">{{ demo.description }}</p>
          </div>

          <div class="flex items-center gap-2">
            <Tabs v-model="view">
              <TabsList>
                <TabsTrigger value="preview" class="gap-1.5 px-3">
                  <Eye />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" class="gap-1.5 px-3">
                  <Code2 />
                  Code
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="sm"
              :class="showInspector && 'bg-accent'"
              :aria-pressed="showInspector"
              @click="showInspector = !showInspector"
            >
              <Activity />
              Events
            </Button>
          </div>
        </header>

        <div class="flex min-h-0 flex-1">
          <div class="relative min-w-0 flex-1">
            <!-- v-show, not v-if: switching to Code must not unmount the demo and lose the conversation -->
            <RouterView v-slot="{ Component }">
              <div v-show="!demo || view === 'preview'" class="h-full">
                <component :is="Component" />
              </div>
            </RouterView>
            <AppCodeView
              v-if="demo && view === 'code'"
              :key="route.path"
              :sources="demo.sources"
              :endpoint="demo.endpoint"
              class="absolute inset-0"
            />
          </div>
          <TheEventInspector v-if="demo && showInspector" @close="showInspector = false" />
        </div>
      </main>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Activity, Code2, Eye } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import AppCodeView from '@/components/AppCodeView.vue'
import TheEventInspector from '@/components/TheEventInspector.vue'
import TheSidebar from '@/components/TheSidebar.vue'

const route = useRoute()

const view = ref<'preview' | 'code'>('preview')
const showInspector = ref(false)

const demo = computed(() => route.meta.demo)

watch(
  () => route.path,
  () => (view.value = 'preview'),
)
</script>
