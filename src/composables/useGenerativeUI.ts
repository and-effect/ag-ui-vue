import { computed, markRaw, onScopeDispose, type ComputedRef, type Component } from 'vue'
import type { Tool } from '@ag-ui/core'
import type { UseAgentReturn } from './useAgent'
import { getToolRegistry, createToolRegistry } from './toolRegistry'
import { useToolCalls } from './useToolCalls'
import type { ReactiveToolCall, ToolCallStatus } from './useToolCalls'

/**
 * A full GenUI registry entry with component and optional tool metadata.
 */
export interface GenUIEntry {
  /** Vue component to render when this tool is called */
  component: Component

  /** Human-readable description passed to the agent as the tool's description */
  description?: string

  /** JSON Schema for the tool's parameters (sent to the agent) */
  parameters?: any

  /**
   * Optional component to render while the tool call args are still streaming.
   * Falls back to the main component if not provided.
   */
  loading?: Component
}

/**
 * Maps tool names to Vue components or full GenUIEntry objects.
 * Use a bare component for zero-config registration; use a GenUIEntry
 * object when you need to control description, parameters, or the loading state.
 *
 * @example
 * ```ts
 * const registry: GenUIRegistry = {
 *   show_weather: WeatherCard,
 *   show_recipe: {
 *     component: RecipeCard,
 *     loading: RecipeSkeleton,
 *     description: 'Display a recipe',
 *     parameters: {
 *       type: 'object',
 *       properties: {
 *         title: { type: 'string' },
 *         ingredients: { type: 'array', items: { type: 'string' } },
 *       },
 *       required: ['title'],
 *     },
 *   },
 * }
 * ```
 */
export type GenUIRegistry = Record<string, Component | GenUIEntry>

/**
 * A resolved GenUI render item ready for use in templates.
 */
export interface ActiveGenUI {
  /** Tool call ID (stable key for v-for) */
  id: string
  /** Tool name — matches the registry key */
  name: string
  /** The component to render (loading component while streaming if configured) */
  component: Component
  /** Props to bind to the component (the tool call's parsed args) */
  props: Record<string, any>
  /** True while tool call args are still streaming */
  isStreaming: boolean
  /** Current lifecycle status of the underlying tool call */
  status: ToolCallStatus
}

export interface UseGenerativeUIOptions {
  /**
   * Clear GenUI renders when a new run starts.
   * Defaults to false so components persist across turns until the
   * component containing useGenerativeUI unmounts.
   */
  autoClear?: boolean
}

export interface UseGenerativeUIReturn {
  /** GenUI items whose tool call is active (streaming or awaiting_result) */
  activeComponents: ComputedRef<ActiveGenUI[]>
  /** All GenUI items — includes completed renders, good for persistent in-chat display */
  allComponents: ComputedRef<ActiveGenUI[]>
  /** Tool definitions built from the registry. Auto-registered with the agent; exposed only as an escape hatch. */
  tools: Tool[]
  /** Return the component registered for a tool name, or null if unregistered */
  resolve: (toolName: string) => Component | null
  /** Extract props from a ReactiveToolCall's parsed args */
  getProps: (tc: ReactiveToolCall) => Record<string, any>
  /** Manually clear all tracked GenUI renders */
  clear: () => void
}

/**
 * Returns true when `value` is a full GenUIEntry object (has a `component` field)
 * rather than a bare Vue component.
 *
 * Vue functional components are functions; Options/setup components are plain objects
 * that never carry a `component` key, so this check is reliable.
 */
function isGenUIEntry(value: Component | GenUIEntry): value is GenUIEntry {
  return typeof value !== 'function' && 'component' in (value as Record<string, unknown>)
}

function normalizeRegistry(registry: GenUIRegistry): Record<string, Required<Pick<GenUIEntry, 'component'>> & Omit<GenUIEntry, 'component'>> {
  const result: Record<string, GenUIEntry> = {}
  for (const [name, entry] of Object.entries(registry)) {
    const normalized = isGenUIEntry(entry) ? { ...entry } : { component: entry as Component }
    // markRaw the components: they end up bound via <component :is> and may pass
    // through reactive structures (ActiveGenUI items). Vue should never proxy a
    // component definition — doing so wastes work and triggers a dev warning.
    normalized.component = markRaw(normalized.component)
    if (normalized.loading) normalized.loading = markRaw(normalized.loading)
    result[name] = normalized
  }
  return result
}

