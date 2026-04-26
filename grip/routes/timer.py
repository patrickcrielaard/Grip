"""Timer routes — stopwatch, pomodoro, and time-entry analytics for Grip."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from grip.pomodoro_service import (
    KIND_FOCUS,
    KIND_LONG_BREAK,
    KIND_SHORT_BREAK,
    KIND_STOPWATCH,
    POMODORO_KINDS,
    is_phase_elapsed,
    is_pomodoro_session_stale,
    is_stopwatch_stale,
    next_phase,
    phase_seconds_for,
    remaining_seconds,
)
from grip.routes.todos import _require_user
from grip.supabase_service import supabase_service

router = APIRouter()
logger = logging.getLogger("grip.timer")


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
ALLOWED_GROUP_BY = {"day", "kind", "task", "project", "area"}


# ── Pydantic payloads ───────────────────────────────────────────────────────


class StartSessionPayload(BaseModel):
    """Body for starting a stopwatch or pomodoro on a task."""

    task_id: int


class TimeEntryUpdate(BaseModel):
    """Body for editing a saved time entry."""

    started_at: str | None = None
    ended_at: str | None = None
    notes: str | None = None


class PomodoroSettingsUpdate(BaseModel):
    """Body for updating pomodoro settings (any subset)."""

    focus_minutes: int | None = Field(default=None, ge=1, le=180)
    short_break_minutes: int | None = Field(default=None, ge=1, le=60)
    long_break_minutes: int | None = Field(default=None, ge=1, le=120)
    cycles_per_long_break: int | None = Field(default=None, ge=1, le=12)
    auto_start_breaks: bool | None = None
    auto_start_focus: bool | None = None
    sound_enabled: bool | None = None


# ── Helpers ─────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_started(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Supabase returns ISO strings; tolerate trailing Z and missing tz.
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _validate_task(user_id: str, task_id: int) -> Dict[str, Any]:
    task = supabase_service.get_task(user_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


def _close_active_into_entry(
    user_id: str,
    active: Dict[str, Any],
    ended_at: str,
    interrupted: bool,
) -> None:
    """Persist the active session as a time_entries row, then clear it."""
    task_id = active.get("task_id")
    title_snapshot: str | None = None
    if task_id is not None:
        task = supabase_service.get_task(user_id, int(task_id))
        if task:
            title_snapshot = task.get("title")
    supabase_service.insert_time_entry(
        user_id=user_id,
        task_id=task_id,
        kind=str(active["kind"]),
        started_at=str(active["started_at"]),
        ended_at=ended_at,
        interrupted=interrupted,
        task_title_snapshot=title_snapshot,
    )
    supabase_service.clear_active_session(user_id)


def _maybe_reap_stale(user_id: str, active: Dict[str, Any]) -> Dict[str, Any] | None:
    """If the active session is abandoned, close it and return None.

    Otherwise return the active session unchanged.
    """
    started = _parse_started(str(active.get("started_at") or ""))
    if started is None:
        # Corrupt row — clear it.
        supabase_service.clear_active_session(user_id)
        return None
    kind = str(active.get("kind") or "")
    if kind == KIND_STOPWATCH:
        if is_stopwatch_stale(started):
            # Cap ended_at at started + threshold to avoid logging absurd durations.
            from grip.pomodoro_service import STOPWATCH_STALE_SECONDS

            from datetime import timedelta

            ended = started + timedelta(seconds=STOPWATCH_STALE_SECONDS)
            _close_active_into_entry(user_id, active, ended.isoformat(), True)
            return None
        return active
    if kind in POMODORO_KINDS:
        phase_seconds = int(active.get("phase_seconds") or 0)
        if phase_seconds > 0 and is_pomodoro_session_stale(started, phase_seconds):
            from datetime import timedelta

            ended = started + timedelta(seconds=phase_seconds)
            _close_active_into_entry(user_id, active, ended.isoformat(), False)
            return None
        return active
    # Unknown kind — clear it.
    supabase_service.clear_active_session(user_id)
    return None


def _bump_task_to_in_progress(user_id: str, task: Dict[str, Any]) -> None:
    """Move a to_do task to in_progress when a timer starts on it."""
    if task.get("state") == "to_do":
        supabase_service.update_task(user_id, int(task["id"]), {"state": "in_progress"})


def _serialize_active(active: Dict[str, Any]) -> Dict[str, Any]:
    """Add computed fields to the active session payload returned to clients."""
    started = _parse_started(str(active.get("started_at") or ""))
    phase_seconds = active.get("phase_seconds")
    out = dict(active)
    if started is None:
        return out
    if phase_seconds:
        out["remaining_seconds"] = remaining_seconds(started, int(phase_seconds))
        out["phase_elapsed"] = is_phase_elapsed(started, int(phase_seconds))
    else:
        # Stopwatch has no fixed phase — return elapsed instead.
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        out["elapsed_seconds"] = int(elapsed)
    return out


# ── Active session ──────────────────────────────────────────────────────────


@router.get("/api/timer/active")
async def get_active(request: Request) -> Dict[str, Any]:
    """Return the user's active session, reaping stale ones lazily."""
    user = _require_user(request)
    active = supabase_service.get_active_session(user["id"])
    if not active:
        return {"active": None}
    active = _maybe_reap_stale(user["id"], active)
    if not active:
        return {"active": None}
    return {"active": _serialize_active(active)}


