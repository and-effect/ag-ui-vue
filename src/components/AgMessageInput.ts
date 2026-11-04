import { defineComponent, ref, computed, h, Fragment, markRaw } from 'vue'
import type {
  ContentPart,
  ImagePart,
  AudioPart,
  VideoPart,
  DocumentPart,
} from '@ag-ui/core'

/**
 * Headless message input. Manages input value state (internally, or via v-model),
 * handles submit/abort logic, and exposes everything to the default scoped slot.
 *
 * Props:
 * - `isRunning` — whether the agent is currently running
 * - `disabled` — additional disabled flag (e.g. no active thread)
 * - `modelValue` — optional v-model binding for the input value
 * - `attachments` — optional controlled list of pending ContentPart attachments
 *
 * Events:
 * - `send(content: string | ContentPart[])` — plain text or multimodal content array
 * - `abort()`
 * - `update:modelValue`
 * - `update:attachments`
 *
 * Slot props: `{ value, onInput, onSubmit, onAbort, onAttach, onRemoveAttachment, isRunning, canSend, attachments }`
 *
 * Every part `onAttach` creates carries the file's name in `metadata.filename`.
 *
 * @example
 * <AgMessageInput :is-running="isRunning" @send="send" @abort="abort">
 *   <template #default="{ value, onInput, onSubmit, onAbort, onAttach, isRunning: running, canSend, attachments }">
 *     <form @submit.prevent="onSubmit">
 *       <input :value="value" @input="onInput" :disabled="running" />
 *       <input type="file" @change="e => onAttach(e.target.files[0])" />
 *       <button v-if="!running" type="submit" :disabled="!canSend">Send</button>
 *       <button v-else type="button" @click="onAbort">Stop</button>
 *     </form>
 *   </template>
 * </AgMessageInput>
 */
export const AgMessageInput = defineComponent({
  name: 'AgMessageInput',
  props: {
    isRunning: { type: Boolean, required: true },
    disabled: { type: Boolean, default: false },
    modelValue: { type: String, default: undefined },
    attachments: { type: Array as () => ContentPart[], default: undefined },
  },
  emits: {
    'update:modelValue': (_value: string) => true,
    'update:attachments': (_attachments: ContentPart[]) => true,
    send: (_content: string | ContentPart[]) => true,
    abort: () => true,
  },
  setup(props, { slots, emit }) {
    const internal = ref('')
    const internalAttachments = ref<ContentPart[]>([])

    const value = computed(() =>
      props.modelValue !== undefined ? props.modelValue : internal.value,
    )

    const attachments = computed(() =>
      props.attachments !== undefined ? props.attachments : internalAttachments.value,
    )

    const canSend = computed(
      () =>
        (value.value.trim().length > 0 || attachments.value.length > 0) &&
        !props.isRunning &&
        !props.disabled,
    )

    function updateValue(v: string) {
      if (props.modelValue !== undefined) {
        emit('update:modelValue', v)
      } else {
        internal.value = v
      }
    }

    function updateAttachments(list: ContentPart[]) {
      if (props.attachments !== undefined) {
        emit('update:attachments', list)
      } else {
        internalAttachments.value = list
      }
    }

    function onInput(event: Event) {
      updateValue((event.target as HTMLInputElement).value)
    }

    async function onAttach(file: File): Promise<void> {
      const base64 = await fileToBase64(file)
      const source = { type: 'data' as const, value: base64, mimeType: file.type }
      // AG-UI 1.0 parts have no `filename` field, so the name goes in the
      // open-by-key `metadata` bag, which outgoing-input enforcement passes
      // through untouched. `@ag-ui/client` uses the same key when it converts
      // legacy binary parts.
      const metadata = { filename: file.name }
      // `satisfies`, not `as` — the parts are structurally complete, and an
      // `as` cast would silently accept a field AG-UI 1.0 does not define,
      // which `enforceOutgoingInput` then strips from the outgoing request.
      const item: ContentPart = markRaw(
        file.type.startsWith('image/')
          ? ({ type: 'image', source, metadata } satisfies ImagePart)
          : file.type.startsWith('audio/')
            ? ({ type: 'audio', source, metadata } satisfies AudioPart)
            : file.type.startsWith('video/')
              ? ({ type: 'video', source, metadata } satisfies VideoPart)
              : ({ type: 'document', source, metadata } satisfies DocumentPart),
      )
      updateAttachments([...attachments.value, item])
    }

    function onSubmit() {
      if (!canSend.value) return
      const text = value.value.trim()
      const files = attachments.value

      if (files.length > 0) {
        const parts: ContentPart[] = []
        if (text) parts.push({ type: 'text', text })
        parts.push(...files)
        updateValue('')
        updateAttachments([])
        emit('send', parts)
      } else {
        updateValue('')
        emit('send', text)
      }
    }

    function onAbort() {
      emit('abort')
    }

    function onRemoveAttachment(index: number) {
      updateAttachments(attachments.value.filter((_, i) => i !== index))
    }

    return () =>
      h(
        Fragment,
        slots.default?.({
          value: value.value,
          onInput,
          onSubmit,
          onAbort,
          onAttach,
          onRemoveAttachment,
          isRunning: props.isRunning,
          canSend: canSend.value,
          attachments: attachments.value,
        }) ?? [],
      )
  },
})

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
