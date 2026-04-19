"""Area routes for Grip."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from grip.routes.todos import _require_user
from grip.supabase_service import AREA_STATUSES, supabase_service

router = APIRouter()
logger = logging.getLogger("grip.areas")

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class AreaCreate(BaseModel):
    """Payload for creating an area."""

    name: str = Field(..., min_length=1, max_length=120)
    color: str = Field(..., min_length=7, max_length=7)
    description: str | None = None


class AreaUpdate(BaseModel):
    """Payload for updating an area."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, min_length=7, max_length=7)
    description: str | None = None


class AreaStatusUpdate(BaseModel):
    """Payload for updating an area's status."""

    status: str = Field(..., pattern="^(active|archived)$")


def _normalize_color(value: str) -> str:
    """Validate a hex color string like ``#2E7D32``."""
    color = value.strip()
    if not _COLOR_RE.match(color):
        raise HTTPException(
            status_code=400, detail="Color must be a hex string like #2E7D32"
        )
    return color


def _normalize_description(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


@router.get("/api/areas")
async def list_areas(request: Request) -> Dict[str, Any]:
    """Return all areas for the current user."""
    user = _require_user(request)
    areas = supabase_service.list_areas(user["id"])
    return {"areas": areas}


@router.post("/api/areas")
async def create_area(request: Request, payload: AreaCreate) -> Dict[str, Any]:
    """Create an area."""
    user = _require_user(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    color = _normalize_color(payload.color)
    description = _normalize_description(payload.description)
    area = supabase_service.create_area(
        user["id"], name, color, description=description
    )
    if not area:
        logger.error("create_area failed for user_id=%s", user["id"])
        raise HTTPException(
            status_code=500,
            detail="Unable to create area (name may already exist)",
        )
    return {"area": area}


@router.get("/api/areas/{area_id}")
async def get_area(request: Request, area_id: int) -> Dict[str, Any]:
    """Return a single area."""
    user = _require_user(request)
    area = supabase_service.get_area(user["id"], area_id)
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    return {"area": area}


@router.patch("/api/areas/{area_id}")
async def update_area(
    request: Request, area_id: int, payload: AreaUpdate
) -> Dict[str, Any]:
    """Update an area's mutable fields."""
    user = _require_user(request)
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        updates["name"] = name
    if payload.color is not None:
        updates["color"] = _normalize_color(payload.color)
    if "description" in payload.model_fields_set:
        updates["description"] = _normalize_description(payload.description)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    existing = supabase_service.get_area(user["id"], area_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Area not found")
    updated = supabase_service.update_area(user["id"], area_id, updates)
    if not updated:
        logger.error(
            "update_area failed for user_id=%s area_id=%s", user["id"], area_id
        )
        raise HTTPException(status_code=500, detail="Unable to update area")
    return {"area": updated}


@router.patch("/api/areas/{area_id}/status")
async def update_area_status(
    request: Request, area_id: int, payload: AreaStatusUpdate
) -> Dict[str, Any]:
    """Update an area's status (active/archived)."""
    user = _require_user(request)
    if payload.status not in AREA_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    existing = supabase_service.get_area(user["id"], area_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Area not found")
    updated = supabase_service.update_area(
        user["id"], area_id, {"status": payload.status}
    )
    if not updated:
        logger.error(
            "update_area_status failed for user_id=%s area_id=%s",
            user["id"],
            area_id,
        )
        raise HTTPException(status_code=500, detail="Unable to update area status")
    return {"area": updated}


@router.delete("/api/areas/{area_id}")
async def delete_area(request: Request, area_id: int) -> Dict[str, Any]:
    """Hard-delete an area. The DB RESTRICTs if goals or projects still reference it."""
    user = _require_user(request)
    existing = supabase_service.get_area(user["id"], area_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Area not found")
    deleted = supabase_service.delete_area(user["id"], area_id)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail=(
                "Area still has goals or projects — archive or reparent them first"
            ),
        )
    return {"status": "deleted"}
