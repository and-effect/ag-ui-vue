"""Timezone tools and shared state, used by the frontend-tools, shared-state
and threads demos.

`TimezoneState` is synced bidirectionally with the Vue frontend:
- agent → frontend: `timezone_history` grows via a STATE_SNAPSHOT emitted
  from `get_current_time`
- frontend → agent: `preferred_timezone` arrives in `RunAgentInput.state` on
  every run (the frontend's `useAgentState`), hydrated by `StateDeps`
"""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from ag_ui.core import EventType, StateSnapshotEvent
from pydantic import BaseModel
from pydantic_ai import RunContext
from pydantic_ai.messages import ToolReturn
from pydantic_ai.ui import StateDeps

INVALID_TIMEZONE = (
    "Error: Invalid timezone '{timezone}'. "
    "Please use IANA timezone names like 'America/New_York', 'Europe/London', or 'UTC'."
)


class TimezoneState(BaseModel):
    timezone_history: list[str] = []
    preferred_timezone: str | None = None


@dataclass
class TimezoneDeps(StateDeps[TimezoneState]):
    pass


def state_preamble(ctx: RunContext[TimezoneDeps]) -> str:
    """Inject the current shared state into the system prompt.

    The LLM only sees messages and the system prompt, so frontend-set values
    like `preferred_timezone` must be spelled out here for the agent to use
    them without an extra tool call.
    """
    state = ctx.deps.state
    preferred = state.preferred_timezone or "not set"
    history = ", ".join(state.timezone_history) or "none"
    return (
        "You are a helpful assistant that can check the current time in any timezone "
        "using the get_current_time tool.\n\n"
        "Current shared state (updated each turn from the frontend):\n"
        f"- preferred_timezone: {preferred}\n"
        f"- timezone_history: {history}\n\n"
        "Use preferred_timezone as the default when the user asks for 'the time' without "
        "specifying a timezone. If the user asks to set, change, or remember their "
        "preferred timezone, call set_preferred_timezone.\n\n"
    )


def _snapshot(ctx: RunContext[TimezoneDeps]) -> StateSnapshotEvent:
    return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state.model_dump())


def get_current_time(ctx: RunContext[TimezoneDeps], timezone: str) -> ToolReturn:
    """Get the current time in a timezone.

    Args:
        timezone: IANA timezone name (e.g. 'America/New_York', 'Europe/London', 'UTC').
    """
    try:
        now = datetime.now(ZoneInfo(timezone))
    except Exception:
        return ToolReturn(return_value=INVALID_TIMEZONE.format(timezone=timezone))

    time_of_day = "nighttime" if now.hour >= 18 or now.hour < 6 else "daytime"
    result = f"{now.strftime('%A, %B %d, %Y at %I:%M:%S %p %Z')} ({time_of_day}, hour: {now.hour})"

    if timezone not in ctx.deps.state.timezone_history:
        ctx.deps.state.timezone_history.append(timezone)

    # Emitted as metadata so the frontend updates right after this tool call,
    # before the agent writes its reply.
    return ToolReturn(return_value=result, metadata=_snapshot(ctx))


def set_preferred_timezone(ctx: RunContext[TimezoneDeps], timezone: str) -> ToolReturn:
    """Set the user's preferred (home) timezone in shared state.

    Args:
        timezone: IANA timezone name (e.g. 'America/New_York', 'Asia/Tokyo', 'UTC').
    """
    try:
        ZoneInfo(timezone)
    except Exception:
        return ToolReturn(return_value=INVALID_TIMEZONE.format(timezone=timezone))

    ctx.deps.state.preferred_timezone = timezone
    return ToolReturn(return_value=f"Preferred timezone set to {timezone}.", metadata=_snapshot(ctx))
