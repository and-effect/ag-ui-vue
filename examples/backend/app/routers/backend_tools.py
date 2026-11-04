"""Tool calls demo — the basics.

`get_current_time` runs here, on the server. The frontend registers no
tools; the call and its result reach it as part of the message history.
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
        "You are a helpful assistant that can check the current time in any timezone "
        "with the get_current_time tool. Be concise."
    ),
)


@agent.tool_plain
def get_current_time(timezone: str) -> str:
    """Get the current time in a timezone.

    Args:
        timezone: IANA timezone name (e.g. 'Asia/Tokyo', 'America/New_York').
    """
    try:
        return datetime.now(ZoneInfo(timezone)).strftime("%A, %B %d, %Y at %I:%M %p %Z")
    except Exception:
        return f"Error: unknown timezone '{timezone}'. Use an IANA name like 'Asia/Tokyo'."


@router.post("/backend-tools")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
