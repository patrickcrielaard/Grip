"""Supabase service for Grip todo operations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

import bcrypt
import logging
from supabase import Client, create_client

from grip.configuration import settings


class SupabaseService:
    """Service for accessing Grip data via Supabase."""

    def __init__(self) -> None:
        """Initialize Supabase client using configured credentials."""
        self.supabase: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
        self.logger = logging.getLogger("grip.supabase")

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
                .select("id, title, completed, created_at, list, area")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = [cast(Dict[str, Any], row) for row in (result.data or [])]
            for row in rows:
                if not row.get("list"):
                    row["list"] = "inbox"
            return rows
        except Exception as exc:
            self.logger.exception("list_tasks failed: %s", exc)
            return []

    def create_task(
        self, user_id: str, title: str, list_name: str, area: str | None
    ) -> Optional[Dict[str, Any]]:
        """Create a new task."""
        try:
            result = (
                self.supabase.table("tasks")
                .insert(
                    {
                        "user_id": user_id,
                        "title": title,
                        "list": list_name,
                        "area": area,
                    }
                )
                .execute()
            )
            if not result.data:
                return None
            if isinstance(result.data, list):
                row = cast(Dict[str, Any], result.data[0])
            else:
                row = cast(Dict[str, Any], result.data)
            if not row.get("list"):
                row["list"] = list_name
            return row
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
                return cast(Dict[str, Any], result.data[0])
            return cast(Dict[str, Any], result.data)
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
