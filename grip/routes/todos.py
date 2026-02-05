"""Todo routes for Grip."""

from __future__ import annotations

from typing import Any, Dict
import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, ConfigDict, Field

from grip.routes.authentication import COOKIE_USER_ID, COOKIE_USERNAME
from grip.supabase_service import SupabaseService


router = APIRouter()

templates = Jinja2Templates(directory="grip/web/templates")

supabase_service = SupabaseService()
logger = logging.getLogger("grip.todos")

ALLOWED_LISTS = {"inbox", "today"}
DEFAULT_LIST = "inbox"
ALLOWED_AREAS = {"personal", "work"}


class TodoCreate(BaseModel):
    """Payload for creating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str = Field(..., min_length=1, max_length=280)
    list_name: str = Field(default=DEFAULT_LIST, alias="list")
    area: str | None = None


class TodoUpdate(BaseModel):
    """Payload for updating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str | None = Field(default=None, min_length=1, max_length=280)
    completed: bool | None = None
    list_name: str | None = Field(default=None, alias="list")
    area: str | None = None


def _normalize_list_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="List is required")
    if normalized not in ALLOWED_LISTS:
        raise HTTPException(status_code=400, detail="List must be Inbox or Today")
    return normalized


def _normalize_area(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if normalized not in ALLOWED_AREAS:
        raise HTTPException(status_code=400, detail="Area must be Personal or Work")
    return normalized


def _get_user_from_cookies(request: Request) -> Dict[str, str] | None:
    user_id = request.cookies.get(COOKIE_USER_ID)
    username = request.cookies.get(COOKIE_USERNAME)
    if not user_id or not username:
        return None
    return {"id": user_id, "username": username}


def _require_user(request: Request) -> Dict[str, str]:
    user = _get_user_from_cookies(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.get("/", response_class=HTMLResponse, response_model=None)
async def todos_page(request: Request) -> HTMLResponse | RedirectResponse:
    """Serve the main todo page."""
    user = _get_user_from_cookies(request)
    if not user:
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse(
        "index.html", {"request": request, "username": user["username"]}
    )


@router.get("/api/todos")
async def list_todos(request: Request) -> Dict[str, Any]:
    """Return todos for the current user."""
    user = _require_user(request)
    todos = supabase_service.list_tasks(user["id"])
    return {"todos": todos}


@router.post("/api/todos")
async def create_todo(request: Request, payload: TodoCreate) -> Dict[str, Any]:
    """Create a todo."""
    user = _require_user(request)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    list_name = _normalize_list_name(payload.list_name) or DEFAULT_LIST
    area = _normalize_area(payload.area)
    todo = supabase_service.create_task(user["id"], title, list_name, area)
    if not todo:
        logger.error("create_todo failed for user_id=%s", user["id"])
        raise HTTPException(status_code=500, detail="Unable to create task")
    return {"todo": todo}


@router.delete("/api/todos/completed")
async def clear_completed(
    request: Request,
    list_name: str | None = Query(default=None, alias="list"),
) -> Dict[str, Any]:
    """Clear completed todos."""
    user = _require_user(request)
    normalized_list = _normalize_list_name(list_name) if list_name is not None else None
    deleted = supabase_service.clear_completed(user["id"], normalized_list)
    return {"deleted": deleted}


@router.patch("/api/todos/{todo_id}")
async def update_todo(
    request: Request, todo_id: int, payload: TodoUpdate
) -> Dict[str, Any]:
    """Update a todo."""
    user = _require_user(request)
    updates: Dict[str, Any] = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        updates["title"] = title
    if payload.completed is not None:
        updates["completed"] = payload.completed
    if payload.list_name is not None:
        list_name = _normalize_list_name(payload.list_name)
        updates["list"] = list_name
    if "area" in payload.model_fields_set:
        updates["area"] = _normalize_area(payload.area)

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    todo = supabase_service.update_task(user["id"], todo_id, updates)
    if not todo:
        logger.error(
            "update_todo failed for user_id=%s task_id=%s", user["id"], todo_id
        )
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"todo": todo}


@router.delete("/api/todos/{todo_id}")
async def delete_todo(request: Request, todo_id: int) -> Dict[str, Any]:
    """Delete a todo."""
    user = _require_user(request)
    deleted = supabase_service.delete_task(user["id"], todo_id)
    if not deleted:
        logger.error(
            "delete_todo failed for user_id=%s task_id=%s", user["id"], todo_id
        )
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"status": "deleted"}
