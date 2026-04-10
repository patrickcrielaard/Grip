"""MCP server for Grip — exposes todo CRUD tools over stdio and HTTP transports."""

from __future__ import annotations

import contextvars
import os
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from grip.routes.todos import (
    DEFAULT_LIST,
    DEFAULT_PRIORITY,
    DEFAULT_STATE,
    _advance_planned_date,
    _normalize_area,
    _normalize_date,
    _normalize_duration,
    _normalize_list_name,
    _normalize_priority,
    _normalize_recurrence,
    _normalize_state,
)
from grip.supabase_service import supabase_service

# Per-request user ID (set by HTTP auth middleware; falls back to env var for stdio)
_user_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("grip_user_id")


def _user_id() -> str:
    """Return the current user ID from request context (HTTP) or env var (stdio)."""
    try:
        return _user_id_ctx.get()
    except LookupError:
        env_id = os.environ.get("GRIP_MCP_USER_ID")
        if env_id:
            return env_id
        raise RuntimeError(
            "No user ID in context. Set GRIP_MCP_USER_ID for stdio mode."
        )


# streamable_http_path="/" — FastAPI strips the /mcp mount prefix, so the sub-app
# must route at "/" rather than the default "/mcp".
# transport_security — disable localhost-only DNS rebinding protection for Railway HTTPS.
mcp = FastMCP(
    "Grip",
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def _v(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Convert HTTPException from _normalize_* helpers into ValueError."""
    try:
        return fn(*args, **kwargs)
    except HTTPException as e:
        raise ValueError(e.detail) from e


@mcp.tool()
def list_todos() -> list[dict[str, Any]]:
    """Return all todos for the configured user, newest first."""
    return supabase_service.list_tasks(_user_id())


@mcp.tool()
def create_todo(
    title: str,
    list: str = DEFAULT_LIST,
    area: str | None = None,
    priority: str = DEFAULT_PRIORITY,
    deadline: str | None = None,
    planned_date: str | None = None,
    start_date: str | None = None,
    duration: int | None = None,
    recurrence_interval: int | None = None,
    recurrence_unit: str | None = None,
    recurrence_end: str | None = None,
    state: str = DEFAULT_STATE,
) -> dict[str, Any]:
    """
    Create a new todo.
    list: "inbox" (default) | "today"
    area: "personal" | "work" | omit
    priority: "not_set" (default) | "low" | "medium" | "high"
    deadline / planned_date / start_date / recurrence_end: YYYY-MM-DD strings
    duration: minutes as an integer
    recurrence_interval + recurrence_unit must be set together; unit: "day" | "week" | "month"
    state: "to_do" (default) | "in_progress" | "done" | "waiting" | "someday"
    """
    title = title.strip()
    if not title:
        raise ValueError("title is required")
    ri, ru = _v(_normalize_recurrence, recurrence_interval, recurrence_unit)
    todo = supabase_service.create_task(
        _user_id(),
        title,
        _v(_normalize_list_name, list) or DEFAULT_LIST,
        _v(_normalize_area, area),
        _v(_normalize_priority, priority),
        deadline=_v(_normalize_date, deadline, "deadline"),
        planned_date=_v(_normalize_date, planned_date, "planned_date"),
        start_date=_v(_normalize_date, start_date, "start_date"),
        duration=_v(_normalize_duration, duration),
        recurrence_interval=ri,
        recurrence_unit=ru,
        recurrence_end=_v(_normalize_date, recurrence_end, "recurrence_end"),
        state=_v(_normalize_state, state),
    )
    if todo is None:
        raise RuntimeError("create_todo failed")
    return todo


@mcp.tool()
def update_todo(
    todo_id: int,
    title: str | None = None,
    completed: bool | None = None,
    list: str | None = None,
    area: str | None = None,
    priority: str | None = None,
    deadline: str | None = None,
    planned_date: str | None = None,
    start_date: str | None = None,
    duration: int | None = None,
    recurrence_interval: int | None = None,
    recurrence_unit: str | None = None,
    recurrence_end: str | None = None,
    state: str | None = None,
) -> dict[str, Any]:
    """
    Update one or more fields on an existing todo.
    Only supplied fields are changed.
    Setting state="done" auto-sets completed=true and vice versa.
    """
    updates: dict[str, Any] = {}
    if title is not None:
        t = title.strip()
        if not t:
            raise ValueError("title cannot be empty")
        updates["title"] = t
    if completed is not None:
        updates["completed"] = completed
    if list is not None:
        updates["list"] = _v(_normalize_list_name, list)
    if area is not None:
        updates["area"] = _v(_normalize_area, area)
    if priority is not None:
        updates["priority"] = _v(_normalize_priority, priority)
    if deadline is not None:
        updates["deadline"] = _v(_normalize_date, deadline, "deadline")
    if planned_date is not None:
        updates["planned_date"] = _v(_normalize_date, planned_date, "planned_date")
    if start_date is not None:
        updates["start_date"] = _v(_normalize_date, start_date, "start_date")
    if duration is not None:
        updates["duration"] = _v(_normalize_duration, duration)
    if recurrence_interval is not None or recurrence_unit is not None:
        ri, ru = _v(_normalize_recurrence, recurrence_interval, recurrence_unit)
        updates["recurrence_interval"] = ri
        updates["recurrence_unit"] = ru
    if recurrence_end is not None:
        updates["recurrence_end"] = _v(
            _normalize_date, recurrence_end, "recurrence_end"
        )
    if state is not None:
        updates["state"] = _v(_normalize_state, state)

    # Bidirectional state <-> completed sync
    if "state" in updates and "completed" not in updates:
        updates["completed"] = updates["state"] == "done"
    if "completed" in updates and "state" not in updates:
        updates["state"] = "done" if updates["completed"] else "to_do"

    if not updates:
        raise ValueError("No fields to update were provided")

    # Spawn next recurrence when marking complete (mirrors HTTP route behaviour)
    spawned = None
    if updates.get("completed") is True:
        current = supabase_service.get_task(_user_id(), todo_id)
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
            rec_end = current.get("recurrence_end")
            if not rec_end or next_date <= rec_end:
                spawned = supabase_service.create_task(
                    _user_id(),
                    current["title"],
                    current.get("list", "inbox"),
                    current.get("area"),
                    current.get("priority", "not_set"),
                    deadline=current.get("deadline"),
                    planned_date=next_date,
                    start_date=current.get("start_date"),
                    duration=current.get("duration"),
                    recurrence_interval=current["recurrence_interval"],
                    recurrence_unit=current["recurrence_unit"],
                    recurrence_end=rec_end,
                )

    result = supabase_service.update_task(_user_id(), todo_id, updates)
    if result is None:
        raise RuntimeError(f"Todo {todo_id} not found")
    out: dict[str, Any] = {"todo": result}
    if spawned:
        out["spawned_todo"] = spawned
    return out


@mcp.tool()
def delete_todo(todo_id: int) -> dict[str, Any]:
    """Permanently delete a todo by id."""
    if not supabase_service.delete_task(_user_id(), todo_id):
        raise RuntimeError(f"Todo {todo_id} not found")
    return {"deleted": True}


@mcp.tool()
def clear_completed(list: str | None = None) -> dict[str, Any]:
    """
    Delete all completed todos.
    Pass list="inbox" or "today" to scope deletion. Returns {"deleted": count}.
    """
    list_name = _v(_normalize_list_name, list) if list is not None else None
    count = supabase_service.clear_completed(_user_id(), list_name)
    return {"deleted": count}


if __name__ == "__main__":
    mcp.run()
