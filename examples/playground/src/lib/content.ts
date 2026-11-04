import type { DeepReadonly } from 'vue'
import type { ContentPart, PartSource } from '@and-effect/ag-ui-vue'

export type AnyContentPart = ContentPart | DeepReadonly<ContentPart>

/**
 * Browser-displayable URL for a content part's source, or null when there
 * isn't one. AG-UI 1.0's third source arm, `file`, is a handle the model
 * provider issued for bytes already uploaded to it — its `value` is not a URL
 * and must never be rendered as one.
 */
export function previewSrc(source: PartSource | DeepReadonly<PartSource> | undefined): string | null {
  if (!source) return null
  if (source.type === 'data') return `data:${source.mimeType};base64,${source.value}`
  if (source.type === 'url') return source.value
  return null
}

/** Short human label for a non-text part: its file name, else its MIME type. */
export function partLabel(part: AnyContentPart): string {
  if (part.type === 'text') return part.text
  const filename = part.metadata?.filename
  if (typeof filename === 'string') return filename
  return part.source.type === 'file' ? 'file' : (part.source.mimeType ?? part.type)
}
