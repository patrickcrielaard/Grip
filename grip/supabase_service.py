"""Supabase service for Grip todo operations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

import bcrypt
import logging
from supabase import Client, create_client

from grip.configuration import settings

TASK_PRIORITIES = {"not_set", "low", "medium", "high"}

TASK_SELECT_COLUMNS = (
    "id, title, completed, created_at, list, area_id, priority, deadline, "
    "planned_date, planned_time, start_date, duration, recurrence_interval, "
    "recurrence_unit, recurrence_end, state, project_id"
)
PROJECT_SELECT_COLUMNS = "id, name, start_date, end_date, created_at, status, area_id, goal_id, show_on_today"
AREA_SELECT_COLUMNS = "id, name, color, description, status, created_at"
GOAL_SELECT_COLUMNS = (
    "id, area_id, name, description, start_date, end_date, status, created_at"
)

AREA_STATUSES = {"active", "archived"}
GOAL_STATUSES = {"active", "completed", "archived"}

CALENDAR_SUBSCRIPTION_SELECT_COLUMNS = (
    "id, user_id, name, url, color, area_id, enabled, "
    "last_synced_at, last_error, created_at"
)
CALENDAR_EVENT_SELECT_COLUMNS = (
    "id, subscription_id, uid, summary, description, location, "
    "start_at, end_at, all_day, rrule"
)

ACTIVE_SESSION_SELECT_COLUMNS = (
    "user_id, task_id, kind, started_at, phase_seconds, cycle_index, notes"
)
TIME_ENTRY_SELECT_COLUMNS = (
    "id, user_id, task_id, task_title_snapshot, kind, started_at, ended_at, "
    "duration_seconds, interrupted, notes, created_at"
)
POMODORO_SETTINGS_SELECT_COLUMNS = (
    "user_id, focus_minutes, short_break_minutes, long_break_minutes, "
    "cycles_per_long_break, auto_start_breaks, auto_start_focus, sound_enabled, "
    "updated_at"
)


class SupabaseService:
    """Service for accessing Grip data via Supabase."""

    def __init__(self) -> None:
        """Initialize Supabase client using configured credentials."""
        self.supabase: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
        self.logger = logging.getLogger("grip.supabase")

    def _normalize_task_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """Backfill task defaults for nullable/legacy columns."""
        # `list` is legitimately NULL for project tasks (enforced by the
        # tasks_list_project_exclusivity_trg trigger). Only default to "inbox"
        # when the task has no project either — i.e. an unparented task with
        # a stray NULL from legacy data.
        if not row.get("list") and not row.get("project_id"):
            row["list"] = "inbox"
        if not row.get("state"):
            row["state"] = "to_do"

        priority = row.get("priority")
        if not isinstance(priority, str):
            row["priority"] = "not_set"
            return row

        normalized_priority = priority.strip().lower().replace(" ", "_")
        if normalized_priority not in TASK_PRIORITIES:
            normalized_priority = "not_set"
        row["priority"] = normalized_priority
        return row

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Return a single user record by username."""
        try:
            result = (
                self.supabase.table("app_users")
                .select("id, username, password_hash, is_active")
                .eq("username", username)
                .execute()
            )
            if result.data:
                return cast(Dict[str, Any], result.data[0])
            return None
        except Exception as exc:
            self.logger.exception("get_user_by_username failed: %s", exc)
            return None

    def get_mcp_token(self, user_id: str) -> Optional[str]:
        """Return the mcp_token for a user, or None."""
        try:
            result = (
                self.supabase.table("app_users")
                .select("mcp_token")
                .eq("id", user_id)
                .execute()
            )
            if result.data and isinstance(result.data, list):
                row = cast(Dict[str, Any], result.data[0])
                token = row.get("mcp_token")
                return str(token) if token else None
            return None
        except Exception as exc:
            self.logger.exception("get_mcp_token failed: %s", exc)
            return None

    def get_user_by_mcp_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Return user record matching mcp_token, or None."""
        try:
            result = (
                self.supabase.table("app_users")
                .select("id, username")
                .eq("mcp_token", token)
                .execute()
            )
            if result.data:
                return cast(Dict[str, Any], result.data[0])
            return None
        except Exception as exc:
            self.logger.exception("get_user_by_mcp_token failed: %s", exc)
            return None

    def verify_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """Validate username/password credentials."""
        user = self.get_user_by_username(username)
        if not user:
            return None

        if not user.get("is_active", True):
            return None

        password_hash = user.get("password_hash")
        if not password_hash:
            return None

        try:
            if not bcrypt.checkpw(
                password.encode("utf-8"), password_hash.encode("utf-8")
            ):
                return None
        except Exception:
            return None

        return user

    def touch_last_login(self, user_id: str) -> None:
        """Update the last_login_at timestamp for a user."""
        try:
            self.supabase.table("app_users").update(
                {"last_login_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", user_id).execute()
        except Exception as exc:
            self.logger.warning("touch_last_login failed: %s", exc)

    def list_tasks(self, user_id: str) -> List[Dict[str, Any]]:
        """Return all tasks for a user."""
        try:
            result = (
                self.supabase.table("tasks")
                .select(TASK_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = [cast(Dict[str, Any], row) for row in (result.data or [])]
            for row in rows:
                self._normalize_task_row(row)
            return rows
        except Exception as exc:
            self.logger.exception("list_tasks failed: %s", exc)
            return []

    def get_task(self, user_id: str, task_id: int) -> Optional[Dict[str, Any]]:
        """Return a single task by id for a user."""
        try:
            result = (
                self.supabase.table("tasks")
                .select(TASK_SELECT_COLUMNS)
                .eq("id", task_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            row = cast(Dict[str, Any], result.data[0])
            return self._normalize_task_row(row)
        except Exception as exc:
            self.logger.exception("get_task failed: %s", exc)
            return None

    def create_task(
        self,
        user_id: str,
        title: str,
        list_name: str | None,
        area_id: int | None,
        priority: str,
        deadline: str | None = None,
        planned_date: str | None = None,
        planned_time: str | None = None,
        start_date: str | None = None,
        duration: int | None = None,
        recurrence_interval: int | None = None,
        recurrence_unit: str | None = None,
        recurrence_end: str | None = None,
        state: str | None = None,
        project_id: int | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new task."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "title": title,
                "list": list_name,
                "area_id": area_id,
                "priority": priority,
                "state": state or "to_do",
            }
            if deadline is not None:
                payload["deadline"] = deadline
            if planned_date is not None:
                payload["planned_date"] = planned_date
            if planned_time is not None:
                payload["planned_time"] = planned_time
            if start_date is not None:
                payload["start_date"] = start_date
            if duration is not None:
                payload["duration"] = duration
            if recurrence_interval is not None:
                payload["recurrence_interval"] = recurrence_interval
            if recurrence_unit is not None:
                payload["recurrence_unit"] = recurrence_unit
            if recurrence_end is not None:
                payload["recurrence_end"] = recurrence_end
            if project_id is not None:
                payload["project_id"] = project_id
            result = self.supabase.table("tasks").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                row = cast(Dict[str, Any], result.data[0])
            else:
                row = cast(Dict[str, Any], result.data)
            return self._normalize_task_row(row)
        except Exception as exc:
            self.logger.exception("create_task failed: %s", exc)
            return None

    def update_task(
        self, user_id: str, task_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a task for a user."""
        try:
            result = (
                self.supabase.table("tasks")
                .update(updates)
                .eq("id", task_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                row = cast(Dict[str, Any], result.data[0])
            else:
                row = cast(Dict[str, Any], result.data)
            return self._normalize_task_row(row)
        except Exception as exc:
            self.logger.exception("update_task failed: %s", exc)
            return None

    def delete_task(self, user_id: str, task_id: int) -> bool:
        """Delete a task for a user."""
        try:
            result = (
                self.supabase.table("tasks")
                .delete()
                .eq("id", task_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(result.data)
        except Exception as exc:
            self.logger.exception("delete_task failed: %s", exc)
            return False

    def clear_completed(self, user_id: str, list_name: str | None = None) -> int:
        """Delete all completed tasks for a user."""
        try:
            query = (
                self.supabase.table("tasks")
                .delete()
                .eq("user_id", user_id)
                .eq("completed", True)
            )
            if list_name:
                query = query.eq("list", list_name)
            result = query.execute()
            return len(result.data or [])
        except Exception as exc:
            self.logger.exception("clear_completed failed: %s", exc)
            return 0

    # ── Projects ────────────────────────────────────────────────────────────

    def list_projects(
        self,
        user_id: str,
        area_id: int | None = None,
        goal_id: int | None = None,
        unparented: bool = False,
    ) -> List[Dict[str, Any]]:
        """Return projects for a user, optionally filtered.

        area_id: return only projects attached to this area (directly or via a goal).
        goal_id: return only projects attached to this goal.
        unparented: if True, return only projects with neither area_id nor goal_id.
        """
        try:
            query = (
                self.supabase.table("projects")
                .select(PROJECT_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .eq("status", "active")
            )
            if area_id is not None:
                query = query.eq("area_id", area_id)
            if goal_id is not None:
                query = query.eq("goal_id", goal_id)
            if unparented:
                query = query.is_("area_id", None).is_("goal_id", None)
            result = query.order("created_at", desc=True).execute()
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_projects failed: %s", exc)
            return []

    def list_completed_projects(self, user_id: str) -> List[Dict[str, Any]]:
        """Return completed projects for a user, newest first."""
        try:
            result = (
                self.supabase.table("projects")
                .select(PROJECT_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .eq("status", "completed")
                .order("created_at", desc=True)
                .execute()
            )
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_completed_projects failed: %s", exc)
            return []

    def get_project(self, user_id: str, project_id: int) -> Optional[Dict[str, Any]]:
        """Return a single active project by id for a user."""
        try:
            result = (
                self.supabase.table("projects")
                .select(PROJECT_SELECT_COLUMNS)
                .eq("id", project_id)
                .eq("user_id", user_id)
                .eq("status", "active")
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_project failed: %s", exc)
            return None

    def create_project(
        self,
        user_id: str,
        name: str,
        start_date: str | None = None,
        end_date: str | None = None,
        area_id: int | None = None,
        goal_id: int | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new project.

        If goal_id is set, the DB trigger forces area_id to match the goal's area.
        """
        try:
            payload: Dict[str, Any] = {"user_id": user_id, "name": name}
            if start_date is not None:
                payload["start_date"] = start_date
            if end_date is not None:
                payload["end_date"] = end_date
            if area_id is not None:
                payload["area_id"] = area_id
            if goal_id is not None:
                payload["goal_id"] = goal_id
            result = self.supabase.table("projects").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("create_project failed: %s", exc)
            return None

    def update_project(
        self, user_id: str, project_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a project's mutable fields (name, dates, area_id, goal_id, status)."""
        try:
            result = (
                self.supabase.table("projects")
                .update(updates)
                .eq("id", project_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_project failed: %s", exc)
            return None

    def update_project_status(self, user_id: str, project_id: int, status: str) -> bool:
        """Update the status of a project for a user."""
        return self.update_project(user_id, project_id, {"status": status}) is not None

    def delete_project(self, user_id: str, project_id: int) -> bool:
        """Soft-delete a project for a user (mark as deleted)."""
        return self.update_project_status(user_id, project_id, "deleted")

    # ── Areas ───────────────────────────────────────────────────────────────

    def list_areas(self, user_id: str) -> List[Dict[str, Any]]:
        """Return all areas for a user (both active and archived), newest first."""
        try:
            result = (
                self.supabase.table("areas")
                .select(AREA_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .order("created_at", desc=False)
                .execute()
            )
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_areas failed: %s", exc)
            return []

    def get_area(self, user_id: str, area_id: int) -> Optional[Dict[str, Any]]:
        """Return a single area by id for a user."""
        try:
            result = (
                self.supabase.table("areas")
                .select(AREA_SELECT_COLUMNS)
                .eq("id", area_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_area failed: %s", exc)
            return None

    def create_area(
        self,
        user_id: str,
        name: str,
        color: str,
        description: str | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new area."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "name": name,
                "color": color,
            }
            if description is not None:
                payload["description"] = description
            result = self.supabase.table("areas").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("create_area failed: %s", exc)
            return None

    def update_area(
        self, user_id: str, area_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update an area's mutable fields (name, color, description, status)."""
        try:
            result = (
                self.supabase.table("areas")
                .update(updates)
                .eq("id", area_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_area failed: %s", exc)
            return None

    def delete_area(self, user_id: str, area_id: int) -> bool:
        """Hard-delete an area. The DB RESTRICTs if goals or projects reference it."""
        try:
            result = (
                self.supabase.table("areas")
                .delete()
                .eq("id", area_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(result.data)
        except Exception as exc:
            self.logger.exception("delete_area failed: %s", exc)
            return False

    # ── Goals ───────────────────────────────────────────────────────────────

    def list_goals(
        self, user_id: str, area_id: int | None = None
    ) -> List[Dict[str, Any]]:
        """Return goals for a user, optionally filtered by area_id."""
        try:
            query = (
                self.supabase.table("goals")
                .select(GOAL_SELECT_COLUMNS)
                .eq("user_id", user_id)
            )
            if area_id is not None:
                query = query.eq("area_id", area_id)
            result = query.order("created_at", desc=False).execute()
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_goals failed: %s", exc)
            return []

    def get_goal(self, user_id: str, goal_id: int) -> Optional[Dict[str, Any]]:
        """Return a single goal by id for a user."""
        try:
            result = (
                self.supabase.table("goals")
                .select(GOAL_SELECT_COLUMNS)
                .eq("id", goal_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_goal failed: %s", exc)
            return None

    def create_goal(
        self,
        user_id: str,
        area_id: int,
        name: str,
        description: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new goal under an area."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "area_id": area_id,
                "name": name,
            }
            if description is not None:
                payload["description"] = description
            if start_date is not None:
                payload["start_date"] = start_date
            if end_date is not None:
                payload["end_date"] = end_date
            result = self.supabase.table("goals").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("create_goal failed: %s", exc)
            return None

    def update_goal(
        self, user_id: str, goal_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a goal's mutable fields."""
        try:
            result = (
                self.supabase.table("goals")
                .update(updates)
                .eq("id", goal_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_goal failed: %s", exc)
            return None

    def delete_goal(self, user_id: str, goal_id: int) -> bool:
        """Hard-delete a goal. The DB RESTRICTs if projects reference it."""
        try:
            result = (
                self.supabase.table("goals")
                .delete()
                .eq("id", goal_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(result.data)
        except Exception as exc:
            self.logger.exception("delete_goal failed: %s", exc)
            return False

    # ── Calendar subscriptions ──────────────────────────────────────────────

    def list_calendar_subscriptions(self, user_id: str) -> List[Dict[str, Any]]:
        """Return all calendar subscriptions for a user, oldest first."""
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .select(CALENDAR_SUBSCRIPTION_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .order("created_at", desc=False)
                .execute()
            )
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_calendar_subscriptions failed: %s", exc)
            return []

    def get_calendar_subscription(
        self, user_id: str, subscription_id: int
    ) -> Optional[Dict[str, Any]]:
        """Return a single calendar subscription owned by the user."""
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .select(CALENDAR_SUBSCRIPTION_SELECT_COLUMNS)
                .eq("id", subscription_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_calendar_subscription failed: %s", exc)
            return None

    def get_calendar_subscription_internal(
        self, subscription_id: int
    ) -> Optional[Dict[str, Any]]:
        """Return a calendar subscription by id (no user scoping).

        For background-sync use only — not exposed to HTTP routes.
        """
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .select(CALENDAR_SUBSCRIPTION_SELECT_COLUMNS)
                .eq("id", subscription_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_calendar_subscription_internal failed: %s", exc)
            return None

    def list_enabled_calendar_subscription_ids(self) -> List[int]:
        """Return ids of all enabled subscriptions across all users."""
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .select("id")
                .eq("enabled", True)
                .execute()
            )
            rows = [cast(Dict[str, Any], r) for r in (result.data or [])]
            return [int(row["id"]) for row in rows]
        except Exception as exc:
            self.logger.exception(
                "list_enabled_calendar_subscription_ids failed: %s", exc
            )
            return []

    def create_calendar_subscription(
        self,
        user_id: str,
        name: str,
        url: str,
        color: str | None = None,
        area_id: int | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a calendar subscription."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "name": name,
                "url": url,
            }
            if color is not None:
                payload["color"] = color
            if area_id is not None:
                payload["area_id"] = area_id
            result = (
                self.supabase.table("calendar_subscriptions").insert(payload).execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("create_calendar_subscription failed: %s", exc)
            return None

    def update_calendar_subscription(
        self, user_id: str, subscription_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a calendar subscription's mutable fields (name, url, color, area_id)."""
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .update(updates)
                .eq("id", subscription_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_calendar_subscription failed: %s", exc)
            return None

    def delete_calendar_subscription(self, user_id: str, subscription_id: int) -> bool:
        """Delete a calendar subscription. Cached events cascade."""
        try:
            result = (
                self.supabase.table("calendar_subscriptions")
                .delete()
                .eq("id", subscription_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(result.data)
        except Exception as exc:
            self.logger.exception("delete_calendar_subscription failed: %s", exc)
            return False

    def mark_calendar_subscription_synced(
        self, subscription_id: int, error: str | None
    ) -> None:
        """Update last_synced_at + last_error for a subscription."""
        try:
            self.supabase.table("calendar_subscriptions").update(
                {
                    "last_synced_at": datetime.now(timezone.utc).isoformat(),
                    "last_error": error,
                }
            ).eq("id", subscription_id).execute()
        except Exception as exc:
            self.logger.warning("mark_calendar_subscription_synced failed: %s", exc)

    # ── Calendar events ─────────────────────────────────────────────────────

    def replace_calendar_events(
        self, subscription_id: int, events: List[Dict[str, Any]]
    ) -> None:
        """Replace all cached events for a subscription with the given list."""
        try:
            self.supabase.table("calendar_events").delete().eq(
                "subscription_id", subscription_id
            ).execute()
            if not events:
                return
            payload = [
                {**event, "subscription_id": subscription_id} for event in events
            ]
            # Insert in chunks to stay well below the PostgREST request limit.
            for i in range(0, len(payload), 500):
                self.supabase.table("calendar_events").insert(
                    payload[i : i + 500]
                ).execute()
        except Exception as exc:
            self.logger.exception("replace_calendar_events failed: %s", exc)

    def list_calendar_events(
        self, user_id: str, start: str, end: str
    ) -> List[Dict[str, Any]]:
        """Return events for the user that overlap [start, end] (ISO timestamps)."""
        try:
            sub_result = (
                self.supabase.table("calendar_subscriptions")
                .select("id, name, color, area_id")
                .eq("user_id", user_id)
                .eq("enabled", True)
                .execute()
            )
            sub_rows = [cast(Dict[str, Any], r) for r in (sub_result.data or [])]
            if not sub_rows:
                return []
            sub_ids = [int(r["id"]) for r in sub_rows]
            sub_meta = {int(r["id"]): r for r in sub_rows}

            # When subscriptions are linked to areas, use the area color.
            area_ids = {
                int(r["area_id"]) for r in sub_rows if r.get("area_id") is not None
            }
            area_colors: Dict[int, str] = {}
            if area_ids:
                area_result = (
                    self.supabase.table("areas")
                    .select("id, color")
                    .in_("id", list(area_ids))
                    .eq("user_id", user_id)
                    .execute()
                )
                for raw_row in area_result.data or []:
                    area_row = cast(Dict[str, Any], raw_row)
                    color_value = area_row.get("color")
                    if color_value is not None:
                        area_colors[int(area_row["id"])] = color_value

            result = (
                self.supabase.table("calendar_events")
                .select(CALENDAR_EVENT_SELECT_COLUMNS)
                .in_("subscription_id", sub_ids)
                .lte("start_at", end)
                .gte("end_at", start)
                .order("start_at", desc=False)
                .execute()
            )
            rows = [cast(Dict[str, Any], r) for r in (result.data or [])]
            for row in rows:
                meta = sub_meta.get(int(row["subscription_id"]))
                if meta:
                    row["subscription_name"] = meta.get("name")
                    area_id = meta.get("area_id")
                    row["subscription_area_id"] = area_id
                    if area_id is not None and area_colors.get(int(area_id)):
                        row["subscription_color"] = area_colors[int(area_id)]
                    else:
                        row["subscription_color"] = meta.get("color")
            return rows
        except Exception as exc:
            self.logger.exception("list_calendar_events failed: %s", exc)
            return []

    # ── Day-plan events: log every time a block is placed on the schedule ──

    def create_day_plan_event(
        self,
        user_id: str,
        *,
        source_kind: str,
        source_id: str,
        title: str,
        block_type: str,
        planned_for: str,
        start_time: str,
        duration_minutes: int,
    ) -> Optional[Dict[str, Any]]:
        """Insert a single planning event and return the row.

        ``source_kind`` is either ``"task"`` or ``"template"``. ``source_id``
        is the originating task id (as string) or template id (e.g. ``"tplD"``).
        Each scheduled block creates exactly one row.
        """
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "source_kind": source_kind,
                "source_id": source_id,
                "title": title,
                "block_type": block_type,
                "planned_for": planned_for,
                "start_time": start_time,
                "duration_minutes": int(duration_minutes),
            }
            result = self.supabase.table("day_plan_events").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("create_day_plan_event failed: %s", exc)
            return None

    def list_day_plan_event_summary(
        self, user_id: str, start: str, end: str
    ) -> List[Dict[str, Any]]:
        """Return a per-day summary of planning events for [start, end].

        Each item:
        ``{"planned_for": "YYYY-MM-DD", "event_count": int, "total_minutes": int}``.

        Days without any event are not included; callers compute "did the
        user plan that day" by membership, and capacity utilisation from
        ``total_minutes``.
        """
        try:
            result = (
                self.supabase.table("day_plan_events")
                .select("planned_for, duration_minutes")
                .eq("user_id", user_id)
                .gte("planned_for", start)
                .lte("planned_for", end)
                .execute()
            )
            counts: Dict[str, int] = {}
            minutes: Dict[str, int] = {}
            for raw in result.data or []:
                row = cast(Dict[str, Any], raw)
                key = row.get("planned_for")
                if not isinstance(key, str):
                    continue
                counts[key] = counts.get(key, 0) + 1
                try:
                    dur = int(row.get("duration_minutes") or 0)
                except (TypeError, ValueError):
                    dur = 0
                if dur > 0:
                    minutes[key] = minutes.get(key, 0) + dur
            return [
                {
                    "planned_for": k,
                    "event_count": counts[k],
                    "total_minutes": minutes.get(k, 0),
                }
                for k in sorted(counts.keys())
            ]
        except Exception as exc:
            self.logger.exception("list_day_plan_event_summary failed: %s", exc)
            return []

    def list_day_capacity_breakdown(
        self, user_id: str, start: str, end: str
    ) -> List[Dict[str, Any]]:
        """Return per-day planned minutes broken down by block type.

        Combines two sources:
          1. ``day_plan_events`` rows (tasks + templates the user dragged
             onto the schedule), where ``block_type`` is already stored.
          2. ``calendar_events`` for the user's enabled subscriptions, with
             type derived from a description shortcode (DEEP/MEET/FAM —
             default ``meeting``).

        Output: ``[{"date": "YYYY-MM-DD", "focus": int, "meeting": int,
                  "family": int, "rust": int}, ...]`` (only days with data).
        """
        import re as _re

        bucket: Dict[str, Dict[str, int]] = {}

        def _add(date: str, block_type: str, minutes: int) -> None:
            if minutes <= 0:
                return
            entry = bucket.setdefault(
                date, {"focus": 0, "meeting": 0, "family": 0, "rust": 0}
            )
            key = block_type if block_type in entry else "meeting"
            entry[key] += minutes

        # 1) day_plan_events
        try:
            plan_result = (
                self.supabase.table("day_plan_events")
                .select("planned_for, block_type, duration_minutes")
                .eq("user_id", user_id)
                .gte("planned_for", start)
                .lte("planned_for", end)
                .execute()
            )
            for raw in plan_result.data or []:
                row = cast(Dict[str, Any], raw)
                date = row.get("planned_for")
                btype = row.get("block_type") or "meeting"
                try:
                    mins = int(row.get("duration_minutes") or 0)
                except (TypeError, ValueError):
                    mins = 0
                if isinstance(date, str):
                    _add(date, btype, mins)
        except Exception as exc:
            self.logger.exception("capacity day_plan_events failed: %s", exc)

        # 2) calendar_events from this user's enabled subscriptions
        try:
            sub_result = (
                self.supabase.table("calendar_subscriptions")
                .select("id")
                .eq("user_id", user_id)
                .eq("enabled", True)
                .execute()
            )
            sub_ids = [
                int(cast(Dict[str, Any], r)["id"])
                for r in sub_result.data or []
                if cast(Dict[str, Any], r).get("id") is not None
            ]
            if sub_ids:
                # Pull events that touch the [start, end] window.
                ev_result = (
                    self.supabase.table("calendar_events")
                    .select("subscription_id, description, start_at, end_at, all_day")
                    .in_("subscription_id", sub_ids)
                    .lte("start_at", f"{end}T23:59:59+00:00")
                    .gte("end_at", f"{start}T00:00:00+00:00")
                    .execute()
                )
                fam_re = _re.compile(r"\bFAM\b", _re.IGNORECASE)
                deep_re = _re.compile(r"\bDEEP\b", _re.IGNORECASE)
                meet_re = _re.compile(r"\bMEET\b", _re.IGNORECASE)
                for raw in ev_result.data or []:
                    row = cast(Dict[str, Any], raw)
                    if row.get("all_day"):
                        continue
                    start_at = row.get("start_at")
                    end_at = row.get("end_at")
                    if not isinstance(start_at, str) or not isinstance(end_at, str):
                        continue
                    try:
                        sdt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
                        edt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    delta_min = int((edt - sdt).total_seconds() // 60)
                    if delta_min <= 0:
                        continue
                    date = start_at[:10]
                    desc = (row.get("description") or "") or ""
                    if deep_re.search(desc):
                        btype = "focus"
                    elif fam_re.search(desc):
                        btype = "family"
                    elif meet_re.search(desc):
                        btype = "meeting"
                    else:
                        btype = "meeting"
                    _add(date, btype, delta_min)
        except Exception as exc:
            self.logger.exception("capacity calendar_events failed: %s", exc)

        return [
            {"date": k, **bucket[k]} for k in sorted(bucket.keys()) if start <= k <= end
        ]

    # ── Timer: active sessions, time entries, pomodoro settings ─────────────

    def get_active_session(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Return the user's currently active session row, or None."""
        try:
            result = (
                self.supabase.table("active_sessions")
                .select(ACTIVE_SESSION_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_active_session failed: %s", exc)
            return None

    def upsert_active_session(
        self,
        user_id: str,
        task_id: int | None,
        kind: str,
        started_at: str,
        phase_seconds: int | None,
        cycle_index: int,
    ) -> Optional[Dict[str, Any]]:
        """Create or replace the user's active session."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "task_id": task_id,
                "kind": kind,
                "started_at": started_at,
                "phase_seconds": phase_seconds,
                "cycle_index": cycle_index,
            }
            result = (
                self.supabase.table("active_sessions")
                .upsert(payload, on_conflict="user_id")
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("upsert_active_session failed: %s", exc)
            return None

    def clear_active_session(self, user_id: str) -> None:
        """Remove the user's active session row, if any."""
        try:
            self.supabase.table("active_sessions").delete().eq(
                "user_id", user_id
            ).execute()
        except Exception as exc:
            self.logger.warning("clear_active_session failed: %s", exc)

    def insert_time_entry(
        self,
        user_id: str,
        task_id: int | None,
        kind: str,
        started_at: str,
        ended_at: str,
        interrupted: bool = False,
        notes: str | None = None,
        task_title_snapshot: str | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Insert a completed time entry."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "task_id": task_id,
                "task_title_snapshot": task_title_snapshot,
                "kind": kind,
                "started_at": started_at,
                "ended_at": ended_at,
                "interrupted": interrupted,
                "notes": notes,
            }
            result = self.supabase.table("time_entries").insert(payload).execute()
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("insert_time_entry failed: %s", exc)
            return None

    def list_time_entries(
        self,
        user_id: str,
        task_id: int | None = None,
        start: str | None = None,
        end: str | None = None,
        limit: int | None = None,
    ) -> List[Dict[str, Any]]:
        """List time entries for a user, optionally filtered by task and date range."""
        try:
            query = (
                self.supabase.table("time_entries")
                .select(TIME_ENTRY_SELECT_COLUMNS)
                .eq("user_id", user_id)
            )
            if task_id is not None:
                query = query.eq("task_id", task_id)
            if start is not None:
                query = query.gte("started_at", start)
            if end is not None:
                query = query.lte("started_at", end)
            query = query.order("started_at", desc=True)
            if limit is not None:
                query = query.limit(limit)
            result = query.execute()
            return [cast(Dict[str, Any], row) for row in (result.data or [])]
        except Exception as exc:
            self.logger.exception("list_time_entries failed: %s", exc)
            return []

    def get_time_entry(self, user_id: str, entry_id: int) -> Optional[Dict[str, Any]]:
        """Return a single time entry owned by the user."""
        try:
            result = (
                self.supabase.table("time_entries")
                .select(TIME_ENTRY_SELECT_COLUMNS)
                .eq("id", entry_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            return cast(Dict[str, Any], result.data[0])
        except Exception as exc:
            self.logger.exception("get_time_entry failed: %s", exc)
            return None

    def update_time_entry(
        self, user_id: str, entry_id: int, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a time entry's mutable fields (started_at, ended_at, notes)."""
        try:
            result = (
                self.supabase.table("time_entries")
                .update(updates)
                .eq("id", entry_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_time_entry failed: %s", exc)
            return None

    def delete_time_entry(self, user_id: str, entry_id: int) -> bool:
        """Delete a time entry owned by the user."""
        try:
            result = (
                self.supabase.table("time_entries")
                .delete()
                .eq("id", entry_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(result.data)
        except Exception as exc:
            self.logger.exception("delete_time_entry failed: %s", exc)
            return False

    def get_pomodoro_settings(self, user_id: str) -> Dict[str, Any]:
        """Return the user's pomodoro settings, creating defaults on first read."""
        try:
            result = (
                self.supabase.table("pomodoro_settings")
                .select(POMODORO_SETTINGS_SELECT_COLUMNS)
                .eq("user_id", user_id)
                .execute()
            )
            if result.data:
                return cast(Dict[str, Any], result.data[0])
            # First-time user — insert defaults so subsequent reads are stable.
            insert_payload: Dict[str, Any] = {"user_id": user_id}
            inserted = (
                self.supabase.table("pomodoro_settings")
                .insert(insert_payload)
                .execute()
            )
            if inserted.data:
                if isinstance(inserted.data, list):
                    return cast(Dict[str, Any], inserted.data[0])
                return cast(Dict[str, Any], inserted.data)
        except Exception as exc:
            self.logger.exception("get_pomodoro_settings failed: %s", exc)
        # Fallback: return an in-memory default so the API never 500s.
        return {
            "user_id": user_id,
            "focus_minutes": 25,
            "short_break_minutes": 5,
            "long_break_minutes": 15,
            "cycles_per_long_break": 4,
            "auto_start_breaks": True,
            "auto_start_focus": False,
            "sound_enabled": True,
        }

    def update_pomodoro_settings(
        self, user_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update the user's pomodoro settings (creates row if missing)."""
        try:
            payload = {"user_id": user_id, **updates}
            result = (
                self.supabase.table("pomodoro_settings")
                .upsert(payload, on_conflict="user_id")
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
        except Exception as exc:
            self.logger.exception("update_pomodoro_settings failed: %s", exc)
            return None

    def time_summary(
        self,
        user_id: str,
        start: str,
        end: str,
        group_by: str,
    ) -> List[Dict[str, Any]]:
        """Aggregate time entries in [start, end] by the given grouping.

        Returns rows of {key, label, total_seconds, pomodoro_count}. The
        actual aggregation is done in Python after fetching the entries —
        Supabase's REST surface doesn't expose GROUP BY directly. The
        time_entries.user_started_idx index keeps the read fast.
        """
        try:
            entries = self.list_time_entries(user_id, start=start, end=end)
            if not entries:
                return []
            # Build label maps for grouping that needs joins.
            tasks_by_id: Dict[int, Dict[str, Any]] = {}
            projects_by_id: Dict[int, Dict[str, Any]] = {}
            areas_by_id: Dict[int, Dict[str, Any]] = {}
            if group_by in {"task", "project", "area"}:
                tasks = self.list_tasks(user_id)
                tasks_by_id = {int(t["id"]): t for t in tasks if t.get("id")}
                if group_by in {"project", "area"}:
                    project_result = (
                        self.supabase.table("projects")
                        .select("id, name, area_id")
                        .eq("user_id", user_id)
                        .execute()
                    )
                    project_rows = [
                        cast(Dict[str, Any], r) for r in (project_result.data or [])
                    ]
                    projects_by_id = {int(p["id"]): p for p in project_rows}
                if group_by == "area":
                    area_result = (
                        self.supabase.table("areas")
                        .select("id, name, color")
                        .eq("user_id", user_id)
                        .execute()
                    )
                    area_rows = [
                        cast(Dict[str, Any], r) for r in (area_result.data or [])
                    ]
                    areas_by_id = {int(a["id"]): a for a in area_rows}

            buckets: Dict[str, Dict[str, Any]] = {}

            def bump(key: str, label: str, seconds: int, is_focus: bool) -> None:
                bucket = buckets.setdefault(
                    key,
                    {
                        "key": key,
                        "label": label,
                        "total_seconds": 0,
                        "pomodoro_count": 0,
                    },
                )
                bucket["total_seconds"] += seconds
                if is_focus:
                    bucket["pomodoro_count"] += 1

            for entry in entries:
                seconds = int(entry.get("duration_seconds") or 0)
                is_focus = entry.get("kind") == "pomodoro_focus"
                kind = entry.get("kind") or "stopwatch"
                started = str(entry.get("started_at") or "")[:10]
                task_id = entry.get("task_id")

                if group_by == "day":
                    bump(started, started, seconds, is_focus)
                elif group_by == "kind":
                    bump(kind, kind, seconds, is_focus)
                elif group_by == "task":
                    if task_id is not None and int(task_id) in tasks_by_id:
                        t = tasks_by_id[int(task_id)]
                        bump(str(task_id), str(t.get("title", "?")), seconds, is_focus)
                    else:
                        label = entry.get("task_title_snapshot") or "(verwijderd)"
                        bump(f"deleted:{task_id}", str(label), seconds, is_focus)
                elif group_by == "project":
                    project_id = None
                    if task_id is not None and int(task_id) in tasks_by_id:
                        project_id = tasks_by_id[int(task_id)].get("project_id")
                    if project_id is not None and int(project_id) in projects_by_id:
                        p = projects_by_id[int(project_id)]
                        bump(
                            str(project_id),
                            str(p.get("name", "?")),
                            seconds,
                            is_focus,
                        )
                    else:
                        bump("none", "Geen project", seconds, is_focus)
                elif group_by == "area":
                    area_id = None
                    if task_id is not None and int(task_id) in tasks_by_id:
                        area_id = tasks_by_id[int(task_id)].get("area_id")
                        if area_id is None:
                            project_id = tasks_by_id[int(task_id)].get("project_id")
                            if (
                                project_id is not None
                                and int(project_id) in projects_by_id
                            ):
                                area_id = projects_by_id[int(project_id)].get("area_id")
                    if area_id is not None and int(area_id) in areas_by_id:
                        a = areas_by_id[int(area_id)]
                        bump(str(area_id), str(a.get("name", "?")), seconds, is_focus)
                    else:
                        bump("none", "Geen gebied", seconds, is_focus)
                else:
                    raise ValueError(f"unknown group_by: {group_by}")

            ordered = sorted(
                buckets.values(),
                key=lambda b: (b["key"] if group_by == "day" else -b["total_seconds"]),
            )
            return ordered
        except Exception as exc:
            self.logger.exception("time_summary failed: %s", exc)
            return []

    # ── Week availability ────────────────────────────────────────────────────

    def get_week_availability(
        self, user_id: str, week_start: str, week_end: str
    ) -> Dict[str, float]:
        """Return {day_date: hours} for all days in [week_start, week_end].

        Missing days are filled with defaults: 8 h Mon–Fri, 0 h Sat–Sun.
        """
        from datetime import date, timedelta

        defaults: Dict[str, float] = {}
        start = date.fromisoformat(week_start)
        end = date.fromisoformat(week_end)
        cursor = start
        while cursor <= end:
            # weekday(): Mon=0 … Sun=6
            defaults[cursor.isoformat()] = 0.0 if cursor.weekday() >= 5 else 8.0
            cursor += timedelta(days=1)

        try:
            result = (
                self.supabase.table("week_availability")
                .select("day_date, hours")
                .eq("user_id", user_id)
                .gte("day_date", week_start)
                .lte("day_date", week_end)
                .execute()
            )
            for row in result.data or []:
                typed_row = cast(Dict[str, Any], row)
                defaults[str(typed_row["day_date"])] = float(typed_row["hours"])
        except Exception as exc:
            self.logger.exception("get_week_availability failed: %s", exc)

        return defaults

    def upsert_week_availability(self, user_id: str, days: Dict[str, float]) -> bool:
        """Upsert one row per day in *days* ({day_date: hours}).

        Handles the unique constraint (user_id, day_date) via ON CONFLICT.
        """
        if not days:
            return True
        payload: List[Dict[str, Any]] = [
            {"user_id": user_id, "day_date": day, "hours": hours}
            for day, hours in days.items()
        ]
        try:
            self.supabase.table("week_availability").upsert(
                cast(Any, payload), on_conflict="user_id,day_date"
            ).execute()
            return True
        except Exception as exc:
            self.logger.exception("upsert_week_availability failed: %s", exc)
            return False


supabase_service = SupabaseService()