# ── Stopwatch ───────────────────────────────────────────────────────────────


@router.post("/api/timer/stopwatch/start")
async def start_stopwatch(
    request: Request, payload: StartSessionPayload
) -> Dict[str, Any]:
    """Start a stopwatch on a task. Closes any existing session first."""
    user = _require_user(request)
    task = _validate_task(user["id"], payload.task_id)

    existing = supabase_service.get_active_session(user["id"])
    if existing:
        _close_active_into_entry(user["id"], existing, _now_iso(), True)

    started = _now_iso()
    active = supabase_service.upsert_active_session(
        user_id=user["id"],
        task_id=int(task["id"]),
        kind=KIND_STOPWATCH,
        started_at=started,
        phase_seconds=None,
        cycle_index=1,
    )
    if not active:
        raise HTTPException(status_code=500, detail="Unable to start stopwatch")
    _bump_task_to_in_progress(user["id"], task)
    return {"active": _serialize_active(active)}


@router.post("/api/timer/stopwatch/stop")
async def stop_stopwatch(request: Request) -> Dict[str, Any]:
    """Stop the user's active stopwatch and write a time entry."""
    user = _require_user(request)
    active = supabase_service.get_active_session(user["id"])
    if not active or active.get("kind") != KIND_STOPWATCH:
        raise HTTPException(status_code=400, detail="No active stopwatch")
    _close_active_into_entry(user["id"], active, _now_iso(), False)
    return {"active": None}


# ── Pomodoro ────────────────────────────────────────────────────────────────


@router.post("/api/timer/pomodoro/start")
async def start_pomodoro(
    request: Request, payload: StartSessionPayload
) -> Dict[str, Any]:
    """Start a pomodoro focus phase on a task."""
    user = _require_user(request)
    task = _validate_task(user["id"], payload.task_id)

    existing = supabase_service.get_active_session(user["id"])
    if existing:
        _close_active_into_entry(user["id"], existing, _now_iso(), True)

    settings = supabase_service.get_pomodoro_settings(user["id"])
    focus_seconds = phase_seconds_for(KIND_FOCUS, settings)
    active = supabase_service.upsert_active_session(
        user_id=user["id"],
        task_id=int(task["id"]),
        kind=KIND_FOCUS,
        started_at=_now_iso(),
        phase_seconds=focus_seconds,
        cycle_index=1,
    )
    if not active:
        raise HTTPException(status_code=500, detail="Unable to start pomodoro")
    _bump_task_to_in_progress(user["id"], task)
    return {"active": _serialize_active(active), "settings": settings}


