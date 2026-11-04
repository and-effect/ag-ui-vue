"""Shared state and threads demos.

Same timezone tools as the frontend-tools demo, but the prompt references no
frontend tools — these pages register none. `StateDeps` hydrates
`deps.state` from `RunAgentInput.state`, which the frontend's `useAgentState`
sends on every run, so the agent always sees the latest state.
"""

from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent, RunContext
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings
from app.timezone import TimezoneDeps, TimezoneState, get_current_time, set_preferred_timezone, state_preamble

router = APIRouter()


def instructions(ctx: RunContext[TimezoneDeps]) -> str:
    return state_preamble(ctx) + "Be concise and friendly."


agent = Agent(
    settings.openai_model,
    deps_type=TimezoneDeps,
    instructions=instructions,
    tools=[get_current_time, set_preferred_timezone],
)


@router.post("/shared-state")
@router.post("/threads")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent, deps=TimezoneDeps(state=TimezoneState()))
