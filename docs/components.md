# Headless Components

Five renderless components ship with the library. They have no HTML output — all rendering is done by your template through scoped slots.

```ts
import { AgMessageList, AgMessageInput, AgThreadList, AgToolCallStatus, AgInterrupt } from '@and-effect/ag-ui-vue'
```

## `AgMessageList`

Per-type named slots — no `v-if` branching, no type casts:

```vue
<AgMessageList :messages="messages" :streaming-content="streamingContent">
  <template #user="{ content }">
    <div class="text-right">{{ content }}</div>
  </template>
  <template #assistant="{ content }">
    <div>{{ content }}</div>
  </template>
  <template #assistant-tool-calls="{ toolCalls }">
    <div v-for="tc in toolCalls" :key="tc.id">🔧 {{ tc.function.name }}</div>
  </template>
  <template #tool-result="{ content }">✅ {{ content }}</template>
  <template #streaming="{ content }">{{ content }}<span class="cursor" /></template>
  <template #empty>Start a conversation…</template>
</AgMessageList>
```

The streaming cursor is yours to render too. With Tailwind, for example:

```vue
<template #streaming="{ content }">{{ content }}<span class="inline-block w-2 h-4 bg-current animate-pulse" /></template>
```

| Slot | Props |
|---|---|
| `#user` | `msg, content, index` |
| `#assistant` | `msg, content, index` |
| `#assistant-tool-calls` | `msg, toolCalls, index` |
| `#tool-result` | `msg, content, toolCallId, index` |
| `#system` | `msg, content, index` |
| `#developer` | `msg, content, index` |
| `#reasoning` | `msg, content, index` |
| `#activity` | `msg, index` |
| `#message` (fallback) | `msg, type, content, toolCalls, toolCallId, index` |
| `#streaming` | `content` |
| `#empty` | — |

`#reasoning` and `#activity` cover the two message kinds AG-UI 1.0 added: the model's own working (the `REASONING_*` family that replaced `THINKING_*`) and structured progress (`ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`). Neither is an assistant answer, so **neither renders unless you provide its slot** — reasoning is opt-in rather than silently shown as the reply. An activity message's content is an object, so the string-only `content` prop is `undefined` for it; read `msg.content`. Both update live while the run streams. Pair `#reasoning` with [`useReasoning`](composables/use-reasoning.md) for streaming status.

A tool result may also be multimodal in 1.0 (`ContentPart[]`). `#tool-result`'s `content` is then the flattened text — the same as `ReactiveToolCall.result` — so `{{ content }}` keeps working; read `msg.content` for the media parts.

## `AgMessageInput`

Manages the input value, submit/abort, and file attachments:

```vue
<AgMessageInput :is-running="isRunning" @send="send" @abort="abort">
  <template #default="{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, attachments, isRunning: running, canSend }">
    <form @submit.prevent="onSubmit">
      <!-- Attachment strip -->
      <div v-for="(att, i) in attachments" :key="i">
        <img v-if="att.type === 'image'" :src="`data:${att.source.mimeType};base64,${att.source.value}`" :alt="att.metadata?.filename || 'Attached image'" />
        <span v-else>📄 {{ att.metadata?.filename ?? att.source.mimeType }}</span>
        <button type="button" @click="onRemoveAttachment(i)">✕</button>
      </div>

      <input :value="value" @input="onInput" :disabled="running" placeholder="Type a message…" />

      <!-- File picker — calls onAttach(file) to read and queue the attachment -->
      <label>
        <input type="file" class="hidden" accept="image/*,audio/*,video/*,.pdf" @change="e => onAttach(e.target.files[0])" />
        📎
      </label>

      <button v-if="!running" type="submit" :disabled="!canSend">Send</button>
      <button v-else type="button" @click="onAbort">Stop</button>
    </form>
  </template>
</AgMessageInput>
```

