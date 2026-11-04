<template>
  <div class="flex h-full">
    <AppChatPanel
      class="flex-1"
      :messages="chat.messages.value"
      :streaming-content="chat.streamingContent.value"
      :is-running="chat.isRunning.value"
      :error="chat.error.value"
      :suggestions="['What is still missing here?', 'Show me the application that was rejected', 'Summarise this case']"
      empty-title="Pick an application on the right, then ask about “this one”. The agent sees what you have open."
      @send="chat.send"
      @abort="chat.abort"
    />

    <aside class="hidden w-80 shrink-0 overflow-y-auto border-l lg:block">
      <AppPanelSection
        title="Building permit applications"
        description="The open application is sent as context on every request."
      >
        <div class="space-y-2">
          <button
            v-for="application in APPLICATIONS"
            :key="application.id"
            type="button"
            class="flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted"
            :class="{ 'border-primary bg-muted': application.id === openApplicationId }"
            @click="openApplicationId = application.id"
          >
            <div class="min-w-0 flex-1 space-y-1">
              <span class="font-mono text-xs text-muted-foreground">{{ application.id }}</span>
              <p class="truncate">{{ application.project }}</p>
            </div>
            <Badge variant="outline" class="shrink-0 text-[10px]">{{ application.status }}</Badge>
          </button>
        </div>
      </AppPanelSection>

      <AppPanelSection
        title="Context sent"
        description="Re-read before each request, including the follow-up after openApplication."
      >
        <pre class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">{{
          JSON.stringify(pageContext, null, 2)
        }}</pre>
      </AppPanelSection>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { z } from 'zod'
import { useAgent, useFrontendTool, type ContextEntry } from '@and-effect/ag-ui-vue'
import { Badge } from '@/components/ui/badge'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppPanelSection from '@/components/AppPanelSection.vue'
import { inspect } from '@/composables/useEventInspector'

const APPLICATIONS = [
  {
    id: 'BA-2026-0142',
    project: 'Extension of a single-family house',
    status: 'incomplete',
    received: '2026-09-02',
    history: [
      'Sep 2: application received',
      'Sep 9: completeness check — structural calculations and site plan missing',
      'Sep 10: applicant asked to submit missing documents within 4 weeks',
    ],
  },
  {
    id: 'BA-2026-0157',
    project: 'Change of use: retail unit to café',
    status: 'in review',
    received: '2026-09-15',
    history: [
      'Sep 15: application received',
      'Sep 22: documents complete',
      'Sep 25: sent to fire safety and environmental health for comment',
    ],
  },
  {
    id: 'BA-2026-0163',
    project: 'Rooftop solar panels on a listed building',
    status: 'rejected',
    received: '2026-08-20',
    history: [
      'Aug 20: application received',
      'Sep 4: heritage office objects: panels visible from the street',
      'Oct 1: rejected; applicant may resubmit with an in-roof design',
    ],
  },
]

// In an app this would live in a store the page writes to. The chat only reads it.
const openApplicationId = ref('BA-2026-0142')

// Plain objects as `value` are JSON-serialised for you.
const pageContext = computed<ContextEntry[]>(() => [
  {
    description: 'Applications on the list',
    value: APPLICATIONS.map(({ id, project, status }) => ({ id, project, status })),
  },
  {
    description: 'Application the caseworker has open',
    value: APPLICATIONS.find((application) => application.id === openApplicationId.value),
  },
])

// The getter is resolved before every request, so the run that follows an
// openApplication call already carries the newly opened application.
const chat = useAgent({ url: '/api/page-context', context: pageContext })
inspect(chat.agent)

useFrontendTool(chat, {
  name: 'openApplication',
  // Kept strict on purpose: with a loose "open an application" description, a
  // bare "and this one" got read as a request to open something.
  description:
    "Switch the caseworker's screen to a different application. Only for explicit requests to see another application than the one currently open; never for the open one.",
  parameters: z.object({ applicationId: z.string().describe('Application id, e.g. "BA-2026-0142"') }),
  handler: async ({ applicationId }) => {
    if (!APPLICATIONS.some((application) => application.id === applicationId)) {
      return { error: `No application ${applicationId}` }
    }
    openApplicationId.value = applicationId
    return { opened: applicationId }
  },
})
</script>
