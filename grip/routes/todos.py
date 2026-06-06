"""Todo routes for Grip."""

from __future__ import annotations

from typing import Any, Dict
import calendar
import logging
import re
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, ConfigDict, Field

from grip.routes.authentication import (
    SESSION_USER_ID,
    SESSION_USERNAME,
    get_or_create_csrf_token,
)
from grip.supabase_service import supabase_service


router = APIRouter()

templates = Jinja2Templates(directory="grip/web/templates")
logger = logging.getLogger("grip.todos")

ALLOWED_LISTS = {"inbox", "today"}
DEFAULT_LIST = "inbox"
ALLOWED_PRIORITIES = {"not_set", "low", "medium", "high"}
DEFAULT_PRIORITY = "not_set"
ALLOWED_STATES = {"to_do", "in_progress", "done", "waiting", "someday"}
DEFAULT_STATE = "to_do"
ALLOWED_RECURRENCE_UNITS = {"day", "week", "month"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")


class TodoCreate(BaseModel):
    """Payload for creating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str = Field(..., min_length=1, max_length=280)
    list_name: str = Field(default=DEFAULT_LIST, alias="list")
    area_id: int | None = None
    priority: str | None = DEFAULT_PRIORITY
    deadline: str | None = None
    planned_date: str | None = None
    planned_time: str | None = None
    start_date: str | None = None
    duration: int | None = None
    recurrence_interval: int | None = None
    recurrence_unit: str | None = None
    recurrence_end: str | None = None
    state: str | None = None
    project_id: int | None = None
    assignee_id: str | None = None


class TodoUpdate(BaseModel):
    """Payload for updating a todo."""

    model_config = ConfigDict(populate_by_name=True)
    title: str | None = Field(default=None, min_length=1, max_length=280)
    completed: bool | None = None
    list_name: str | None = Field(default=None, alias="list")
    area_id: int | None = None
    priority: str | None = None
    deadline: str | None = None
    planned_date: str | None = None
    planned_time: str | None = None
    start_date: str | None = None
    duration: int | None = None
    recurrence_interval: int | None = None
    recurrence_unit: str | None = None
    recurrence_end: str | None = None
    state: str | None = None
    project_id: int | None = None
    assignee_id: str | None = None


def _normalize_list_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="List is required")
    # Built-in lists are case-insensitive. User-defined lists are stored as
    # "ul-<id>" — the frontend posts that token verbatim.
    lower = normalized.lower()
    if lower in ALLOWED_LISTS:
        return lower
    if normalized.startswith("ul-") and normalized[3:].isdigit():
        return normalized
    raise HTTPException(
        status_code=400,
        detail="List must be Inbox, Today, or a user-defined list",
    )


def _resolve_area_id(user_id: str, area_id: int | None) -> int | None:
    """Validate that area_id belongs to the user (or return None)."""
    if area_id is None:
        return None
    area = supabase_service.get_area(user_id, area_id)
    if not area:
        raise HTTPException(status_code=400, detail=f"Area {area_id} not found")
    return area_id


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


def _normalize_state(value: str | None) -> str:
    if value is None:
        return DEFAULT_STATE
    normalized = value.strip().lower()
    if not normalized:
        return DEFAULT_STATE
    if normalized not in ALLOWED_STATES:
        raise HTTPException(
            status_code=400,
            detail="State must be to_do, in_progress, done, waiting, or someday",
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


def _normalize_time(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not _TIME_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be a time in HH:MM format",
        )
    return value if len(value) == 8 else f"{value}:00"


def _normalize_duration(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 1:
        raise HTTPException(
            status_code=400, detail="Duration must be at least 1 minute"
        )
    return value


def _normalize_recurrence(
    interval: int | None, unit: str | None
) -> tuple[int | None, str | None]:
    if interval is None and unit is None:
        return None, None
    if interval is None or unit is None:
        raise HTTPException(
            status_code=400,
            detail="recurrence_interval and recurrence_unit must be set together",
        )
    if interval < 1:
        raise HTTPException(
            status_code=400, detail="recurrence_interval must be at least 1"
        )
    normalized_unit = unit.strip().lower()
    if normalized_unit not in ALLOWED_RECURRENCE_UNITS:
        raise HTTPException(
            status_code=400, detail="recurrence_unit must be day, week, or month"
        )
    return interval, normalized_unit


def _validate_project_id(user_id: str, project_id: int | None) -> int | None:
    """Validate that project_id refers to an existing project owned by the user."""
    if project_id is None:
        return None
    project = supabase_service.get_project(user_id, project_id)
    if not project:
        raise HTTPException(status_code=400, detail=f"Project {project_id} not found")
    return project_id


def _validate_assignee_id(user_id: str, assignee_id: str | None) -> str | None:
    """Validate that assignee_id is an active user other than the owner."""
    if assignee_id is None or assignee_id == "":
        return None
    valid_ids = {
        u["id"] for u in supabase_service.list_assignable_users(exclude_user_id=user_id)
    }
    if assignee_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Assignee not found")
    return assignee_id


def _advance_planned_date(date_str: str, interval: int, unit: str) -> str:
    d = date.fromisoformat(date_str)
    if unit == "day":
        d = d + timedelta(days=interval)
    elif unit == "week":
        d = d + timedelta(weeks=interval)
    elif unit == "month":
        month = d.month - 1 + interval
        year = d.year + month // 12
        month = month % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        d = date(year, month, day)
    return d.isoformat()


def _get_user_from_session(request: Request) -> Dict[str, str] | None:
    user_id = request.session.get(SESSION_USER_ID)
    username = request.session.get(SESSION_USERNAME)
    if not user_id or not username:
        return None
    return {"id": str(user_id), "username": str(username)}


def _require_user(request: Request) -> Dict[str, str]:
    user = _get_user_from_session(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.get("/", response_class=HTMLResponse, response_model=None)
async def todos_page(request: Request) -> HTMLResponse | RedirectResponse:
    """Serve the main todo page."""
    user = _get_user_from_session(request)
    if not user:
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "username": user["username"],
            "csrf_token": get_or_create_csrf_token(request),
        },
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

    # Validate inputs; the DB trigger `tasks_list_project_exclusivity_trg`
    # owns the invariant (project ⊕ list) so we just pass both through.
    project_id = _validate_project_id(user["id"], payload.project_id)
    list_name = _normalize_list_name(payload.list_name) or DEFAULT_LIST

    area_id = _resolve_area_id(user["id"], payload.area_id)
    priority = _normalize_priority(payload.priority)
    deadline = _normalize_date(payload.deadline, "Deadline")
    planned_date = _normalize_date(payload.planned_date, "Planned date")
    planned_time = _normalize_time(payload.planned_time, "Planned time")
    start_date = _normalize_date(payload.start_date, "Start date")
    duration = _normalize_duration(payload.duration)
    recurrence_interval, recurrence_unit = _normalize_recurrence(
        payload.recurrence_interval, payload.recurrence_unit
    )
    recurrence_end = _normalize_date(payload.recurrence_end, "Recurrence end")
    state = _normalize_state(payload.state)
    assignee_id = _validate_assignee_id(user["id"], payload.assignee_id)
    todo = supabase_service.create_task(
        user["id"],
        title,
        list_name,
        area_id,
        priority,
        deadline=deadline,
        planned_date=planned_date,
        planned_time=planned_time,
        start_date=start_date,
        duration=duration,
        recurrence_interval=recurrence_interval,
        recurrence_unit=recurrence_unit,
        recurrence_end=recurrence_end,
        state=state,
        project_id=project_id,
        assignee_id=assignee_id,
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
    # Pass list_name / project_id through after validation. The DB trigger
    # tasks_list_project_exclusivity_trg enforces `project ⊕ list`:
    #   • project_id set → list auto-cleared to NULL
    #   • project_id cleared → list auto-restored to 'inbox' if NULL
    if payload.list_name is not None:
        updates["list"] = _normalize_list_name(payload.list_name)
    if "project_id" in payload.model_fields_set:
        if payload.project_id is not None:
            _validate_project_id(user["id"], payload.project_id)
        updates["project_id"] = payload.project_id

    if "assignee_id" in payload.model_fields_set:
        # Only the owner may (re)assign a task. Assignees can edit fields but
        # not hand the task off to someone else.
        current = supabase_service.get_task(user["id"], todo_id)
        if not current:
            raise HTTPException(status_code=404, detail="Todo not found")
        if not current.get("mine"):
            raise HTTPException(
                status_code=403, detail="Only the owner can change the assignee"
            )
        updates["assignee_id"] = _validate_assignee_id(user["id"], payload.assignee_id)
    if "area_id" in payload.model_fields_set:
        updates["area_id"] = _resolve_area_id(user["id"], payload.area_id)
    if "priority" in payload.model_fields_set:
        updates["priority"] = _normalize_priority(payload.priority)
    if "deadline" in payload.model_fields_set:
        updates["deadline"] = _normalize_date(payload.deadline, "Deadline")
    if "planned_date" in payload.model_fields_set:
        updates["planned_date"] = _normalize_date(payload.planned_date, "Planned date")
    if "planned_time" in payload.model_fields_set:
        updates["planned_time"] = _normalize_time(payload.planned_time, "Planned time")
    if "start_date" in payload.model_fields_set:
        updates["start_date"] = _normalize_date(payload.start_date, "Start date")
    if "duration" in payload.model_fields_set:
        updates["duration"] = _normalize_duration(payload.duration)
    if (
        "recurrence_interval" in payload.model_fields_set
        or "recurrence_unit" in payload.model_fields_set
    ):
        ri = (
            payload.recurrence_interval
            if "recurrence_interval" in payload.model_fields_set
            else None
        )
        ru = (
            payload.recurrence_unit
            if "recurrence_unit" in payload.model_fields_set
            else None
        )
        norm_ri, norm_ru = _normalize_recurrence(ri, ru)
        updates["recurrence_interval"] = norm_ri
        updates["recurrence_unit"] = norm_ru
    if "recurrence_end" in payload.model_fields_set:
        updates["recurrence_end"] = _normalize_date(
            payload.recurrence_end, "Recurrence end"
        )
    if "state" in payload.model_fields_set:
        updates["state"] = _normalize_state(payload.state)

    # Bidirectional state ↔ completed sync
    if "state" in updates and "completed" not in updates:
        updates["completed"] = updates["state"] == "done"
    if "completed" in updates and "state" not in updates:
        updates["state"] = "done" if updates["completed"] else "to_do"

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    # When marking complete, check if a new recurring occurrence should be spawned
    spawned_todo = None
    if updates.get("completed") is True:
        current = supabase_service.get_task(user["id"], todo_id)
        if (
            current
            and current.get("recurrence_interval")
            and current.get("recurrence_unit")
            and current.get("planned_date")
        ):
            next_date = _advance_planned_date(
                current["planned_date"],
                current["recurrence_interval"],
                current["recurrence_unit"],
            )
            recurrence_end = current.get("recurrence_end")
            if not recurrence_end or next_date <= recurrence_end:
                # Preserve parent's bucket semantics: a project task spawns
                # a project task with list=None; a list task spawns a list
                # task. Trigger would normalise either way, but being
                # explicit keeps the intent clear at the call site.
                parent_project_id = current.get("project_id")
                spawned_list = (
                    None if parent_project_id else (current.get("list") or "inbox")
                )
                spawned_todo = supabase_service.create_task(
                    user["id"],
                    current["title"],
                    spawned_list,
                    current.get("area_id"),
                    current.get("priority", "not_set"),
                    deadline=current.get("deadline"),
                    planned_date=next_date,
                    planned_time=current.get("planned_time"),
                    start_date=current.get("start_date"),
                    duration=current.get("duration"),
                    recurrence_interval=current["recurrence_interval"],
                    recurrence_unit=current["recurrence_unit"],
                    recurrence_end=recurrence_end,
                    project_id=parent_project_id,
                    assignee_id=current.get("assignee_id"),
                )

    todo = supabase_service.update_task(user["id"], todo_id, updates)
    if not todo:
        logger.error(
            "update_todo failed for user_id=%s task_id=%s", user["id"], todo_id
        )
        raise HTTPException(status_code=404, detail="Todo not found")
    result: Dict[str, Any] = {"todo": todo}
    if spawned_todo:
        result["spawned_todo"] = spawned_todo
    return result


@router.get("/api/users")
async def list_users(request: Request) -> Dict[str, Any]:
    """Return users a task can be assigned to (everyone but the caller)."""
    user = _require_user(request)
    users = supabase_service.list_assignable_users(exclude_user_id=user["id"])
    return {"users": users}


@router.get("/api/mcp-token")
async def get_mcp_token(request: Request) -> Dict[str, Any]:
    """Return the MCP bearer token for the current user."""
    user = _require_user(request)
    token = supabase_service.get_mcp_token(user["id"])
    if not token:
        raise HTTPException(status_code=500, detail="MCP token not found")
    return {"token": token}


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
