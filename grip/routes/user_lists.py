"""User-defined task list routes for Grip."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from grip.routes.todos import _require_user
from grip.supabase_service import supabase_service

router = APIRouter()
logger = logging.getLogger("grip.user_lists")


class UserListCreate(BaseModel):
    """Payload for creating a user list."""

    name: str = Field(..., min_length=1, max_length=120)


@router.get("/api/user-lists")
async def list_user_lists(request: Request) -> Dict[str, Any]:
    """Return all user-defined lists for the current user."""
    user = _require_user(request)
    lists = supabase_service.list_user_lists(user["id"])
    return {"lists": lists}


@router.post("/api/user-lists")
async def create_user_list(request: Request, payload: UserListCreate) -> Dict[str, Any]:
    """Create a new user-defined list."""
    user = _require_user(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    row = supabase_service.create_user_list(user["id"], name)
    if not row:
        raise HTTPException(status_code=500, detail="Unable to create list")
    return {"list": row}


@router.delete("/api/user-lists/{list_id}")
async def delete_user_list(request: Request, list_id: int) -> Dict[str, Any]:
    """Delete a user-defined list."""
    user = _require_user(request)
    ok = supabase_service.delete_user_list(user["id"], list_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Unable to delete list")
    return {"ok": True}
