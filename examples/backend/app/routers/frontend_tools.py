"""Frontend tools demo.

The frontend advertises `setDarkMode` (automatic) and `confirmAction`
(human-in-the-loop) via `RunAgentInput.tools`; this agent only owns the
backend timezone tools. Only reference frontend tools in a prompt when the
frontend actually registers them — a prompt that commands tools missing from
the schema makes the model spray spurious tool calls.
"""

from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent, RunContext
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings
from app.timezone import TimezoneDeps, TimezoneState, get_current_time, set_preferred_timezone, state_preamble

router = APIRouter()


def instructions(ctx: RunContext[TimezoneDeps]) -> str:
    return state_preamble(ctx) + (
        "You also have two frontend tools:\n"
        "- setDarkMode: Toggles the UI theme.\n"
        "- confirmAction: Requests user approval via a UI prompt. "
        "Call this DIRECTLY — never ask in chat first, the tool itself handles the approval flow.\n\n"
        "When the time is nighttime, call confirmAction to propose switching to dark mode. "
        "If confirmAction is approved, call setDarkMode directly - if declined don't. "
        "If daytime and dark mode would be on, propose switching to light mode.\n\n"
        "Be concise and friendly."
    )


agent = Agent(
    settings.openai_model,
    deps_type=TimezoneDeps,
    instructions=instructions,
    tools=[get_current_time, set_preferred_timezone],
)


@router.post("/frontend-tools")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent, deps=TimezoneDeps(state=TimezoneState()))
