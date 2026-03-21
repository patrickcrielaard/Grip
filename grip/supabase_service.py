"""Supabase service for Grip todo operations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

import bcrypt
import logging
from supabase import Client, create_client

from grip.configuration import settings

TASK_PRIORITIES = {"not_set", "low", "medium", "high"}


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
        if not row.get("list"):
            row["list"] = "inbox"

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
                .select(
                    "id, title, completed, created_at, list, area, priority, deadline, planned_date, start_date, duration"
                )
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

    def create_task(
        self,
        user_id: str,
        title: str,
        list_name: str,
        area: str | None,
        priority: str,
        deadline: str | None = None,
        planned_date: str | None = None,
        start_date: str | None = None,
        duration: int | None = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new task."""
        try:
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "title": title,
                "list": list_name,
                "area": area,
                "priority": priority,
            }
            if deadline is not None:
                payload["deadline"] = deadline
            if planned_date is not None:
                payload["planned_date"] = planned_date
            if start_date is not None:
                payload["start_date"] = start_date
            if duration is not None:
                payload["duration"] = duration
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
