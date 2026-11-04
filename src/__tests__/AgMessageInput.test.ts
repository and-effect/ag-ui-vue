import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { enforceOutgoingInput } from '@ag-ui/client'
import { AgMessageInput } from '../components/AgMessageInput'
import type { InputContent } from '../types'

// ─── FileReader mock ───────────────────────────────────────────────────────
// fileToBase64 uses FileReader.readAsDataURL. We stub it so tests run
// synchronously and return predictable base64 values.

class MockFileReader {
  onload: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  result = ''

  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,MOCK_BASE64`
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.stubGlobal('FileReader', MockFileReader)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Mount helper ──────────────────────────────────────────────────────────

interface MountedInput {
  /** Latest slot props — updated after every re-render. */
  slotProps: () => {
    value: string
    onInput: (e: Event) => void
    onSubmit: () => void
    onAbort: () => void
    onAttach: (file: File) => Promise<void>
    onRemoveAttachment: (index: number) => void
    isRunning: boolean
    canSend: boolean
    attachments: InputContent[]
  }
  emitted: Array<{ event: 'send' | 'abort'; payload?: string | InputContent[] }>
  unmount: () => void
}

function mountInput(props: { isRunning?: boolean; disabled?: boolean } = {}): MountedInput {
  let captured: any = null
  const emitted: MountedInput['emitted'] = []

  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(
          AgMessageInput,
          {
            isRunning: props.isRunning ?? false,
            disabled: props.disabled ?? false,
            onSend: (payload: string | InputContent[]) =>
              emitted.push({ event: 'send', payload }),
            onAbort: () => emitted.push({ event: 'abort' }),
          },
          {
            default: (sp: any) => {
              captured = sp
              return []
            },
          },
        )
    },
  })

  const app = createApp(Wrapper)
  app.mount(document.createElement('div'))

  return {
    slotProps: () => captured,
    emitted,
    unmount: () => app.unmount(),
  }
}

// ─── onAttach — MIME type mapping ─────────────────────────────────────────

describe('AgMessageInput — onAttach()', () => {
  it('creates an ImagePart carrying the filename in metadata for image/* files', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()

    expect(slotProps().attachments).toHaveLength(1)
    expect(slotProps().attachments[0]).toMatchObject({
      type: 'image',
      source: { type: 'data', value: 'MOCK_BASE64', mimeType: 'image/png' },
      metadata: { filename: 'photo.png' },
    })
    unmount()
  })

  it('creates an AudioPart carrying the filename in metadata for audio/* files', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'clip.mp3', { type: 'audio/mpeg' }))
    await nextTick()

    expect(slotProps().attachments[0]).toMatchObject({
      type: 'audio',
      source: { type: 'data', value: 'MOCK_BASE64', mimeType: 'audio/mpeg' },
      metadata: { filename: 'clip.mp3' },
    })
    unmount()
  })

  it('creates a VideoPart carrying the filename in metadata for video/* files', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'clip.mp4', { type: 'video/mp4' }))
    await nextTick()

    expect(slotProps().attachments[0]).toMatchObject({
      type: 'video',
      source: { type: 'data', value: 'MOCK_BASE64', mimeType: 'video/mp4' },
      metadata: { filename: 'clip.mp4' },
    })
    unmount()
  })

  it('creates a DocumentPart carrying the filename in metadata for all other files', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'report.pdf', { type: 'application/pdf' }))
    await nextTick()

    expect(slotProps().attachments[0]).toMatchObject({
      type: 'document',
      source: { type: 'data', value: 'MOCK_BASE64', mimeType: 'application/pdf' },
      metadata: { filename: 'report.pdf' },
    })
    // AG-UI 1.0 dropped the top-level `filename` field, and the client's
    // enforceOutgoingInput strips anything it does not recognise — so a
    // regression back to it would silently lose the name on the wire.
    expect(slotProps().attachments[0]).not.toHaveProperty('filename')
    unmount()
  })

  it("keeps a media part's filename through the client's outgoing-input enforcement", async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()

    // Enforcement strips unknown fields right before the request is sent, so
    // its output is what the backend actually receives.
    const enforced = enforceOutgoingInput({
      threadId: 't',
      runId: 'r',
      messages: [{ id: 'm', role: 'user', content: slotProps().attachments }],
      tools: [],
      context: [],
    })

    const [part] = enforced.messages[0].content as InputContent[]
    expect(part).toMatchObject({ type: 'image', metadata: { filename: 'photo.png' } })
    unmount()
  })

  it('accumulates multiple attachments', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'a.png', { type: 'image/png' }))
    await nextTick()
    await slotProps().onAttach(new File([''], 'b.pdf', { type: 'application/pdf' }))
    await nextTick()

    expect(slotProps().attachments).toHaveLength(2)
    unmount()
  })
})

// ─── canSend ───────────────────────────────────────────────────────────────

describe('AgMessageInput — canSend', () => {
  it('is false with no text and no attachments', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()
    expect(slotProps().canSend).toBe(false)
    unmount()
  })

  it('is true with attachments even when text is empty', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()

    expect(slotProps().canSend).toBe(true)
    unmount()
  })

  it('is false when isRunning is true', async () => {
    const { slotProps, unmount } = mountInput({ isRunning: true })
    await nextTick()

    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()

    expect(slotProps().canSend).toBe(false)
    unmount()
  })
})

// ─── onSubmit ─────────────────────────────────────────────────────────────

describe('AgMessageInput — onSubmit()', () => {
  it('emits string when there are no attachments', async () => {
    const { slotProps, emitted, unmount } = mountInput()
    await nextTick()

    slotProps().onInput({ target: { value: 'hello' } } as any)
    await nextTick()
    slotProps().onSubmit()

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toEqual({ event: 'send', payload: 'hello' })
    unmount()
  })

  it('emits InputContent[] with only attachment parts when text is empty', async () => {
    const { slotProps, emitted, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()
    slotProps().onSubmit()

    expect(emitted).toHaveLength(1)
    const payload = emitted[0].payload as InputContent[]
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({ type: 'image' })
    unmount()
  })

  it('emits InputContent[] with text part first when text + attachments', async () => {
    const { slotProps, emitted, unmount } = mountInput()
    await nextTick()

    slotProps().onInput({ target: { value: 'What is this?' } } as any)
    await nextTick()
    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()
    slotProps().onSubmit()

    const payload = emitted[0].payload as InputContent[]
    expect(Array.isArray(payload)).toBe(true)
    expect(payload[0]).toEqual({ type: 'text', text: 'What is this?' })
    expect(payload[1]).toMatchObject({ type: 'image' })
    unmount()
  })

  it('clears text and attachments after submit', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    slotProps().onInput({ target: { value: 'hello' } } as any)
    await nextTick()
    await slotProps().onAttach(new File([''], 'photo.png', { type: 'image/png' }))
    await nextTick()
    slotProps().onSubmit()
    await nextTick()

    expect(slotProps().value).toBe('')
    expect(slotProps().attachments).toHaveLength(0)
    unmount()
  })

  it('does not emit when canSend is false', async () => {
    const { slotProps, emitted, unmount } = mountInput()
    await nextTick()

    slotProps().onSubmit()

    expect(emitted).toHaveLength(0)
    unmount()
  })
})

// ─── onRemoveAttachment ────────────────────────────────────────────────────

describe('AgMessageInput — onRemoveAttachment()', () => {
  it('removes the attachment at the given index', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'a.png', { type: 'image/png' }))
    await nextTick()
    await slotProps().onAttach(new File([''], 'b.pdf', { type: 'application/pdf' }))
    await nextTick()
    await slotProps().onAttach(new File([''], 'c.mp3', { type: 'audio/mpeg' }))
    await nextTick()

    slotProps().onRemoveAttachment(1)
    await nextTick()

    const atts = slotProps().attachments
    expect(atts).toHaveLength(2)
    expect(atts[0]).toMatchObject({ type: 'image' })
    expect(atts[1]).toMatchObject({ type: 'audio' })
    unmount()
  })

  it('removes the only attachment, making canSend false with no text', async () => {
    const { slotProps, unmount } = mountInput()
    await nextTick()

    await slotProps().onAttach(new File([''], 'a.png', { type: 'image/png' }))
    await nextTick()
    expect(slotProps().canSend).toBe(true)

    slotProps().onRemoveAttachment(0)
    await nextTick()

    expect(slotProps().attachments).toHaveLength(0)
    expect(slotProps().canSend).toBe(false)
    unmount()
  })
})