def _advance_to_next_phase(
    user_id: str, active: Dict[str, Any], interrupted: bool
) -> Dict[str, Any]:
    """Close current pomodoro phase and start the next one. Returns new active."""
    kind = str(active.get("kind") or "")
    if kind not in POMODORO_KINDS:
        raise HTTPException(
            status_code=400, detail="Active session is not a pomodoro phase"
        )
    settings = supabase_service.get_pomodoro_settings(user_id)
    cycle_index = int(active.get("cycle_index") or 1)
    nxt = next_phase(kind, cycle_index, settings)

    # Decide whether to auto-start the next phase or just stop.
    auto_start_breaks = bool(settings.get("auto_start_breaks", True))
    auto_start_focus = bool(settings.get("auto_start_focus", False))
    next_is_break = nxt.kind in {KIND_SHORT_BREAK, KIND_LONG_BREAK}
    auto = auto_start_breaks if next_is_break else auto_start_focus

    # Close the current phase as a time entry.
    started = _parse_started(str(active.get("started_at") or ""))
    phase_seconds = int(active.get("phase_seconds") or 0)
    if started and phase_seconds and not interrupted:
        # Cap ended_at at the planned end so a late /advance call doesn't bleed into the next phase.
        from datetime import timedelta

        ended_dt = started + timedelta(seconds=phase_seconds)
        ended_iso = ended_dt.isoformat()
    else:
        ended_iso = _now_iso()
    task_id = active.get("task_id")
    title_snapshot: str | None = None
    if task_id is not None:
        task = supabase_service.get_task(user_id, int(task_id))
        if task:
            title_snapshot = task.get("title")
    supabase_service.insert_time_entry(
        user_id=user_id,
        task_id=task_id,
        kind=kind,
        started_at=str(active["started_at"]),
        ended_at=ended_iso,
        interrupted=interrupted,
        task_title_snapshot=title_snapshot,
    )

    if not auto:
        supabase_service.clear_active_session(user_id)
        return {"active": None, "next_phase": nxt.__dict__, "settings": settings}

    new_active = supabase_service.upsert_active_session(
        user_id=user_id,
        task_id=task_id,
        kind=nxt.kind,
        started_at=_now_iso(),
        phase_seconds=nxt.phase_seconds,
        cycle_index=nxt.cycle_index,
    )
    if not new_active:
        raise HTTPException(status_code=500, detail="Unable to advance phase")
    return {"active": _serialize_active(new_active), "settings": settings}


@router.post("/api/timer/pomodoro/advance")
async def advance_pomodoro(request: Request) -> Dict[str, Any]:
    """Idempotent: transition to the next phase if the current one has elapsed."""
    user = _require_user(request)
    active = supabase_service.get_active_session(user["id"])
    if not active:
        raise HTTPException(status_code=400, detail="No active session")
    started = _parse_started(str(active.get("started_at") or ""))
    phase_seconds = int(active.get("phase_seconds") or 0)
    if started is None or phase_seconds <= 0:
        raise HTTPException(status_code=400, detail="Active session is not a pomodoro")
    if not is_phase_elapsed(started, phase_seconds):
        # Phase still running — return current state untouched.
        return {"active": _serialize_active(active)}
    return _advance_to_next_phase(user["id"], active, interrupted=False)


@router.post("/api/timer/pomodoro/skip")
async def skip_pomodoro(request: Request) -> Dict[str, Any]:
    """End the current phase early and advance to the next one."""
    user = _require_user(request)
    active = supabase_service.get_active_session(user["id"])
    if not active:
        raise HTTPException(status_code=400, detail="No active session")
    return _advance_to_next_phase(user["id"], active, interrupted=True)


@router.post("/api/timer/pomodoro/stop")
async def stop_pomodoro(request: Request) -> Dict[str, Any]:
    """End the entire pomodoro session (no auto-advance)."""
    user = _require_user(request)
    active = supabase_service.get_active_session(user["id"])
    if not active or str(active.get("kind")) not in POMODORO_KINDS:
        raise HTTPException(status_code=400, detail="No active pomodoro")
    _close_active_into_entry(user["id"], active, _now_iso(), True)
    return {"active": None}


# ── Time entries CRUD ───────────────────────────────────────────────────────


@router.get("/api/timer/entries")
async def list_entries(
    request: Request,
    task_id: int | None = Query(default=None),
    range_from: str | None = Query(default=None, alias="from"),
    range_to: str | None = Query(default=None, alias="to"),
    limit: int | None = Query(default=None, ge=1, le=500),
) -> Dict[str, Any]:
    """List time entries for the current user."""
    user = _require_user(request)
    start_iso = None
    end_iso = None
    if range_from is not None:
        if not _DATE_RE.match(range_from):
            raise HTTPException(status_code=400, detail="from must be YYYY-MM-DD")
        start_iso = f"{range_from}T00:00:00+00:00"
    if range_to is not None:
        if not _DATE_RE.match(range_to):
            raise HTTPException(status_code=400, detail="to must be YYYY-MM-DD")
        end_iso = f"{range_to}T23:59:59+00:00"
    entries = supabase_service.list_time_entries(
        user["id"],
        task_id=task_id,
        start=start_iso,
        end=end_iso,
        limit=limit,
    )
    return {"entries": entries}


