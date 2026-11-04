import type { HighlighterCore } from 'shiki/core'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

let highlighter: Promise<HighlighterCore> | undefined

/** Lazily created, shared Shiki highlighter with only the grammars the Code tab needs. */
export function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light-default.mjs'), import('shiki/themes/github-dark-default.mjs')],
    langs: [
      import('shiki/langs/vue.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/python.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}
