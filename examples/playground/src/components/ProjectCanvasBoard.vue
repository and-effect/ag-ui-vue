<template>
  <div class="mx-auto max-w-2xl space-y-10 px-8 py-10">
    <section>
      <h2 class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Description</h2>
      <textarea
        :key="state.description"
        :value="state.description"
        placeholder="What are you building? Describe it here or ask the assistant…"
        rows="2"
        class="w-full resize-none bg-transparent text-lg leading-relaxed outline-none field-sizing-content placeholder:text-muted-foreground/60"
        @blur="setDescription"
      />
    </section>

    <section>
      <h2 class="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Features
        <span class="tabular-nums">{{ state.features.length }}</span>
      </h2>
      <ul class="space-y-0.5">
        <li
          v-for="(feature, index) in state.features"
          :key="feature"
          class="group/feature -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50"
        >
          <CircleCheck class="mt-0.5 size-4 shrink-0 text-success" />
          <span class="flex-1 text-sm">{{ feature }}</span>
          <button
            class="text-muted-foreground opacity-0 group-hover/feature:opacity-100 focus-visible:opacity-100"
            aria-label="Remove feature"
            @click="removeFeature(index)"
          >
            <X class="size-4" />
          </button>
        </li>
      </ul>
      <form class="-mx-2 mt-1 flex items-center gap-2.5 px-2 py-1.5" @submit.prevent="addFeature">
        <Plus class="size-4 shrink-0 text-muted-foreground" />
        <input
          v-model="newFeature"
          placeholder="Add a feature"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>
    </section>

    <section>
      <h2 class="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        User stories
        <span class="tabular-nums">{{ state.user_stories.length }}</span>
      </h2>
      <div class="space-y-2">
        <div
          v-for="story in state.user_stories"
          :key="story.id"
          class="group/story relative rounded-lg border bg-card p-4"
        >
          <input
            :value="story.title"
            placeholder="Story title"
            class="w-full bg-transparent pr-6 text-sm font-medium outline-none placeholder:text-muted-foreground"
            @input="editStory(story.id, 'title', $event)"
          />
          <textarea
            :value="story.description"
            placeholder="As a … I want … so that …"
            rows="1"
            class="mt-1 w-full resize-none bg-transparent text-sm text-muted-foreground outline-none field-sizing-content"
            @input="editStory(story.id, 'description', $event)"
          />
          <button
            class="absolute top-3 right-3 text-muted-foreground opacity-0 group-hover/story:opacity-100 focus-visible:opacity-100"
            aria-label="Remove story"
            @click="removeStory(story.id)"
          >
            <X class="size-4" />
          </button>
        </div>
      </div>
      <Button variant="ghost" size="sm" class="mt-2 -ml-2 text-muted-foreground" @click="addStory">
        <Plus />
        Add story
      </Button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CircleCheck, Plus, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { ProjectCanvasState } from '@/types/projectCanvas'

const { state } = defineProps<{ state: ProjectCanvasState }>()

// The parent owns the shared state; it applies these mutations to the
// reactive object and useAgentState syncs them to the agent.
const emit = defineEmits<{ update: [mutate: (state: ProjectCanvasState) => void] }>()

const newFeature = ref('')

function setDescription(event: Event) {
  const description = (event.target as HTMLTextAreaElement).value.trim()
  if (description !== state.description) emit('update', (s) => (s.description = description))
}

function addFeature() {
  const feature = newFeature.value.trim()
  if (!feature) return
  emit('update', (s) => s.features.push(feature))
  newFeature.value = ''
}

function removeFeature(index: number) {
  emit('update', (s) => s.features.splice(index, 1))
}

function addStory() {
  emit('update', (s) => s.user_stories.push({ id: crypto.randomUUID(), title: '', description: '' }))
}

function editStory(id: string, field: 'title' | 'description', event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update', (s) => {
    const story = s.user_stories.find((us) => us.id === id)
    if (story) story[field] = value
  })
}

function removeStory(id: string) {
  emit('update', (s) => s.user_stories.splice(s.user_stories.findIndex((us) => us.id === id), 1))
}
</script>