/**
 * Composable for static (tool name → Vue component) Generative UI.
 *
 * Builds on top of `useToolCalls` to track the AG-UI tool call lifecycle
 * and maps each registered tool to a Vue component with the tool's parsed
 * args as props.
 *
 * **Typical usage:**
 * ```ts
 * const agentCtx = useAgent({ url: '/api/agent' })
 *
 * const { activeComponents } = useGenerativeUI(agentCtx, {
 *   show_weather: WeatherCard,
 *   show_recipe: {
 *     component: RecipeCard,
 *     loading: RecipeSkeleton,
 *     description: 'Display a recipe card',
 *     parameters: { type: 'object', properties: { title: { type: 'string' } } },
 *   },
 * })
 *
 * // Tools auto-register with the agent — a bare send() advertises them.
 * agentCtx.send('What is the weather in Berlin?')
 * ```
 *
 * **In templates:**
 * ```vue
 * <div v-for="item in activeComponents" :key="item.id">
 *   <component :is="item.component" v-bind="item.props" />
 * </div>
 * ```
 *
 * Use `allComponents` instead of `activeComponents` if you want components to
 * remain visible after their tool call completes (typical for persistent in-chat widgets).
 *
 * @param agentContext - Return value from `useAgent()`
 * @param registry - Maps tool names to Vue components or full GenUIEntry objects
 * @param options - Optional configuration
 */
export function useGenerativeUI(
  agentContext: UseAgentReturn,
  registry: GenUIRegistry,
  options: UseGenerativeUIOptions = {},
): UseGenerativeUIReturn {
  const { autoClear = false } = options

  const normalized = normalizeRegistry(registry)

  // Build AG-UI Tool definitions from the registry so the caller can pass
  // them straight to send() / continueRun() without extra boilerplate.
  // markRaw each tool def so it stays a plain object if a consumer collects it
  // into a reactive container before passing it back via send()/continueRun().
  const tools: Tool[] = Object.entries(normalized).map(([name, entry]) => markRaw({
    name,
    description: entry.description ?? `Render ${name} component`,
    parameters: entry.parameters ?? { type: 'object', properties: {} },
  }))

  const { toolCalls, clear } = useToolCalls(agentContext.agent, { autoClear })

  // Register each GenUI tool with the agent's shared coordinator as an
  // auto-resolving frontend tool: once its args finish streaming we submit a
  // `{ rendered: true }` result. The coordinator batches every frontend result
  // from the turn and fires a single continueRun once the run has finished — so
  // multiple GenUI tools (or a mix with useFrontendTool) produce exactly one
  // follow-up run, with no per-composable batching logic here.
  const coordinator =
    getToolRegistry(agentContext.agent) ??
    createToolRegistry(agentContext.agent, { continueRun: agentContext.continueRun })

  for (const tool of tools) {
    const unregister = coordinator.register({
      tool,
      isEnabled: () => true,
      onEnd(id) {
        coordinator.submitResult(id, JSON.stringify({ rendered: true }))
      },
    })
    onScopeDispose(unregister)
  }

  function toActiveGenUI(tc: ReactiveToolCall): ActiveGenUI | null {
    const entry = normalized[tc.name]
    if (!entry) return null

    const isStreaming = tc.status === 'running'
    const component = isStreaming && entry.loading ? entry.loading : entry.component

    return {
      id: tc.id,
      name: tc.name,
      component,
      props: (tc.parsedArgs as Record<string, any>) ?? {},
      isStreaming,
      status: tc.status,
    }
  }

  const activeComponents = computed<ActiveGenUI[]>(() => {
    const result: ActiveGenUI[] = []
    for (const tc of toolCalls.value.values()) {
      if (tc.status === 'running' || tc.status === 'awaiting_result') {
        const item = toActiveGenUI(tc)
        if (item) result.push(item)
      }
    }
    return result
  })

  const allComponents = computed<ActiveGenUI[]>(() => {
    const result: ActiveGenUI[] = []
    for (const tc of toolCalls.value.values()) {
      const item = toActiveGenUI(tc)
      if (item) result.push(item)
    }
    return result
  })

  function resolve(toolName: string): Component | null {
    return normalized[toolName]?.component ?? null
  }

  function getProps(tc: ReactiveToolCall): Record<string, any> {
    return (tc.parsedArgs as Record<string, any>) ?? {}
  }

  return {
    activeComponents,
    allComponents,
    tools,
    resolve,
    getProps,
    clear,
  }
}