`onAttach(file)` reads the file as base64 and adds the appropriate `ContentPart` to the internal attachment list — `ImagePart` for `image/*`, `AudioPart` for `audio/*`, `VideoPart` for `video/*`, and `DocumentPart` for everything else. Every part carries the file's name in `metadata.filename`, so you can show it or use it in an `alt` text or accessible label. The name is sent to your backend along with the file. A file name can contain personal details, so if you don't want that, drop `metadata` from the parts in your `@send` handler before calling `send()`. `onRemoveAttachment(index)` removes the item at that index. On submit, text and attachments are merged into `ContentPart[]` automatically; a text-only message still emits a plain `string` for backward compatibility.

Props: `isRunning` (required) · `disabled` (optional) · `modelValue` (optional, v-model) · `attachments` (optional, controlled mode)
Events: `send(content: string | ContentPart[])` · `abort()` · `update:modelValue` · `update:attachments`
Slot: `{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, attachments, isRunning, canSend }`

## `AgThreadList`

Iterates threads with per-item state and handlers:

```vue
<AgThreadList :threads="threads" :active-thread-id="activeThreadId" @switch="switchThread" @delete="deleteThread">
  <template #thread="{ thread, isActive, onSwitch, onDelete }">
    <button @click="onSwitch" :class="{ active: isActive }">
      {{ thread.title ?? 'New conversation' }}
      <span @click.stop="onDelete">✕</span>
    </button>
  </template>
  <template #empty>No threads yet</template>
</AgThreadList>
```

Slots: `#thread="{ thread, isActive, onSwitch, onDelete }"` · `#empty`
Events: `switch(id)` · `delete(id)`

## `AgToolCallStatus`

Per-status named slots for live tool execution progress:

```vue
<AgToolCallStatus :tool-calls="activeToolCalls">
  <template #running="{ name, parsedArgs }">
    <div>⚙️ {{ name }}… <pre v-if="parsedArgs">{{ parsedArgs }}</pre></div>
  </template>
  <template #awaiting-result="{ name }">
    <div>⏳ {{ name }} — waiting for result…</div>
  </template>
  <template #completed="{ name, duration }">
    <div>✅ {{ name }} ({{ duration }}ms)</div>
  </template>
  <template #error="{ name }">
    <div>❌ {{ name }}</div>
  </template>
</AgToolCallStatus>
```

| Slot | Props |
|---|---|
| `#running` | `toolCall, name, args, parsedArgs, index` |
| `#awaiting-result` | `toolCall, name, args, parsedArgs, index` |
| `#completed` | `toolCall, name, result, duration, index` |
| `#error` | `toolCall, name, duration, index` |
| `#tool-call` (fallback) | `toolCall, status, name, args, parsedArgs, result, duration, startedAt, completedAt, index` |
| `#empty` | — |

## `AgInterrupt`

Renders the open [interrupts](composables/use-interrupts.md) one slot per interrupt, routed by `reason`, plus a `#resume` slot for the Continue control:

```vue
<AgInterrupt :agent="agentCtx">
  <template #tool_call="{ interrupt, args, toolName, resolve, cancel }">
    <ApprovalCard :title="interrupt.message ?? toolName" :args="args" :status="interrupt.status"
      @approve="resolve({ approved: true })" @reject="cancel()" />
  </template>
  <template #input_required="{ interrupt, resolve }">
    <SchemaForm :schema="interrupt.responseSchema" @submit="resolve" />
  </template>
  <!-- any reason without its own slot -->
  <template #default="{ interrupt, resolve, cancel }">…</template>
  <template #resume="{ canResume, resumeAll }">
    <button :disabled="!canResume" @click="resumeAll()">Continue</button>
  </template>
</AgInterrupt>
```

| Slot | Props |
|---|---|
| `#<reason>` / `#default` (fallback) | `interrupt, args, toolName, resolve, cancel` |
| `#resume` (only while paused) | `canResume, resumeAll, cancelAll` |

`agent` is the `useAgent` return value. For a `tool_call` interrupt, `args` and `toolName` come from the server tool call it points at in `messages`. It works the same way as `useInterrupts`: an answered interrupt stays in the list, with its answer in `interrupt.status` / `interrupt.payload`, and can be changed until `resumeAll()` sends them all. `default` and `resume` are reserved slot names.