@router.patch("/api/timer/entries/{entry_id}")
async def update_entry(
    request: Request, entry_id: int, payload: TimeEntryUpdate
) -> Dict[str, Any]:
    """Edit a saved time entry's start/end/notes."""
    user = _require_user(request)
    existing = supabase_service.get_time_entry(user["id"], entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")

    updates: Dict[str, Any] = {}
    if payload.started_at is not None:
        if not _DATETIME_RE.match(payload.started_at):
            raise HTTPException(
                status_code=400, detail="started_at must be ISO datetime"
            )
        updates["started_at"] = payload.started_at
    if payload.ended_at is not None:
        if not _DATETIME_RE.match(payload.ended_at):
            raise HTTPException(status_code=400, detail="ended_at must be ISO datetime")
        updates["ended_at"] = payload.ended_at
    if payload.notes is not None:
        updates["notes"] = payload.notes.strip() or None

    if "started_at" in updates and "ended_at" not in updates:
        # Reuse existing ended_at for ordering check.
        updates["ended_at"] = existing.get("ended_at")
    if "ended_at" in updates and "started_at" not in updates:
        updates["started_at"] = existing.get("started_at")
    if "started_at" in updates and "ended_at" in updates:
        if str(updates["started_at"]) >= str(updates["ended_at"]):
            raise HTTPException(
                status_code=400, detail="started_at must be before ended_at"
            )

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    entry = supabase_service.update_time_entry(user["id"], entry_id, updates)
    if not entry:
        raise HTTPException(status_code=500, detail="Unable to update entry")
    return {"entry": entry}


@router.delete("/api/timer/entries/{entry_id}")
async def delete_entry(request: Request, entry_id: int) -> Dict[str, Any]:
    """Delete a time entry."""
    user = _require_user(request)
    deleted = supabase_service.delete_time_entry(user["id"], entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted"}


# ── Summary / analytics ─────────────────────────────────────────────────────


@router.get("/api/timer/summary")
async def time_summary(
    request: Request,
    range_from: str = Query(..., alias="from"),
    range_to: str = Query(..., alias="to"),
    group_by: str = Query(default="day"),
) -> Dict[str, Any]:
    """Aggregate time entries in [from, to] grouped by day/kind/task/project/area."""
    user = _require_user(request)
    if not _DATE_RE.match(range_from) or not _DATE_RE.match(range_to):
        raise HTTPException(status_code=400, detail="from/to must be YYYY-MM-DD")
    if range_from > range_to:
        raise HTTPException(status_code=400, detail="from must be <= to")
    if group_by not in ALLOWED_GROUP_BY:
        raise HTTPException(
            status_code=400,
            detail=f"group_by must be one of {sorted(ALLOWED_GROUP_BY)}",
        )
    rows = supabase_service.time_summary(
        user["id"],
        start=f"{range_from}T00:00:00+00:00",
        end=f"{range_to}T23:59:59+00:00",
        group_by=group_by,
    )
    return {"rows": rows, "from": range_from, "to": range_to, "group_by": group_by}


# ── Pomodoro settings ───────────────────────────────────────────────────────


@router.get("/api/pomodoro/settings")
async def get_settings(request: Request) -> Dict[str, Any]:
    """Return the user's pomodoro settings."""
    user = _require_user(request)
    return {"settings": supabase_service.get_pomodoro_settings(user["id"])}


@router.patch("/api/pomodoro/settings")
async def update_settings(
    request: Request, payload: PomodoroSettingsUpdate
) -> Dict[str, Any]:
    """Update the user's pomodoro settings."""
    user = _require_user(request)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    settings = supabase_service.update_pomodoro_settings(user["id"], updates)
    if not settings:
        raise HTTPException(status_code=500, detail="Unable to update settings")
    return {"settings": settings}
