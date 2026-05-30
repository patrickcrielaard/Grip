"""Day-plan event routes for Grip.

Each time the user drags a task or template onto the schedule the frontend
posts a row here so we can track how often the day gets planned.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from grip.routes.todos import _require_user
from grip.supabase_service import supabase_service

router = APIRouter()
logger = logging.getLogger("grip.day_plan_events")

ALLOWED_SOURCE_KINDS = {"task", "template"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")


class DayPlanEventCreate(BaseModel):
    """Payload for logging a scheduled block."""

    source_kind: str = Field(..., min_length=1, max_length=16)
    source_id: str = Field(..., min_length=1, max_length=120)
    title: str = Field(..., min_length=1, max_length=280)
    block_type: str = Field(..., min_length=1, max_length=32)
    planned_for: str = Field(..., min_length=10, max_length=10)
    start_time: str = Field(..., min_length=4, max_length=8)
    duration_minutes: int = Field(..., gt=0, le=24 * 60)


@router.post("/api/day-plan-events")
async def create_day_plan_event(
    request: Request, payload: DayPlanEventCreate
) -> Dict[str, Any]:
    """Insert a single planning event for the current user."""
    user = _require_user(request)

    if payload.source_kind not in ALLOWED_SOURCE_KINDS:
        raise HTTPException(status_code=400, detail="Invalid source kind")
    if not _DATE_RE.match(payload.planned_for):
        raise HTTPException(status_code=400, detail="planned_for must be YYYY-MM-DD")
    if not _TIME_RE.match(payload.start_time):
        raise HTTPException(status_code=400, detail="start_time must be HH:MM")

    row = supabase_service.create_day_plan_event(
        user["id"],
        source_kind=payload.source_kind,
        source_id=payload.source_id.strip(),
        title=payload.title.strip(),
        block_type=payload.block_type.strip(),
        planned_for=payload.planned_for,
        start_time=payload.start_time,
        duration_minutes=payload.duration_minutes,
    )
    if not row:
        raise HTTPException(status_code=500, detail="Unable to record event")
    return {"event": row}


@router.get("/api/day-plan-events/summary")
async def day_plan_event_summary(
    request: Request,
    from_: str = Query(..., alias="from", min_length=10, max_length=10),
    to: str = Query(..., min_length=10, max_length=10),
) -> Dict[str, Any]:
    """Return a per-day summary for the requested range.

    The frontend uses this to compute "planning consistency": the share of
    days in the range that have at least one planning event.
    """
    user = _require_user(request)
    if not _DATE_RE.match(from_) or not _DATE_RE.match(to):
        raise HTTPException(status_code=400, detail="from/to must be YYYY-MM-DD")
    if to < from_:
        raise HTTPException(status_code=400, detail="`to` must be on or after `from`")
    rows = supabase_service.list_day_plan_event_summary(user["id"], from_, to)
    return {"rows": rows}
