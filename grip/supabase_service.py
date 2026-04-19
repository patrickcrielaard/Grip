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
    "planned_date, start_date, duration, recurrence_interval, recurrence_unit, "
    "recurrence_end, state, project_id"
)
PROJECT_SELECT_COLUMNS = (
    "id, name, start_date, end_date, created_at, status, area_id, goal_id"
)
AREA_SELECT_COLUMNS = "id, name, color, description, status, created_at"
GOAL_SELECT_COLUMNS = (
    "id, area_id, name, description, start_date, end_date, status, created_at"
)

AREA_STATUSES = {"active", "archived"}
GOAL_STATUSES = {"active", "completed", "archived"}


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


supabase_service = SupabaseService()
