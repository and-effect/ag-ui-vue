"""Interrupts demo — server-side human in the loop.

`book_meeting` and `cancel_meeting` are server tools declared with
`requires_approval=True`. When the model calls one, the run ends with
`RUN_FINISHED.outcome = interrupt` instead of executing it; the frontend
answers each interrupt and resumes with `RunAgentInput.resume`, which the
AG-UI adapter maps back to approvals — editedArgs included.
"""

from fastapi import APIRouter, Request, Response
from pydantic_ai import Agent, DeferredToolRequests
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

# Process-wide demo calendar. Not per-thread on purpose: simple enough to read.
meetings: dict[str, str] = {
    "Standup": "Monday 09:30",
    "Design review": "Wednesday 14:00",
}

agent = Agent(
    settings.openai_model,
    # Lets a run end on pending approvals instead of erroring. The AG-UI adapter
    # only adds this itself when the client advertises frontend tools.
    output_type=[str, DeferredToolRequests],
    instructions=(
        "You manage the user's team calendar. Use list_meetings to see what is "
        "booked. book_meeting and cancel_meeting need the user's approval, which "
        "is handled for you — just call them; if several changes are requested, "
        "call every tool in one go. If a call is denied, say so briefly and don't "
        "retry it. Be concise."
    ),
)


@agent.tool_plain
def list_meetings() -> dict[str, str]:
    """List the booked meetings, by title."""
    return meetings


@agent.tool_plain(requires_approval=True)
def book_meeting(title: str, when: str) -> str:
    """Book a meeting.

    Args:
        title: Meeting title.
        when: Day and time, e.g. 'Friday 15:00'.
    """
    meetings[title] = when
    return f"Booked {title} for {when}."


@agent.tool_plain(requires_approval=True)
def cancel_meeting(title: str) -> str:
    """Cancel a booked meeting.

    Args:
        title: Title of the meeting to cancel.
    """
    if meetings.pop(title, None) is None:
        return f"No meeting called {title!r}."
    return f"Cancelled {title}."


@router.post("/interrupts")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent)
