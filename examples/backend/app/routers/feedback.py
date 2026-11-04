"""Run identity and message feedback demo.

The frontend mints a `run_id` per run and reports which run produced each
message (`useAgent().runForMessage`). This backend keeps a trace per run id —
the settings it ran with and the tokens it used — and stores feedback keyed
by `{thread_id, run_id, message_id}`, so a rating joins back to the exact
trace that produced the rated message.

It also reads `forwardedProps`, AG-UI's escape hatch for backend-specific
run parameters, to pick the tone and temperature of each run.

Traces and feedback live in memory: they reset when the server restarts.
"""

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.agent import AgentRunResult
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

TONES = {
    "concise": "Answer in one or two short sentences.",
    "friendly": "Answer warmly and conversationally.",
    "pirate": "Answer like a pirate, but keep the facts right.",
}
TEMPERATURES = {"precise": 0.0, "balanced": 0.7, "creative": 1.2}

Rating = Literal["up", "down"]


class Feedback(BaseModel):
    thread_id: str = Field(alias="threadId")
    run_id: str = Field(alias="runId")
    message_id: str = Field(alias="messageId")
    rating: Rating | None


class Trace(BaseModel):
    run_id: str
    thread_id: str
    started_at: datetime
    tone: str
    temperature: float
    input_tokens: int = 0
    output_tokens: int = 0
    ratings: dict[str, Rating] = {}
    """message id → rating, for messages this run produced."""


traces: dict[str, Trace] = {}

agent = Agent(
    settings.openai_model,
    instructions=(
        "You are a helpful assistant that can check the current time in any timezone "
        "with the get_current_time tool."
    ),
)


@agent.tool_plain
def get_current_time(timezone: str) -> str:
    """Get the current time in a timezone.

    Args:
        timezone: IANA timezone name (e.g. 'Asia/Tokyo', 'America/New_York').
    """
    try:
        return datetime.now(ZoneInfo(timezone)).strftime("%A %H:%M %Z")
    except Exception:
        return f"Error: unknown timezone '{timezone}'. Use an IANA name like 'Asia/Tokyo'."


@router.post("/feedback-chat")
async def run(request: Request) -> Response:
    adapter = await AGUIAdapter.from_request(request, agent=agent)
    run_input = adapter.run_input
    props = run_input.forwarded_props or {}
    tone = props.get("tone") if props.get("tone") in TONES else "concise"
    creativity = props.get("creativity") if props.get("creativity") in TEMPERATURES else "balanced"

    # The client's run id is the trace key. An onError retry re-sends the same
    # id, so it identifies one logical run, not one HTTP request.
    trace = traces.setdefault(
        run_input.run_id,
        Trace(
            run_id=run_input.run_id,
            thread_id=run_input.thread_id,
            started_at=datetime.now(),
            tone=tone,
            temperature=TEMPERATURES[creativity],
        ),
    )

    def record_usage(result: AgentRunResult) -> None:
        usage = result.usage
        trace.input_tokens += usage.input_tokens
        trace.output_tokens += usage.output_tokens

    return adapter.streaming_response(
        adapter.run_stream(
            instructions=TONES[tone],
            model_settings={"temperature": trace.temperature},
            on_complete=record_usage,
        )
    )


@router.post("/feedback")
def submit_feedback(feedback: Feedback) -> Trace:
    trace = traces.get(feedback.run_id)
    if trace is None:
        trace = traces[feedback.run_id] = Trace(
            run_id=feedback.run_id,
            thread_id=feedback.thread_id,
            started_at=datetime.now(),
            tone="unknown",
            temperature=0,
        )
    if feedback.rating is None:
        trace.ratings.pop(feedback.message_id, None)
    else:
        trace.ratings[feedback.message_id] = feedback.rating
    return trace


@router.get("/feedback/traces")
def list_traces(thread_id: str) -> list[Trace]:
    return sorted(
        (t for t in traces.values() if t.thread_id == thread_id),
        key=lambda t: t.started_at,
        reverse=True,
    )
