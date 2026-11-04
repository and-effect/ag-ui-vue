<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl px-6 py-16">
      <h1 class="text-2xl font-semibold tracking-tight">ag-ui-vue playground</h1>
      <p class="mt-2 max-w-xl text-muted-foreground">
        Vue composables for the AG-UI protocol. Each demo is a working page against a PydanticAI
        backend — open the
        <span class="font-medium text-foreground">Code</span>
        tab to read it, and
        <span class="font-medium text-foreground">Events</span>
        to watch the raw protocol stream.
      </p>

      <div class="mt-10 grid gap-3 sm:grid-cols-2">
        <RouterLink
          v-for="demo in demoRoutes"
          :key="demo.path"
          :to="demo.path"
          class="group rounded-xl border p-4 transition-colors hover:bg-accent/50"
        >
          <div class="flex items-center gap-2">
            <component :is="demo.icon" class="size-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ demo.title }}</span>
            <ArrowRight
              class="ml-auto size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
            />
          </div>
          <p class="mt-2 text-sm text-muted-foreground">{{ demo.description }}</p>
        </RouterLink>
      </div>

      <h2 class="mt-14 text-sm font-medium">Running locally</h2>
      <ol class="mt-3 space-y-3 text-sm text-muted-foreground">
        <li>
          1. Put your
          <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">OPENAI_API_KEY</code>
          in
          <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">examples/backend/.env</code>
        </li>
        <li>
          2. Start the backend:
          <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">npm run dev:backend</code>
        </li>
        <li>
          3. Start this app:
          <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">npm run dev:playground</code>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { demoRoutes } from '@/router'
</script>
