import type { Component } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import {
  Brain,
  Clock,
  Image,
  Layers,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessagesSquare,
  RefreshCw,
  ShieldQuestion,
  ThumbsUp,
  Wrench,
} from '@lucide/vue'

declare module 'vue-router' {
  interface RouteMeta {
    demo?: DemoMeta
  }
}

export interface DemoMeta {
  title: string
  /** One sentence, shown under the title and on the overview card. */
  description: string
  group: 'Composables' | 'Showcase'
  icon: Component
  /** Composables / components the demo is about, shown as badges. */
  apis: string[]
  /** AG-UI endpoint on the playground backend. */
  endpoint: string
  /** Files shown in the Code tab, as keys of AppCodeView's source glob. */
  sources: string[]
}

const CHAT_PANEL = 'components/AppChatPanel.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: () => import('@/views/OverviewView.vue') },
    {
      path: '/backend-tools',
      component: () => import('@/views/BackendToolsView.vue'),
      meta: {
        demo: {
          title: 'Tool calls',
          description: 'The basics: a chat whose agent calls a tool on the server.',
          group: 'Composables',
          icon: Clock,
          apis: ['useAgent', 'AgMessageList'],
          endpoint: '/api/backend-tools',
          sources: ['views/BackendToolsView.vue', 'backend/routers/backend_tools.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/frontend-tools',
      component: () => import('@/views/FrontendToolsView.vue'),
      meta: {
        demo: {
          title: 'Frontend tools',
          description:
            'Tools the agent calls in the browser — one runs automatically, one waits for your approval.',
          group: 'Composables',
          icon: Wrench,
          apis: ['useFrontendTool', 'useToolCalls', 'AgToolCallStatus'],
          endpoint: '/api/frontend-tools',
          sources: ['views/FrontendToolsView.vue', 'backend/routers/frontend_tools.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/human-in-the-loop',
      component: () => import('@/views/HumanInTheLoopView.vue'),
      meta: {
        demo: {
          title: 'Human in the loop',
          description: 'The agent pauses on an ambiguous request and asks you to pick an option.',
          group: 'Composables',
          icon: ListChecks,
          apis: ['useFrontendTool'],
          endpoint: '/api/hitl',
          sources: ['views/HumanInTheLoopView.vue', 'backend/routers/hitl.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/interrupts',
      component: () => import('@/views/InterruptsView.vue'),
      meta: {
        demo: {
          title: 'Interrupts',
          description:
            'Server tools that need your approval — the run pauses, you approve, deny or edit, and it resumes.',
          group: 'Composables',
          icon: ShieldQuestion,
          apis: ['useInterrupts', 'AgInterrupt'],
          endpoint: '/api/interrupts',
          sources: [
            'views/InterruptsView.vue',
            'components/AppInterruptCard.vue',
            'backend/routers/interrupts.py',
            CHAT_PANEL,
          ],
        },
      },
    },
    {
      path: '/shared-state',
      component: () => import('@/views/SharedStateView.vue'),
      meta: {
        demo: {
          title: 'Shared state',
          description:
            'One reactive object shared with the agent — it writes via state events, you write by mutating it.',
          group: 'Composables',
          icon: RefreshCw,
          apis: ['useAgentState'],
          endpoint: '/api/shared-state',
          sources: [
            'views/SharedStateView.vue',
            'backend/routers/shared_state.py',
            'backend/timezone.py',
            CHAT_PANEL,
          ],
        },
      },
    },
    {
      path: '/threads',
      component: () => import('@/views/ThreadsView.vue'),
      meta: {
        demo: {
          title: 'Threads',
          description: 'Multiple conversations on one agent, persisted to localStorage.',
          group: 'Composables',
          icon: MessagesSquare,
          apis: ['useThreads', 'AgThreadList', 'LocalStorageAdapter'],
          endpoint: '/api/threads',
          sources: ['views/ThreadsView.vue', 'backend/routers/shared_state.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/generative-ui',
      component: () => import('@/views/GenerativeUiView.vue'),
      meta: {
        demo: {
          title: 'Generative UI',
          description: 'The agent renders your Vue components inline by calling them as tools.',
          group: 'Composables',
          icon: Layers,
          apis: ['useGenerativeUI'],
          endpoint: '/api/generative-ui',
          sources: [
            'views/GenerativeUiView.vue',
            'components/ClockCard.vue',
            'components/DayNightCard.vue',
            'backend/routers/generative_ui.py',
            CHAT_PANEL,
          ],
        },
      },
    },
    {
      path: '/multimodal',
      component: () => import('@/views/MultimodalView.vue'),
      meta: {
        demo: {
          title: 'Multimodal',
          description: 'Attach images and documents; they are sent to the agent as content parts.',
          group: 'Composables',
          icon: Image,
          apis: ['useAgent', 'AgMessageInput'],
          endpoint: '/api/multimodal',
          sources: [
            'views/MultimodalView.vue',
            'components/AppMessageContent.vue',
            'components/AppComposer.vue',
            'backend/routers/multimodal.py',
          ],
        },
      },
    },
    {
      path: '/page-context',
      component: () => import('@/views/PageContextView.vue'),
      meta: {
        demo: {
          title: 'Page context',
          description:
            'Context tells the agent what the user is looking at right now. Here: open a building permit application and ask about “this one”. The agent answers about the open case, even after opening another one itself.',
          group: 'Composables',
          icon: MapPin,
          apis: ['useAgent', 'context'],
          endpoint: '/api/page-context',
          sources: ['views/PageContextView.vue', 'backend/routers/page_context.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/run-feedback',
      component: () => import('@/views/RunFeedbackView.vue'),
      meta: {
        demo: {
          title: 'Run identity',
          description:
            "Every message knows the run that produced it, so feedback joins back to the server's trace.",
          group: 'Composables',
          icon: ThumbsUp,
          apis: ['runForMessage', 'messageRuns', 'forwardedProps'],
          endpoint: '/api/feedback-chat',
          sources: ['views/RunFeedbackView.vue', 'backend/routers/feedback.py', CHAT_PANEL],
        },
      },
    },
    {
      path: '/reasoning',
      component: () => import('@/views/ReasoningView.vue'),
      meta: {
        demo: {
          title: 'Reasoning & activity',
          description:
            'Watch the agent think and track its progress while the run is still going.',
          group: 'Composables',
          icon: Brain,
          apis: ['useReasoning', 'useActivities'],
          endpoint: '/api/reasoning',
          sources: [
            'views/ReasoningView.vue',
            'components/AppReasoningPanel.vue',
            'backend/routers/reasoning.py',
            CHAT_PANEL,
          ],
        },
      },
    },
    {
      path: '/project-canvas',
      component: () => import('@/views/ProjectCanvasView.vue'),
      meta: {
        demo: {
          title: 'Project canvas',
          description:
            'Plan a project with an agent that proposes every change for you to apply or reject.',
          group: 'Showcase',
          icon: LayoutDashboard,
          apis: ['useAgentState', 'useFrontendTool'],
          endpoint: '/api/project-canvas',
          sources: [
            'views/ProjectCanvasView.vue',
            'components/ProjectCanvasBoard.vue',
            'backend/routers/project_canvas.py',
            CHAT_PANEL,
          ],
        },
      },
    },
  ],
})

export const demoRoutes = router
  .getRoutes()
  .filter((route) => route.meta.demo)
  .map((route) => ({ path: route.path, ...route.meta.demo! }))
