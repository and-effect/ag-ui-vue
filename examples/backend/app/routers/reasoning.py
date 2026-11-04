"""Reasoning & activity demo.

Reasoning: the agent runs with thinking enabled, and PydanticAI's AG-UI adapter
turns the model's thinking into REASONING_* events. That needs a model that
reasons and returns its reasoning. With OpenAI that is a reasoning model on the
Responses API (e.g. `openai-responses:gpt-5-mini`): the Chat Completions API
never returns reasoning text. On a model that cannot think, `thinking` is
ignored and the demo simply shows no reasoning.

Activities: `check_timezones` reports its progress as ACTIVITY_SNAPSHOT /
ACTIVITY_DELTA events while it runs. A tool cannot yield AG-UI events itself,
but it can `ctx.emit()` a `CustomEvent`, and the adapter forwards one whose
payload is an AG-UI event verbatim.
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from ag_ui.core import ActivityDeltaEvent, ActivitySnapshotEvent
from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent, CustomEvent, RunContext
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

ACTIVITY_TYPE = "timezone-lookup"

agent = Agent(
    settings.openai_model,
    instructions=(
        "You help people coordinate across timezones. When a question involves several "
        "places, call check_timezones once with the IANA names of all of them, then answer "
        "from its result: the local time in each place and, if they asked for a meeting, "
        "a window that falls within working hours (9:00-17:00) everywhere, or the "
        "least-bad option if there is none. Be concise."
    ),
    # Ask for reasoning. `thinking` is the provider-neutral switch; OpenAI only
    # returns reasoning text when a summary is requested as well.
    model_settings={"thinking": "low", "openai_reasoning_summary": "detailed"},
)


@dataclass(kw_only=True)
class AGUIActivity(CustomEvent):
    """Carries an AG-UI activity event out of a tool, via `ctx.emit()`."""

    event: ActivitySnapshotEvent | ActivityDeltaEvent

    def to_payload(self) -> Any:
        # An AG-UI event as the payload is forwarded as-is, not wrapped in CUSTOM.
        return self.event


@agent.tool
async def check_timezones(ctx: RunContext[None], timezones: list[str]) -> list[dict[str, str]]:
    """Look up the current local time in several timezones.

    Args:
        timezones: IANA timezone names, e.g. ['Europe/Berlin', 'America/New_York'].
    """
    activity_id = str(uuid.uuid4())
    await ctx.emit(
        AGUIActivity(
            event=ActivitySnapshotEvent(
                message_id=activity_id,
                activity_type=ACTIVITY_TYPE,
                content={"checked": 0, "total": len(timezones), "current": timezones[0] if timezones else None, "results": []},
            )
        )
    )

    results: list[dict[str, str]] = []
    for i, name in enumerate(timezones):
        # A local lookup is instant; the pause stands in for a real lookup
        # (a calendar or directory API) so the progress row is visible.
        await asyncio.sleep(0.6)
        try:
            now = datetime.now(ZoneInfo(name))
            result = {"timezone": name, "time": now.strftime("%H:%M"), "day": now.strftime("%A")}
        except Exception:
            result = {"timezone": name, "time": "unknown", "day": ""}
        results.append(result)

        await ctx.emit(
            AGUIActivity(
                event=ActivityDeltaEvent(
                    message_id=activity_id,
                    activity_type=ACTIVITY_TYPE,
                    patch=[
                        {"op": "replace", "path": "/checked", "value": i + 1},
                        {"op": "replace", "path": "/current", "value": timezones[i + 1] if i + 1 < len(timezones) else None},
                        {"op": "add", "path": "/results/-", "value": result},
                    ],
                )
            )
        )

    return results


@router.post("/reasoning")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
