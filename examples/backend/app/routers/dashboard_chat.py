"""Dashboard chat demo.

A chat next to a small Gapminder dashboard. It combines three things:

- Page context: the frontend sends the dashboard filters and a description
  of each fixed chart as `RunAgentInput.context`, re-read on every request.
  It carries no rows; for numbers the agent calls `query_data`.
- A backend tool: `query_data`, a structured query over the dataset (no free SQL).
- Frontend tools: `set_filters` (changes the dashboard) and `render_chart`
  (a generative-UI card in the dashboard). Both are advertised by the frontend
  in `RunAgentInput.tools`; declaring them here too would be a name conflict.

The dataset is `examples/data/gapminder.json`, the same file the playground
imports for the fixed charts, so the agent's numbers match what is drawn.
"""

import json
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Literal

from ag_ui.core import Context
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.messages import ModelMessage, ModelRequest, UserPromptPart
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.settings import settings

router = APIRouter()

DATA_PATH = Path(__file__).resolve().parents[3] / "data" / "gapminder.json"
ROWS: list[dict[str, str | int | float]] = json.loads(DATA_PATH.read_text())
COUNTRIES = {str(row["country"]).casefold(): str(row["country"]) for row in ROWS}

MAX_ROWS = 200
MAX_COLUMNS = 12

Metric = Literal["life_expectancy", "gdp_per_capita", "population"]
GroupField = Literal["continent", "country", "year"]
Aggregation = Literal["mean", "sum", "min", "max"]
Continent = Literal["Africa", "Americas", "Asia", "Europe", "Oceania"]

AGGREGATE = {"mean": mean, "sum": sum, "min": min, "max": max}
DECIMALS = {"life_expectancy": 1, "gdp_per_capita": 0, "population": 0}


class DataFilters(BaseModel):
    """Which rows to include. Omitted fields do not filter."""

    continents: list[Continent] | None = None
    countries: list[str] | None = Field(default=None, description="Country names, e.g. 'Germany'")
    year_from: int | None = Field(default=None, description="First year, inclusive (1952–2007)")
    year_to: int | None = Field(default=None, description="Last year, inclusive (1952–2007)")


CONTEXT_HEADER = "[Page context: the dashboard as the user sees it right now]"


def attach_context(
    ctx: RunContext[list[Context]], messages: list[ModelMessage]
) -> list[ModelMessage]:
    """Attach the current page context to the latest request, replacing any earlier copy.

    PydanticAI's `AGUIAdapter` does not read `context`, so it arrives as deps.
    It goes on the latest message rather than in the instructions, so the
    current filters win over a `set_filters` call earlier in the history.
    """
    for message in messages:
        if isinstance(message, ModelRequest):
            message.parts = [part for part in message.parts if not is_context_part(part)]
    if ctx.deps and isinstance(messages[-1], ModelRequest):
        entries = "\n\n".join(f"{entry.description}:\n{entry.value}" for entry in ctx.deps)
        messages[-1].parts = [
            *messages[-1].parts,
            UserPromptPart(f"{CONTEXT_HEADER}\n\n{entries}"),
        ]
    return messages


def is_context_part(part: object) -> bool:
    return (
        isinstance(part, UserPromptPart)
        and isinstance(part.content, str)
        and part.content.startswith(CONTEXT_HEADER)
    )


agent = Agent(
    settings.openai_model,
    deps_type=list[Context],
    capabilities=[ProcessHistory(attach_context)],
    instructions=(
        "You assist a user looking at a dashboard of the Gapminder dataset: 142 countries "
        "on 5 continents (Africa, Americas, Asia, Europe, Oceania), every 5 years from 1952 "
        "to 2007, with life expectancy (years), GDP per capita (inflation-adjusted US$) and "
        "population. The page context on the latest message lists the current filters and "
        "the fixed charts; it is always current.\n\n"
        "Rules:\n"
        "- Apply the current filters (continents, year range) to every query unless the "
        "user asks otherwise, e.g. names countries outside them.\n"
        "- For any number, call query_data. Only state numbers that a tool returned; "
        "never estimate or invent values.\n"
        "- To change what the dashboard shows, call set_filters.\n"
        "- To add a chart, call query_data first, then render_chart. Put the returned rows "
        "into option.dataset.source unchanged and map columns with series[].encode. For "
        "one line per country or continent, query with two group_by fields and pivot=true. "
        "The option must be plain JSON: no functions or formatters, no colours.\n"
        "- The chart appears in the dashboard, not in the chat; do not repeat its data.\n"
        "- End with a one-sentence summary. Be concise."
    ),
)


