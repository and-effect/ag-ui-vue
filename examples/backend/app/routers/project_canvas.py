"""Project canvas showcase.

The frontend sends the whole canvas on every run (`useAgentState` →
`RunAgentInput.state`). The agent has no backend tools: every change is
proposed through a human-in-the-loop frontend tool that the user applies or
rejects in the UI.
"""

from dataclasses import dataclass

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.ui import StateDeps
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()


class UserStory(BaseModel):
    id: str
    title: str
    description: str


class ProjectCanvasState(BaseModel):
    description: str = ""
    features: list[str] = []
    user_stories: list[UserStory] = []


@dataclass
class Deps(StateDeps[ProjectCanvasState]):
    pass


def instructions(ctx: RunContext[Deps]) -> str:
    """Inject the current canvas into the system prompt on every run."""
    state = ctx.deps.state
    description = state.description.strip() or "(empty)"
    features = "\n".join(f"  - {f}" for f in state.features) or "  (none yet)"
    stories = "\n".join(f"  - {s.title}: {s.description}" for s in state.user_stories) or "  (none yet)"

    return (
        "You are a product planning assistant. Help the user define and refine their software project.\n\n"
        "The user may share images (screenshots, mockups, wireframes) or documents to help describe their idea. "
        "When they do, analyse the content and use it to inform your suggestions.\n\n"
        "CURRENT CANVAS STATE (sent from the frontend on every turn):\n"
        f"  Description: {description}\n\n"
        f"  Features:\n{features}\n\n"
        f"  User Stories:\n{stories}\n\n"
        "You have the following FRONTEND tools to propose canvas changes. "
        "Call them directly when you want to propose a change after giving a short reasoning (one or two sentences max) — "
        "the user will review and approve or reject each proposal in the UI.\n\n"
        "Available tools:\n"
        "  - update_description: Replace the project description\n"
        "  - add_feature: Add a feature to the features list\n"
        "  - remove_feature: Remove a feature from the features list\n"
        "  - add_user_story: Add a user story (title + description)\n"
        "  - remove_user_story: Remove a user story by title\n\n"
        "Guidelines:\n"
        "  - Guide the user through the process and suggest changes one by one - not all at once.\n"
        "  - Write user stories in the format: 'As a [role], I want [goal], so that [benefit].'\n"
        "  - Keep features and user stories concise (1 sentence each).\n"
        "  - When proposing multiple changes, call each tool in sequence — don't batch into one message.\n"
        "  - Be concise in your text replies; let the tool calls do the heavy lifting.\n"
        "  - If the user asks general planning questions without requesting a canvas change, "
        "just answer conversationally.\n"
    )


agent = Agent(settings.openai_model, deps_type=Deps, instructions=instructions)


@router.post("/project-canvas")
async def run(request: Request) -> Response:
    return await AGUIAdapter.dispatch_request(request, agent=agent, deps=Deps(state=ProjectCanvasState()))
