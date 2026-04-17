"""Project routes for Grip."""

from __future__ import annotations

from typing import Any, Dict
import logging

from fastapi import APIRouter, HTTPException, Request
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


class ProjectStatusUpdate(BaseModel):
    """Payload for updating project status."""

    status: str = Field(..., pattern="^(active|completed|deleted)$")


@router.get("/api/projects")
async def list_projects(request: Request) -> Dict[str, Any]:
    """Return projects for the current user."""
    user = _require_user(request)
    projects = supabase_service.list_projects(user["id"])
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
    project = supabase_service.create_project(
        user["id"], name, start_date=start_date, end_date=end_date
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