@agent.tool_plain
def query_data(
    metric: Metric,
    group_by: list[GroupField],
    filters: DataFilters | None = None,
    aggregation: Aggregation = "mean",
    pivot: bool = False,
    sort: Literal["asc", "desc"] | None = None,
    limit: int = MAX_ROWS,
) -> dict[str, object]:
    """Aggregate the Gapminder dataset. Returns rows ready for an ECharts dataset.

    Args:
        metric: The value to aggregate.
        group_by: One or two fields, e.g. ["continent"] or ["year", "country"].
        filters: Rows to include. Pass the dashboard's current filters unless the user asks otherwise.
        aggregation: How values in a group combine. "mean" is the average across countries
            (as the dashboard draws it); use "sum" for total population.
        pivot: With two group_by fields, one row per value of the first field and one column
            per value of the second, e.g. year rows with a column per country. Use it for
            multi-series line or bar charts.
        sort: Order rows by the metric value instead of by the group fields.
        limit: Maximum number of rows (at most 200).
    """
    if not 1 <= len(group_by) <= 2 or len(set(group_by)) != len(group_by):
        raise ModelRetry("group_by needs one or two different fields.")
    if pivot and len(group_by) != 2:
        raise ModelRetry("pivot needs exactly two group_by fields.")
    filters = filters or DataFilters()

    countries = None
    unknown_countries = []
    if filters.countries:
        countries = {
            COUNTRIES[name.casefold()] for name in filters.countries if name.casefold() in COUNTRIES
        }
        unknown_countries = [name for name in filters.countries if name.casefold() not in COUNTRIES]

    groups: dict[tuple[str | int | float, ...], list[float]] = defaultdict(list)
    for row in ROWS:
        if filters.continents and row["continent"] not in filters.continents:
            continue
        if countries is not None and row["country"] not in countries:
            continue
        if filters.year_from is not None and int(row["year"]) < filters.year_from:
            continue
        if filters.year_to is not None and int(row["year"]) > filters.year_to:
            continue
        groups[tuple(row[field] for field in group_by)].append(float(row[metric]))

    values = {
        key: round_value(metric, AGGREGATE[aggregation](group)) for key, group in groups.items()
    }
    if pivot:
        rows, columns, truncated = pivot_rows(values, group_by[0])
    else:
        keys = (
            sorted(values, key=lambda key: values[key], reverse=sort == "desc")
            if sort
            else sorted(values)
        )
        rows = [{**dict(zip(group_by, key, strict=True)), metric: values[key]} for key in keys]
        columns, truncated = [*group_by, metric], False

    limit = max(1, min(limit, MAX_ROWS))
    result: dict[str, object] = {
        "metric": metric,
        "aggregation": aggregation,
        "group_by": group_by,
        "filters": filters.model_dump(exclude_none=True),
        "columns": columns,
        "rows": rows[:limit],
        "truncated": truncated or len(rows) > limit,
    }
    if unknown_countries:
        result["unknown_countries"] = unknown_countries
    if not rows:
        result["note"] = "No rows match these filters."
    return result


def round_value(metric: Metric, value: float) -> float:
    """Life expectancy to one decimal; money and people to whole numbers."""
    return round(value, DECIMALS[metric]) if DECIMALS[metric] else round(value)


def pivot_rows(
    values: dict[tuple[str | int | float, ...], float], index: str
) -> tuple[list[dict[str, str | int | float | None]], list[str], bool]:
    """Pivot two-field keys into one row per first value and one column per second value."""
    series = sorted({key[1] for key in values})
    truncated = len(series) > MAX_COLUMNS
    series = series[:MAX_COLUMNS]
    rows = [
        {index: first, **{str(name): values.get((first, name)) for name in series}}
        for first in sorted({key[0] for key in values})
    ]
    return rows, [index, *(str(name) for name in series)], truncated


@router.post("/dashboard-chat")
async def run(request: Request) -> Response:
    adapter = await AGUIAdapter.from_request(request, agent=agent)
    return adapter.streaming_response(adapter.run_stream(deps=adapter.run_input.context))
