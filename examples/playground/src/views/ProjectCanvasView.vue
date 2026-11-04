<template>
  <div class="flex h-full flex-col lg:flex-row">
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <ProjectCanvasBoard :state="state" @update="onBoardUpdate" />
    </div>

    <div class="flex h-[55dvh] shrink-0 flex-col border-t bg-sidebar lg:h-auto lg:w-[420px] lg:border-t-0 lg:border-l">
      <AppChatPanel
        :messages="chat.messages.value"
        :streaming-content="chat.streamingContent.value"
        :is-running="chat.isRunning.value"
        :error="chat.error.value"
        attachments
        placeholder="Describe what you want to build…"
        :suggestions="['Help me plan a task management app', 'Suggest three core features']"
        empty-title="Plan a project together. Every change the assistant proposes waits for you."
        @send="chat.send"
        @abort="chat.abort"
      >
        <AppApprovalCard
          v-for="proposal in proposals"
          :key="proposal.id"
          :title="proposal.title"
          :icon="proposal.icon"
          approve-label="Apply"
          @approve="approve(proposal)"
          @reject="proposal.call.reject?.('User rejected')"
        >
          <p class="text-foreground">{{ proposal.summary }}</p>
          <p v-if="proposal.detail" class="mt-1">{{ proposal.detail }}</p>
        </AppApprovalCard>
      </AppChatPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { z } from 'zod'
import { FilePen, ListMinus, ListPlus, SquareMinus, SquarePlus } from '@lucide/vue'
import type { FrontendToolCall } from '@and-effect/ag-ui-vue'
import { useAgent, useAgentState, useFrontendTool } from '@and-effect/ag-ui-vue'
import AppApprovalCard from '@/components/AppApprovalCard.vue'
import AppChatPanel from '@/components/AppChatPanel.vue'
import ProjectCanvasBoard from '@/components/ProjectCanvasBoard.vue'
import { inspect } from '@/composables/useEventInspector'
import type { ProjectCanvasState } from '@/types/projectCanvas'

interface Proposal {
  id: string
  title: string
  icon: Component
  summary: string
  detail?: string
  /** Applies the change to the shared state once the user approves. */
  apply: () => void
  call: Pick<FrontendToolCall, 'respond' | 'reject'>
}

const chat = useAgent({ url: '/api/project-canvas' })
inspect(chat.agent)

// The whole canvas is shared state: sent to the agent on every run, edited
// directly by the board, and changed by the agent only through proposals.
const { state } = useAgentState<ProjectCanvasState>(chat.agent, {
  initialState: { description: '', features: [], user_stories: [] },
})

// Five human-in-the-loop tools — none has a handler, so every call waits for
// the user to apply or reject it.
const updateDescription = useFrontendTool(chat, {
  name: 'update_description',
  description: 'Replace the project description with a new one',
  parameters: z.object({ description: z.string().describe('The new project description') }),
})
const addFeature = useFrontendTool(chat, {
  name: 'add_feature',
  description: 'Add a feature to the project features list',
  parameters: z.object({ feature: z.string().describe('The feature to add') }),
})
const removeFeature = useFrontendTool(chat, {
  name: 'remove_feature',
  description: 'Remove a feature from the project features list',
  parameters: z.object({ feature: z.string().describe('Exact text of the feature to remove') }),
})
const addUserStory = useFrontendTool(chat, {
  name: 'add_user_story',
  description: 'Add a user story to the project',
  parameters: z.object({
    title: z.string().describe('Short user story title'),
    description: z.string().describe('Full user story description (As a ... I want ... So that ...)'),
  }),
})
const removeUserStory = useFrontendTool(chat, {
  name: 'remove_user_story',
  description: 'Remove a user story from the project by title',
  parameters: z.object({ title: z.string().describe('Title of the user story to remove') }),
})

const proposals = computed<Proposal[]>(() => [
  ...pending(updateDescription.calls.value, ({ description = '' }) => ({
    title: 'Update description',
    icon: FilePen,
    summary: description,
    apply: () => (state.description = description),
  })),
  ...pending(addFeature.calls.value, ({ feature = '' }) => ({
    title: 'Add feature',
    icon: ListPlus,
    summary: feature,
    apply: () => state.features.push(feature),
  })),
  ...pending(removeFeature.calls.value, ({ feature = '' }) => ({
    title: 'Remove feature',
    icon: ListMinus,
    summary: feature,
    apply: () => (state.features = state.features.filter((f) => f !== feature)),
  })),
  ...pending(addUserStory.calls.value, ({ title = '', description = '' }) => ({
    title: 'Add user story',
    icon: SquarePlus,
    summary: title,
    detail: description,
    apply: () => state.user_stories.push({ id: crypto.randomUUID(), title, description }),
  })),
  ...pending(removeUserStory.calls.value, ({ title = '' }) => ({
    title: 'Remove user story',
    icon: SquareMinus,
    summary: title,
    apply: () => (state.user_stories = state.user_stories.filter((s) => s.title !== title)),
  })),
])

function pending<TArgs>(
  calls: readonly { id: string; status: string; args: TArgs; respond?: FrontendToolCall['respond']; reject?: FrontendToolCall['reject'] }[],
  describe: (args: TArgs) => Omit<Proposal, 'id' | 'call'>,
): Proposal[] {
  return calls
    .filter((call) => call.status === 'pending')
    .map((call) => ({ id: call.id, call, ...describe(call.args) }))
}

function approve(proposal: Proposal) {
  proposal.apply()
  proposal.call.respond?.({ applied: true })
}

function onBoardUpdate(mutate: (state: ProjectCanvasState) => void) {
  mutate(state)
}
</script>
