"""Goal routes for Grip."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from grip.routes.todos import _normalize_date, _require_user
from grip.supabase_service import GOAL_STATUSES, supabase_service

router = APIRouter()
logger = logging.getLogger("grip.goals")


class GoalCreate(BaseModel):
    """Payload for creating a goal."""

    area_id: int
    name: str = Field(..., min_length=1, max_length=280)
    description: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class GoalUpdate(BaseModel):
    """Payload for updating a goal."""

    area_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=280)
    description: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class GoalStatusUpdate(BaseModel):
    """Payload for updating a goal's status."""

    status: str = Field(..., pattern="^(active|completed|archived)$")


def _normalize_description(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _require_area(user_id: str, area_id: int) -> None:
    """Ensure the area exists and belongs to the user."""
    area = supabase_service.get_area(user_id, area_id)
    if not area:
        raise HTTPException(status_code=400, detail=f"Area {area_id} not found")


@router.get("/api/goals")
async def list_goals(
    request: Request,
    area_id: int | None = Query(default=None),
) -> Dict[str, Any]:
    """Return goals for the current user, optionally filtered by area_id."""
    user = _require_user(request)
    goals = supabase_service.list_goals(user["id"], area_id=area_id)
    return {"goals": goals}


@router.post("/api/goals")
async def create_goal(request: Request, payload: GoalCreate) -> Dict[str, Any]:
    """Create a goal under an area."""
    user = _require_user(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    _require_area(user["id"], payload.area_id)
    start_date = _normalize_date(payload.start_date, "Start date")
    end_date = _normalize_date(payload.end_date, "End date")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400, detail="Start date must be on or before end date"
        )
    description = _normalize_description(payload.description)
    goal = supabase_service.create_goal(
        user["id"],
        payload.area_id,
        name,
        description=description,
        start_date=start_date,
        end_date=end_date,
    )
    if not goal:
        logger.error("create_goal failed for user_id=%s", user["id"])
        raise HTTPException(status_code=500, detail="Unable to create goal")
    return {"goal": goal}


@router.get("/api/goals/{goal_id}")
async def get_goal(request: Request, goal_id: int) -> Dict[str, Any]:
    """Return a single goal."""
    user = _require_user(request)
    goal = supabase_service.get_goal(user["id"], goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"goal": goal}


@router.patch("/api/goals/{goal_id}")
async def update_goal(
    request: Request, goal_id: int, payload: GoalUpdate
) -> Dict[str, Any]:
    """Update a goal's mutable fields."""
    user = _require_user(request)
    existing = supabase_service.get_goal(user["id"], goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")

    updates: Dict[str, Any] = {}
    if payload.area_id is not None:
        _require_area(user["id"], payload.area_id)
        updates["area_id"] = payload.area_id
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        updates["name"] = name
    if "description" in payload.model_fields_set:
        updates["description"] = _normalize_description(payload.description)
    if "start_date" in payload.model_fields_set:
        updates["start_date"] = _normalize_date(payload.start_date, "Start date")
    if "end_date" in payload.model_fields_set:
        updates["end_date"] = _normalize_date(payload.end_date, "End date")

    start_date = updates.get("start_date", existing.get("start_date"))
    end_date = updates.get("end_date", existing.get("end_date"))
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400, detail="Start date must be on or before end date"
        )

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    updated = supabase_service.update_goal(user["id"], goal_id, updates)
    if not updated:
        logger.error(
            "update_goal failed for user_id=%s goal_id=%s", user["id"], goal_id
        )
        raise HTTPException(status_code=500, detail="Unable to update goal")
    return {"goal": updated}


@router.patch("/api/goals/{goal_id}/status")
async def update_goal_status(
    request: Request, goal_id: int, payload: GoalStatusUpdate
) -> Dict[str, Any]:
    """Update a goal's status (active/completed/archived)."""
    user = _require_user(request)
    if payload.status not in GOAL_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    existing = supabase_service.get_goal(user["id"], goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    updated = supabase_service.update_goal(
        user["id"], goal_id, {"status": payload.status}
    )
    if not updated:
        logger.error(
            "update_goal_status failed for user_id=%s goal_id=%s",
            user["id"],
            goal_id,
        )
        raise HTTPException(status_code=500, detail="Unable to update goal status")
    return {"goal": updated}


@router.delete("/api/goals/{goal_id}")
async def delete_goal(request: Request, goal_id: int) -> Dict[str, Any]:
    """Hard-delete a goal. The DB RESTRICTs if projects still reference it."""
    user = _require_user(request)
    existing = supabase_service.get_goal(user["id"], goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    deleted = supabase_service.delete_goal(user["id"], goal_id)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail="Goal still has projects — archive or reparent them first",
        )
    return {"status": "deleted"}
