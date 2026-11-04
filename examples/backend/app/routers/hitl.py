"""Human-in-the-loop demo.

When a request is ambiguous ("time in Asia"), the agent calls the `choice`
frontend tool. The frontend renders the options, the user's pick comes back
as the tool result, and the agent continues with it.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

agent = Agent(
    settings.openai_model,
    instructions=(
        "You are a helpful assistant that checks the current time in any timezone.\n\n"
        "When the user's request is ambiguous or mentions a region rather than a specific "
        "city, use the `choice` frontend tool to ask them to pick a specific option. "
        "For example:\n"
        "- 'Asia' → offer choices like 'Tokyo (Asia/Tokyo)', 'Beijing (Asia/Shanghai)', "
        "'Singapore (Asia/Singapore)', 'Manila (Asia/Manila)'\n"
        "- 'America' → offer 'New York (America/New_York)', 'Chicago (America/Chicago)', "
        "'Los Angeles (America/Los_Angeles)', 'São Paulo (America/Sao_Paulo)'\n\n"
        "After the user selects an option, extract the IANA timezone from their choice and "
        "call get_current_time to fetch the real time, then give a brief, friendly reply. "
        "If the user asks for multiple cities directly (no ambiguity), skip the choice tool "
        "and call get_current_time for each city right away. "
        "Be concise."
    ),
)


@agent.tool_plain
def get_current_time(timezone: str) -> str:
    """Get the current time in a timezone.

    Args:
        timezone: IANA timezone name (e.g. 'Asia/Tokyo', 'America/New_York').
    """
    try:
        return datetime.now(ZoneInfo(timezone)).strftime("%A, %B %d, %Y at %I:%M:%S %p %Z")
    except Exception:
        return f"Error: unknown timezone '{timezone}'. Use an IANA name like 'Asia/Tokyo'."


@router.post("/hitl")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
