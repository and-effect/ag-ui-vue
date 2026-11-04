"""Generative UI demo.

The agent fetches real data with a backend tool, then calls `show_clock` and
`show_day_night` — frontend tools that `useGenerativeUI` renders as Vue
components. Do not register the render tools here as well; they are
advertised by the frontend and a duplicate name is a conflict.
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
        "You are a helpful assistant that shows the current time in any location.\n\n"
        "When the user asks about time or day/night status:\n"
        "1. Call get_current_time for each requested location to get real data.\n"
        "2. Call show_clock (frontend tool) with the exact time to render a clock card.\n"
        "3. Call show_day_night (frontend tool) to render a day/night indicator.\n\n"
        "Always call both render tools for each location. "
        "show_clock and show_day_night are executed by the frontend — they render Vue "
        "components; you do not need to describe their output in text. "
        "After rendering, give a brief one-sentence summary. Be concise."
    ),
)


@agent.tool_plain
def get_current_time(timezone: str) -> str:
    """Fetch the real current time for a timezone before rendering.

    Args:
        timezone: IANA timezone name (e.g. 'Asia/Tokyo', 'America/New_York').
    """
    try:
        now = datetime.now(ZoneInfo(timezone))
    except Exception:
        return f"Error: unknown timezone '{timezone}'"
    is_night = now.hour >= 18 or now.hour < 6
    return f"timezone={timezone}, time={now.strftime('%H:%M')}, hour={now.hour}, is_night={str(is_night).lower()}"


@router.post("/generative-ui")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
