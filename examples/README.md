# Examples

One Vue app — the **playground** — with a page per feature, backed by one PydanticAI server.

```
examples/
  playground/   Vite + Vue 3 + vue-router, styled with Tailwind v4 + shadcn-vue
  backend/      FastAPI app, one AG-UI endpoint per demo
```

| Demo | Shows | View | Backend |
| --- | --- | --- | --- |
| Tool calls | the basics: `useAgent` + a tool that runs on the server, shown from `messages` | `BackendToolsView.vue` | `backend_tools.py` |
| Frontend tools | `useFrontendTool` (automatic + approval), `useToolCalls`, `AgToolCallStatus` | `FrontendToolsView.vue` | `frontend_tools.py` |
| Human in the loop | `useFrontendTool` without a handler | `HumanInTheLoopView.vue` | `hitl.py` |
| Shared state | `useAgentState` in both directions | `SharedStateView.vue` | `shared_state.py` |
| Threads | `useThreads`, `AgThreadList`, `LocalStorageAdapter` | `ThreadsView.vue` | `shared_state.py` |
| Generative UI | `useGenerativeUI`, components rendered inline in the chat | `GenerativeUiView.vue` | `generative_ui.py` |
| Multimodal | images and documents sent as `ContentPart[]` | `MultimodalView.vue` | `multimodal.py` |
| Reasoning & activity | `useReasoning` (thinking panel), `useActivities` (progress row from a tool's activity events). Reasoning needs a model that reasons, e.g. `openai-responses:gpt-5-mini` | `ReasoningView.vue` | `reasoning.py` |
| Page context | `useAgent({ context })` — the case file the user has open, re-sent on every request incl. tool follow-ups | `PageContextView.vue` | `page_context.py` |
| Run identity | `runForMessage`, `messageRuns`, `forwardedProps` — per-message feedback joined to server traces | `RunFeedbackView.vue` | `feedback.py` |
| Project canvas | shared state + five approval tools in one app | `ProjectCanvasView.vue` | `project_canvas.py` |

## Running

The first time:

```bash
npm install                                # from the repo root — also installs the playground (npm workspace)
cp examples/backend/.env.example examples/backend/.env   # then add your OPENAI_API_KEY
```

Then run the backend and the playground in separate terminals:

```bash
npm run dev:backend      # http://localhost:8000 — uv installs Python deps on first run
npm run dev:playground   # http://localhost:5173
```

The playground proxies `/api` to the backend, so demos call relative URLs (`useAgent({ url: '/api/hitl' })`) and need no CORS setup.

To work on the UI without an API key or token cost, run the backend on pydantic-ai's [test model](https://ai.pydantic.dev/testing/). It calls every tool with placeholder arguments and returns canned text:

```bash
cd examples/backend && OPENAI_MODEL=test uv run uvicorn app.api:app --reload
```

## How the playground is put together

- **The library runs from source.** `@and-effect/ag-ui-vue` is a Vite/TS alias for `../../src/index.ts`, so library changes hot-reload in the playground without a build. Demos still import it by its published name.
- **Every page has Preview, Code and Events.** *Code* shows the demo's own files (view, components, backend router). *Events* shows the raw AG-UI event stream. To feed it, a demo calls the playground-only `inspect(agent)` helper, which is the one line in each view that you wouldn't write in your own app.
- **One shared chat panel.** `AppChatPanel` builds the conversation from the headless `AgMessageList`, and `AppComposer` builds the input from `AgMessageInput`. The demos therefore contain only the feature they demonstrate. Tool calls render as compact rows that show their own result, and approval cards go in the panel's default slot.
- **`components/ui/` is vendored shadcn-vue.** Add more with `npx shadcn-vue@latest add <name>` from `examples/playground`. Theme tokens (neutral palette, one success/warning accent, dark mode via a `.dark` class) live in `src/styles/main.css`.

To add a demo, create `views/<Name>View.vue` and a router in `backend/app/routers/`, include the router in `app/api.py`, then add a route with `meta.demo` in `src/router/index.ts`. The sidebar, overview card and Code tab all read from that route entry.
