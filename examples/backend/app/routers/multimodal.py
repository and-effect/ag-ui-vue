"""Multimodal demo.

The frontend sends `ContentPart[]` (text, images, documents) through
`useAgent().send()`; `AGUIAdapter` converts the parts to the model's native
multimodal format.
"""

from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

agent = Agent(
    settings.openai_model,
    instructions=(
        "You are a helpful assistant that can analyze images and documents. "
        "When the user attaches an image, describe what you see and answer their questions. "
        "When the user attaches a document or file, summarize its contents and help them understand it. "
        "If no file is attached, just answer the user's question. "
        "Be concise and direct."
    ),
)


@router.post("/multimodal")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
