<template>
  <div class="flex h-full">
    <!-- Registered tools are advertised automatically: a bare send() is enough. -->
    <AppChatPanel
      class="flex-1"
      :messages="chat.messages.value"
      :streaming-content="chat.streamingContent.value"
      :is-running="chat.isRunning.value"
      :error="chat.error.value"
      :suggestions="['What time is it in Tokyo?', 'Switch to dark mode']"
      empty-title="Ask for the time somewhere it's night — the agent will offer to change the theme."
      @send="chat.send"
      @abort="chat.abort"
    >
      <AppApprovalCard
        v-for="call in pendingConfirmations"
        :key="call.id"
        :title="call.args.action ?? 'Confirm action'"
        @approve="call.respond?.({ approved: true })"
        @reject="call.reject?.('User declined')"
      >
        {{ call.args.description }}
        <Badge v-if="call.args.severity" variant="outline" class="mt-2 block w-fit">
          {{ call.args.severity }} impact
        </Badge>
      </AppApprovalCard>
    </AppChatPanel>

    <aside class="hidden w-80 shrink-0 overflow-y-auto border-l lg:block">
      <AppPanelSection title="Registered tools" description="Disabled tools are hidden from the agent.">
        <div class="space-y-3">
          <label
            v-for="tool in tools"
            :key="tool.tool.name"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs">{{ tool.tool.name }}</span>
                <Badge variant="secondary" class="text-[10px]">
                  {{ tool.isAutomatic ? 'Automatic' : 'Needs approval' }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ tool.tool.description }}</p>
            </div>
            <Switch v-model="tool.enabled.value" />
          </label>
        </div>
      </AppPanelSection>

      <AppPanelSection title="Tool call log" description="The current run, live from useToolCalls.">
        <div class="space-y-1 font-mono text-xs">
          <AgToolCallStatus :tool-calls="toolCallLog">
            <template #running="{ id, name }">
              <div :key="id" class="flex items-center gap-2 py-1">
                <Loader2 class="size-3.5 animate-spin text-muted-foreground" />
                {{ name }}
              </div>
            </template>
            <template #awaiting-result="{ id, name }">
              <div :key="id" class="flex items-center gap-2 py-1">
                <Clock class="size-3.5 text-warning" />
                {{ name }}
                <span class="ml-auto text-muted-foreground">awaiting result</span>
              </div>
            </template>
            <template #completed="{ id, name, duration }">
              <div :key="id" class="flex items-center gap-2 py-1">
                <Check class="size-3.5 text-success" />
                {{ name }}
                <span v-if="duration" class="ml-auto text-muted-foreground">{{ duration }} ms</span>
              </div>
            </template>
            <template #error="{ id, name }">
              <div :key="id" class="flex items-center gap-2 py-1">
                <CircleX class="size-3.5 text-destructive" />
                {{ name }}
              </div>
            </template>
            <template #empty>
              <p class="font-sans text-muted-foreground">No tool calls yet.</p>
            </template>
          </AgToolCallStatus>
        </div>
      </AppPanelSection>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { z } from 'zod'
import { Check, CircleX, Clock, Loader2 } from '@lucide/vue'
import { AgToolCallStatus, useAgent, useFrontendTool, useToolCalls } from '@and-effect/ag-ui-vue'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import AppApprovalCard from '@/components/AppApprovalCard.vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import AppPanelSection from '@/components/AppPanelSection.vue'
import { inspect } from '@/composables/useEventInspector'
import { useTheme } from '@/composables/useTheme'

const chat = useAgent({ url: '/api/frontend-tools' })
const { toolCalls } = useToolCalls(chat.agent)
const { isDark } = useTheme()
inspect(chat.agent)

// Automatic: has a handler, so it runs as soon as the agent calls it.
// Zod infers the handler's args as { enabled: boolean }.
const darkMode = useFrontendTool(chat, {
  name: 'setDarkMode',
  description: 'Change the UI theme to dark or light mode based on time of day or user preference',
  parameters: z.object({
    enabled: z.boolean().describe('true for dark mode, false for light mode'),
  }),
  handler: async ({ enabled }) => {
    isDark.value = enabled
    return { success: true, enabled }
  },
})

// Human in the loop: no handler, so each call waits in `calls` with status
// 'pending' until you respond() or reject() it.
const confirm = useFrontendTool(chat, {
  name: 'confirmAction',
  description:
    'Request user confirmation before performing an action. Always use this for actions that have side effects.',
  parameters: z.object({
    action: z.string().describe("Short name of the action (e.g. 'Switch to dark mode')"),
    description: z.string().describe('Detailed explanation of what will happen'),
    severity: z.enum(['low', 'medium', 'high']).optional().describe('How impactful this action is'),
  }),
})

const tools = [darkMode, confirm]

const pendingConfirmations = computed(() => confirm.calls.value.filter((call) => call.status === 'pending'))
const toolCallLog = computed(() => [...toolCalls.value.values()].reverse())
</script>
