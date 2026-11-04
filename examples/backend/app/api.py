"""FastAPI app serving one AG-UI endpoint per playground demo.

The playground's Vite dev server proxies `/api` here, so no CORS setup is
needed in development.
"""

from fastapi import FastAPI

from app.routers import (
    backend_tools,
    feedback,
    frontend_tools,
    generative_ui,
    hitl,
    interrupts,
    multimodal,
    page_context,
    project_canvas,
    reasoning,
    shared_state,
)
from app.settings import settings

app = FastAPI(title="ag-ui-vue playground")

for module in (backend_tools, frontend_tools, shared_state, generative_ui, multimodal, hitl, interrupts, feedback, page_context, reasoning, project_canvas):
    app.include_router(module.router, prefix="/api")


@app.get("/api")
def read_root() -> dict[str, str]:
    return {"model": settings.openai_model, "docs": "/docs"}
