"""Page context demo.

The frontend sends what the user is looking at as `RunAgentInput.context`
(`useAgent({ context: () => [...] })`), re-read on every request, including
the continuation after the `openApplication` frontend tool.

PydanticAI's `AGUIAdapter` does not read `context`, so this endpoint passes it
in as deps and a history processor attaches it to the latest message. Not to
the instructions: those sit at the top of the prompt, and a later message in
the history (an earlier `openApplication` result, say) then wins over them
once the caseworker has clicked elsewhere.
"""

from ag_ui.core import Context
from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.messages import ModelMessage, ModelRequest, UserPromptPart
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

CONTEXT_HEADER = "[Page context: what the caseworker sees right now]"


def attach_context(ctx: RunContext[list[Context]], messages: list[ModelMessage]) -> list[ModelMessage]:
    """Attach the current page context to the latest request, replacing any earlier copy.

    The processed history is kept for the rest of the run, so the copy added
    before a previous model request in this run is removed first.
    """
    for message in messages:
        if isinstance(message, ModelRequest):
            message.parts = [part for part in message.parts if not is_context_part(part)]
    if ctx.deps and isinstance(messages[-1], ModelRequest):
        entries = "\n\n".join(f"{entry.description}:\n{entry.value}" for entry in ctx.deps)
        messages[-1].parts = [*messages[-1].parts, UserPromptPart(f"{CONTEXT_HEADER}\n\n{entries}")]
    return messages


def is_context_part(part: object) -> bool:
    return isinstance(part, UserPromptPart) and isinstance(part.content, str) and part.content.startswith(CONTEXT_HEADER)


agent = Agent(
    settings.openai_model,
    deps_type=list[Context],
    capabilities=[ProcessHistory(attach_context)],
    instructions=(
        "You assist a caseworker in a building permit office. The caseworker is "
        "looking at a list of applications. The page context attached to the latest "
        "message says which are listed and which one is open; it is always current "
        "and wins over anything earlier in the conversation, because the caseworker "
        "may have switched since. 'This one', 'this case', 'it' and similar mean the "
        "open application. Call the openApplication tool only when the caseworker asks "
        "for an application other than the open one, by id or description (e.g. "
        "'the rejected one'). Be concise and factual; do not invent case details "
        "that are not in the context."
    ),
)


@router.post("/page-context")
async def run(request: Request) -> Response:
    adapter = await AGUIAdapter.from_request(request, agent=agent)
    return adapter.streaming_response(adapter.run_stream(deps=adapter.run_input.context))
