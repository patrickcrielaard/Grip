"""Todo routes for Grip."""

from __future__ import annotations

from typing import Any, Dict
import logging
import re

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
ALLOWED_PRIORITIES = {"not_set", "low", "medium", "high"}
DEFAULT_PRIORITY = "not_set"
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class TodoCreate(BaseModel):
    """Payload for creating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str = Field(..., min_length=1, max_length=280)
    list_name: str = Field(default=DEFAULT_LIST, alias="list")
    area: str | None = None
    priority: str | None = DEFAULT_PRIORITY
    deadline: str | None = None
    planned_date: str | None = None
    start_date: str | None = None
    duration: int | None = None


class TodoUpdate(BaseModel):
    """Payload for updating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str | None = Field(default=None, min_length=1, max_length=280)
    completed: bool | None = None
    list_name: str | None = Field(default=None, alias="list")
    area: str | None = None
    priority: str | None = None
    deadline: str | None = None
    planned_date: str | None = None
    start_date: str | None = None
    duration: int | None = None


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


def _normalize_priority(value: str | None) -> str:
    if value is None:
        return DEFAULT_PRIORITY
    normalized = value.strip().lower().replace(" ", "_")
    if not normalized:
        return DEFAULT_PRIORITY
    if normalized not in ALLOWED_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail="Priority must be Not set, Low, Medium, or High",
        )
    return normalized


def _normalize_date(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not _DATE_RE.match(value):
        raise HTTPException(
            status_code=400, detail=f"{field} must be a date in YYYY-MM-DD format"
        )
    return value


def _normalize_duration(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 1:
        raise HTTPException(
            status_code=400, detail="Duration must be at least 1 minute"
        )
    return value


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
    priority = _normalize_priority(payload.priority)
    deadline = _normalize_date(payload.deadline, "Deadline")
    planned_date = _normalize_date(payload.planned_date, "Planned date")
    start_date = _normalize_date(payload.start_date, "Start date")
    duration = _normalize_duration(payload.duration)
    todo = supabase_service.create_task(
        user["id"],
        title,
        list_name,
        area,
        priority,
        deadline=deadline,
        planned_date=planned_date,
        start_date=start_date,
        duration=duration,
    )
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
    if "priority" in payload.model_fields_set:
        updates["priority"] = _normalize_priority(payload.priority)
    if "deadline" in payload.model_fields_set:
        updates["deadline"] = _normalize_date(payload.deadline, "Deadline")
    if "planned_date" in payload.model_fields_set:
        updates["planned_date"] = _normalize_date(payload.planned_date, "Planned date")
    if "start_date" in payload.model_fields_set:
        updates["start_date"] = _normalize_date(payload.start_date, "Start date")
    if "duration" in payload.model_fields_set:
        updates["duration"] = _normalize_duration(payload.duration)

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
