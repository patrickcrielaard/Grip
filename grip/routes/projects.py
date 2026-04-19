"""Project routes for Grip."""

from __future__ import annotations

from typing import Any, Dict
import logging

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from grip.routes.todos import _normalize_date, _require_user
from grip.supabase_service import supabase_service

router = APIRouter()
logger = logging.getLogger("grip.projects")


class ProjectCreate(BaseModel):
    """Payload for creating a project."""

    name: str = Field(..., min_length=1, max_length=280)
    start_date: str | None = None
    end_date: str | None = None
    area_id: int | None = None
    goal_id: int | None = None


class ProjectUpdate(BaseModel):
    """Payload for updating a project's mutable fields."""

    name: str | None = Field(default=None, min_length=1, max_length=280)
    start_date: str | None = None
    end_date: str | None = None
    area_id: int | None = None
    goal_id: int | None = None


class ProjectStatusUpdate(BaseModel):
    """Payload for updating project status."""

    status: str = Field(..., pattern="^(active|completed|deleted)$")


def _require_area(user_id: str, area_id: int) -> None:
    """Ensure the area exists and belongs to the user."""
    area = supabase_service.get_area(user_id, area_id)
    if not area:
        raise HTTPException(status_code=400, detail=f"Area {area_id} not found")


def _require_goal(user_id: str, goal_id: int) -> Dict[str, Any]:
    """Ensure the goal exists and belongs to the user. Returns the goal row."""
    goal = supabase_service.get_goal(user_id, goal_id)
    if not goal:
        raise HTTPException(status_code=400, detail=f"Goal {goal_id} not found")
    return goal


@router.get("/api/projects")
async def list_projects(
    request: Request,
    area_id: int | None = Query(default=None),
    goal_id: int | None = Query(default=None),
    unparented: bool = Query(default=False),
) -> Dict[str, Any]:
    """Return projects for the current user, optionally filtered."""
    user = _require_user(request)
    projects = supabase_service.list_projects(
        user["id"], area_id=area_id, goal_id=goal_id, unparented=unparented
    )
    return {"projects": projects}


@router.post("/api/projects")
async def create_project(request: Request, payload: ProjectCreate) -> Dict[str, Any]:
    """Create a project."""
    user = _require_user(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    start_date = _normalize_date(payload.start_date, "Start date")
    end_date = _normalize_date(payload.end_date, "End date")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400, detail="Start date must be on or before end date"
        )

    area_id = payload.area_id
    goal_id = payload.goal_id
    if goal_id is not None:
        goal = _require_goal(user["id"], goal_id)
        # The DB trigger syncs area_id from goal, but we pass it through so
        # the optimistic response matches the stored row.
        area_id = goal["area_id"]
    elif area_id is not None:
        _require_area(user["id"], area_id)

    project = supabase_service.create_project(
        user["id"],
        name,
        start_date=start_date,
        end_date=end_date,
        area_id=area_id,
        goal_id=goal_id,
    )
    if not project:
        logger.error("create_project failed for user_id=%s", user["id"])
        raise HTTPException(status_code=500, detail="Unable to create project")
    return {"project": project}


@router.get("/api/projects/{project_id}")
async def get_project(request: Request, project_id: int) -> Dict[str, Any]:
    """Return a single project."""
    user = _require_user(request)
    project = supabase_service.get_project(user["id"], project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": project}


@router.patch("/api/projects/{project_id}")
async def update_project(
    request: Request, project_id: int, payload: ProjectUpdate
) -> Dict[str, Any]:
    """Update a project's mutable fields."""
    user = _require_user(request)
    existing = supabase_service.get_project(user["id"], project_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")

    updates: Dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        updates["name"] = name
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

    setting_goal = "goal_id" in payload.model_fields_set
    setting_area = "area_id" in payload.model_fields_set

    if setting_goal and payload.goal_id is not None:
        goal = _require_goal(user["id"], payload.goal_id)
        updates["goal_id"] = payload.goal_id
        # DB trigger will sync area_id; set it explicitly too for response consistency.
        updates["area_id"] = goal["area_id"]
    elif setting_goal and payload.goal_id is None:
        updates["goal_id"] = None
        if not setting_area:
            # Keep existing area_id unless explicitly changed.
            pass

    if setting_area and not (setting_goal and payload.goal_id is not None):
        if payload.area_id is not None:
            _require_area(user["id"], payload.area_id)
        updates["area_id"] = payload.area_id

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    updated = supabase_service.update_project(user["id"], project_id, updates)
    if not updated:
        logger.error(
            "update_project failed for user_id=%s project_id=%s",
            user["id"],
            project_id,
        )
        raise HTTPException(status_code=500, detail="Unable to update project")
    return {"project": updated}


@router.patch("/api/projects/{project_id}/status")
async def update_project_status(
    request: Request, project_id: int, payload: ProjectStatusUpdate
) -> Dict[str, Any]:
    """Update a project's status."""
    user = _require_user(request)
    updated = supabase_service.update_project_status(
        user["id"], project_id, payload.status
    )
    if not updated:
        logger.error(
            "update_project_status failed for user_id=%s project_id=%s",
            user["id"],
            project_id,
        )
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": payload.status}


@router.delete("/api/projects/{project_id}")
async def delete_project(request: Request, project_id: int) -> Dict[str, Any]:
    """Soft-delete a project (mark as deleted)."""
    user = _require_user(request)
    deleted = supabase_service.delete_project(user["id"], project_id)
    if not deleted:
        logger.error(
            "delete_project failed for user_id=%s project_id=%s",
            user["id"],
            project_id,
        )
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}
