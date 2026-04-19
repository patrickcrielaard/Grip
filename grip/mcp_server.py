"""MCP server for Grip — exposes todo CRUD tools over stdio and HTTP transports."""

from __future__ import annotations

import os
import re
import secrets
import time
from typing import Any

from fastapi import HTTPException
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
)
from mcp.server.auth.routes import build_metadata
from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyHttpUrl
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse as StarletteJSONResponse

from grip.routes.todos import (
    DEFAULT_LIST,
    DEFAULT_PRIORITY,
    DEFAULT_STATE,
    _advance_planned_date,
    _normalize_date,
    _normalize_duration,
    _normalize_list_name,
    _normalize_priority,
    _normalize_recurrence,
    _normalize_state,
    _resolve_area_id,
    _validate_project_id,
)
from grip.supabase_service import AREA_STATUSES, GOAL_STATUSES, supabase_service


# ── User ID resolution ──────────────────────────────────────────────────────


def _user_id() -> str:
    """Return the current user ID.

    HTTP mode: reads from FastMCP OAuth auth context (client_id stores user UUID).
    stdio mode: reads from GRIP_MCP_USER_ID env var.
    """
    token = get_access_token()
    if token:
        return token.client_id  # load_access_token stores user UUID here
    env_id = os.environ.get("GRIP_MCP_USER_ID")
    if env_id:
        return env_id
    raise RuntimeError("No user ID in context. Set GRIP_MCP_USER_ID for stdio mode.")


# ── OAuth provider ──────────────────────────────────────────────────────────


class GripOAuthProvider:
    """OAuth 2.0 authorization server backed by the Grip user database.

    Uses in-memory storage for clients and auth codes (both are short-lived).
    Access tokens are the per-user mcp_token stored in Supabase.
    """

    def __init__(self, app_base_url: str) -> None:
        self._app_base_url = app_base_url.rstrip("/")
        self._clients: dict[str, OAuthClientInformationFull] = {}
        # code -> (AuthorizationCode, user_id)
        self._auth_codes: dict[str, tuple[AuthorizationCode, str]] = {}
        # nonce -> pending OAuth params (before user logs in)
        self._pending: dict[str, dict[str, Any]] = {}

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if client_info.client_id:
            self._clients[client_info.client_id] = client_info

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Redirect to the Grip login page using a one-time nonce to pass OAuth params."""
        nonce = secrets.token_urlsafe(32)
        self._pending[nonce] = {
            "client_id": client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "state": params.state,
            "code_challenge": params.code_challenge,
            "scopes": params.scopes or [],
            "resource": params.resource,
            "expires_at": time.time() + 600,  # 10-minute window
        }
        return f"{self._app_base_url}/mcp-login?nonce={nonce}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        entry = self._auth_codes.get(authorization_code)
        if entry and entry[0].expires_at > time.time():
            return entry[0]
        return None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        import logging as _logging

        _log = _logging.getLogger("grip.oauth")
        entry = self._auth_codes.pop(authorization_code.code, None)
        if not entry:
            _log.error("exchange_authorization_code: auth code not found")
            raise TokenError(error="invalid_grant", error_description="Code not found")
        _, user_id = entry
        mcp_token = supabase_service.get_mcp_token(user_id)
        if not mcp_token:
            _log.error(
                "exchange_authorization_code: mcp_token is NULL for user %s — "
                "did you run the Supabase migration to add the mcp_token column?",
                user_id,
            )
            raise TokenError(
                error="invalid_grant", error_description="User token not found"
            )
        return OAuthToken(access_token=mcp_token)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return None  # no refresh tokens issued

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        raise TokenError(error="unsupported_grant_type")

    async def load_access_token(self, token: str) -> AccessToken | None:
        user = supabase_service.get_user_by_mcp_token(token)
        if not user:
            return None
        # Store user UUID in client_id so _user_id() can read it without a second DB lookup
        return AccessToken(token=token, client_id=user["id"], scopes=["todos"])

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        pass  # mcp_tokens are permanent; revocation could be added later

    # ── helpers for the login page handler ──

    def get_pending(self, nonce: str) -> dict[str, Any] | None:
        """Peek at a pending auth session; returns None if expired or unknown."""
        p = self._pending.get(nonce)
        if p is None:
            return None
        if p["expires_at"] < time.time():
            self._pending.pop(nonce, None)
            return None
        return p

    def pop_pending(self, nonce: str) -> dict[str, Any] | None:
        """Pop and return a pending auth session; returns None if expired or unknown."""
        p = self._pending.pop(nonce, None)
        if p and p["expires_at"] < time.time():
            return None
        return p

    def store_auth_code(
        self, code: str, auth_code: AuthorizationCode, user_id: str
    ) -> None:
        self._auth_codes[code] = (auth_code, user_id)


# ── App base URL ─────────────────────────────────────────────────────────────


def _get_app_base_url() -> str:
    """Derive the public app URL from Railway env vars or APP_BASE_URL."""
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    if domain:
        return f"https://{domain}"
    return os.environ.get("APP_BASE_URL", "http://localhost:8000")


_app_base_url = _get_app_base_url()
_mcp_url = f"{_app_base_url}/mcp"

oauth_provider = GripOAuthProvider(app_base_url=_app_base_url)

# streamable_http_path="/" — FastAPI strips the /mcp mount prefix before handing
# off to the sub-app, so the sub-app must route at "/" not "/mcp".
# transport_security disabled — FastMCP auto-enables localhost-only DNS rebinding
# protection by default; that blocks Railway/public HTTPS requests.
mcp = FastMCP(
    "Grip",
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    auth_server_provider=oauth_provider,
    auth=AuthSettings(
        issuer_url=_mcp_url,  # type: ignore[arg-type]  # Pydantic coerces str -> AnyHttpUrl
        resource_server_url=_mcp_url,  # type: ignore[arg-type]
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=["todos"],
            default_scopes=["todos"],
        ),
        required_scopes=["todos"],
    ),
)

# Build metadata once; exported so app.py can serve it at the RFC 8414 canonical
# discovery paths (/.well-known/oauth-authorization-server/mcp etc.) that Claude
# Desktop looks for at the root domain — FastMCP only registers these inside the
# sub-app, which Starlette mounts under /mcp, so they end up at the wrong URLs.
_oauth_metadata = build_metadata(
    issuer_url=AnyHttpUrl(_mcp_url),
    service_documentation_url=None,
    client_registration_options=ClientRegistrationOptions(
        enabled=True,
        valid_scopes=["todos"],
        default_scopes=["todos"],
    ),
    revocation_options=RevocationOptions(),
)


# Claude Desktop also probes /mcp/.well-known/openid-configuration (OIDC discovery).
# This custom route lives inside the sub-app, so it becomes reachable at that path.
@mcp.custom_route("/.well-known/openid-configuration", methods=["GET"])  # type: ignore[untyped-decorator]
async def _oidc_discovery(request: StarletteRequest) -> StarletteJSONResponse:
    return StarletteJSONResponse(
        _oauth_metadata.model_dump(mode="json", exclude_none=True)
    )


# ── Helper ───────────────────────────────────────────────────────────────────


def _v(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Convert HTTPException from _normalize_* helpers into ValueError."""
    try:
        return fn(*args, **kwargs)
    except HTTPException as e:
        raise ValueError(e.detail) from e


# ── MCP tools ────────────────────────────────────────────────────────────────


@mcp.tool()
def list_todos() -> list[dict[str, Any]]:
    """Return all todos for the configured user, newest first."""
    return supabase_service.list_tasks(_user_id())


@mcp.tool()
def create_todo(
    title: str,
    list: str = DEFAULT_LIST,
    area_id: int | None = None,
    priority: str = DEFAULT_PRIORITY,
    deadline: str | None = None,
    planned_date: str | None = None,
    start_date: str | None = None,
    duration: int | None = None,
    recurrence_interval: int | None = None,
    recurrence_unit: str | None = None,
    recurrence_end: str | None = None,
    state: str = DEFAULT_STATE,
    project_id: int | None = None,
) -> dict[str, Any]:
    """
    Create a new todo.
    list: "inbox" (default) | "today"
    area_id: optional id of the Life Area (see list_areas). Omit for no area.
    priority: "not_set" (default) | "low" | "medium" | "high"
    deadline / planned_date / start_date / recurrence_end: YYYY-MM-DD strings
    duration: minutes as an integer
    recurrence_interval + recurrence_unit must be set together; unit: "day" | "week" | "month"
    state: "to_do" (default) | "in_progress" | "done" | "waiting" | "someday"
    project_id: optional project id to assign the todo to
    """
    title = title.strip()
    if not title:
        raise ValueError("title is required")
    if project_id is not None:
        _v(_validate_project_id, _user_id(), project_id)
    resolved_area_id = _v(_resolve_area_id, _user_id(), area_id)
    ri, ru = _v(_normalize_recurrence, recurrence_interval, recurrence_unit)
    todo = supabase_service.create_task(
        _user_id(),
        title,
        _v(_normalize_list_name, list) or DEFAULT_LIST,
        resolved_area_id,
        _v(_normalize_priority, priority),
        deadline=_v(_normalize_date, deadline, "deadline"),
        planned_date=_v(_normalize_date, planned_date, "planned_date"),
        start_date=_v(_normalize_date, start_date, "start_date"),
        duration=_v(_normalize_duration, duration),
        recurrence_interval=ri,
        recurrence_unit=ru,
        recurrence_end=_v(_normalize_date, recurrence_end, "recurrence_end"),
        state=_v(_normalize_state, state),
        project_id=project_id,
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
    area_id: int | None = None,
    priority: str | None = None,
    deadline: str | None = None,
    planned_date: str | None = None,
    start_date: str | None = None,
    duration: int | None = None,
    recurrence_interval: int | None = None,
    recurrence_unit: str | None = None,
    recurrence_end: str | None = None,
    state: str | None = None,
    project_id: int | None = None,
) -> dict[str, Any]:
    """
    Update one or more fields on an existing todo.
    Only supplied fields are changed.
    Setting state="done" auto-sets completed=true and vice versa.
    area_id: set to an Area id, or 0 to clear the area.
    project_id: set to assign to a project, or 0 to remove from project.
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
    if area_id is not None:
        if area_id <= 0:
            updates["area_id"] = None
        else:
            updates["area_id"] = _v(_resolve_area_id, _user_id(), area_id)
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
    if project_id is not None:
        if project_id <= 0:
            updates["project_id"] = None
        else:
            _v(_validate_project_id, _user_id(), project_id)
            updates["project_id"] = project_id

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
                    current.get("area_id"),
                    current.get("priority", "not_set"),
                    deadline=current.get("deadline"),
                    planned_date=next_date,
                    start_date=current.get("start_date"),
                    duration=current.get("duration"),
                    recurrence_interval=current["recurrence_interval"],
                    recurrence_unit=current["recurrence_unit"],
                    recurrence_end=rec_end,
                    project_id=current.get("project_id"),
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


@mcp.tool()
def list_projects() -> list[dict[str, Any]]:
    """Return all projects for the configured user, newest first."""
    return supabase_service.list_projects(_user_id())


@mcp.tool()
def create_project(
    name: str,
    start_date: str | None = None,
    end_date: str | None = None,
    area_id: int | None = None,
    goal_id: int | None = None,
) -> dict[str, Any]:
    """
    Create a new project.
    name: 1-280 characters.
    start_date / end_date: optional YYYY-MM-DD strings. If both provided, start_date must be <= end_date.
    area_id: optional Life Area id. Ignored if goal_id is set (inherited from goal).
    goal_id: optional Goal id. If set, the project inherits the goal's area automatically.
    """
    name = name.strip()
    if not name:
        raise ValueError("name is required")
    if len(name) > 280:
        raise ValueError("name must be 280 characters or fewer")
    sd = _v(_normalize_date, start_date, "start_date")
    ed = _v(_normalize_date, end_date, "end_date")
    if sd and ed and sd > ed:
        raise ValueError("start_date must be on or before end_date")

    resolved_area_id = area_id
    if goal_id is not None:
        goal = supabase_service.get_goal(_user_id(), goal_id)
        if not goal:
            raise ValueError(f"goal {goal_id} not found")
        resolved_area_id = goal["area_id"]
    elif area_id is not None:
        area = supabase_service.get_area(_user_id(), area_id)
        if not area:
            raise ValueError(f"area {area_id} not found")

    project = supabase_service.create_project(
        _user_id(),
        name,
        start_date=sd,
        end_date=ed,
        area_id=resolved_area_id,
        goal_id=goal_id,
    )
    if project is None:
        raise RuntimeError("create_project failed")
    return project


@mcp.tool()
def delete_project(project_id: int) -> dict[str, Any]:
    """Permanently delete a project by id. Tasks in the project are kept but their project_id is cleared."""
    if not supabase_service.delete_project(_user_id(), project_id):
        raise RuntimeError(f"Project {project_id} not found")
    return {"deleted": True}


@mcp.tool()
def update_project_status(project_id: int, status: str) -> dict[str, Any]:
    """Update a project's status. Status can be 'active', 'completed', or 'deleted'."""
    if status not in ("active", "completed", "deleted"):
        raise ValueError("status must be 'active', 'completed', or 'deleted'")
    if not supabase_service.update_project_status(_user_id(), project_id, status):
        raise RuntimeError(f"Project {project_id} not found")
    return {"status": status}


# ── Areas ────────────────────────────────────────────────────────────────────


_COLOR_RE_MCP = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _validate_color(color: str) -> str:
    value = color.strip()
    if not _COLOR_RE_MCP.match(value):
        raise ValueError("color must be a hex string like #2E7D32")
    return value


@mcp.tool()
def list_areas() -> list[dict[str, Any]]:
    """Return all Life Areas (Work, Personal, Health…) for the configured user."""
    return supabase_service.list_areas(_user_id())


@mcp.tool()
def create_area(
    name: str,
    color: str,
    description: str | None = None,
) -> dict[str, Any]:
    """
    Create a new Life Area.
    name: 1-120 characters, unique per user (case-insensitive).
    color: hex string like "#2E7D32".
    description: optional free-text description.
    """
    name = name.strip()
    if not name:
        raise ValueError("name is required")
    if len(name) > 120:
        raise ValueError("name must be 120 characters or fewer")
    validated_color = _validate_color(color)
    desc = description.strip() if description else None
    area = supabase_service.create_area(
        _user_id(), name, validated_color, description=desc or None
    )
    if area is None:
        raise RuntimeError("create_area failed (duplicate name?)")
    return area


@mcp.tool()
def update_area(
    area_id: int,
    name: str | None = None,
    color: str | None = None,
    description: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """
    Update a Life Area's mutable fields.
    status: "active" or "archived".
    Only supplied fields are changed.
    """
    updates: dict[str, Any] = {}
    if name is not None:
        n = name.strip()
        if not n:
            raise ValueError("name cannot be empty")
        if len(n) > 120:
            raise ValueError("name must be 120 characters or fewer")
        updates["name"] = n
    if color is not None:
        updates["color"] = _validate_color(color)
    if description is not None:
        d = description.strip()
        updates["description"] = d or None
    if status is not None:
        if status not in AREA_STATUSES:
            raise ValueError("status must be 'active' or 'archived'")
        updates["status"] = status
    if not updates:
        raise ValueError("No fields to update were provided")
    existing = supabase_service.get_area(_user_id(), area_id)
    if not existing:
        raise RuntimeError(f"Area {area_id} not found")
    result = supabase_service.update_area(_user_id(), area_id, updates)
    if result is None:
        raise RuntimeError(f"Failed to update area {area_id}")
    return result


@mcp.tool()
def delete_area(area_id: int) -> dict[str, Any]:
    """
    Permanently delete a Life Area. The database RESTRICTs deletion if the area
    still has goals or projects — archive or reparent them first.
    """
    existing = supabase_service.get_area(_user_id(), area_id)
    if not existing:
        raise RuntimeError(f"Area {area_id} not found")
    if not supabase_service.delete_area(_user_id(), area_id):
        raise RuntimeError(
            f"Area {area_id} still has goals or projects — archive or reparent them first"
        )
    return {"deleted": True}


# ── Goals ────────────────────────────────────────────────────────────────────


@mcp.tool()
def list_goals(area_id: int | None = None) -> list[dict[str, Any]]:
    """Return goals for the configured user, optionally filtered by area_id."""
    return supabase_service.list_goals(_user_id(), area_id=area_id)


@mcp.tool()
def create_goal(
    area_id: int,
    name: str,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    """
    Create a new Goal under a Life Area.
    area_id: required — goals always live in an area.
    name: 1-280 characters.
    start_date / end_date: optional YYYY-MM-DD strings.
    """
    name = name.strip()
    if not name:
        raise ValueError("name is required")
    if len(name) > 280:
        raise ValueError("name must be 280 characters or fewer")
    area = supabase_service.get_area(_user_id(), area_id)
    if not area:
        raise ValueError(f"area {area_id} not found")
    sd = _v(_normalize_date, start_date, "start_date")
    ed = _v(_normalize_date, end_date, "end_date")
    if sd and ed and sd > ed:
        raise ValueError("start_date must be on or before end_date")
    desc = description.strip() if description else None
    goal = supabase_service.create_goal(
        _user_id(),
        area_id,
        name,
        description=desc or None,
        start_date=sd,
        end_date=ed,
    )
    if goal is None:
        raise RuntimeError("create_goal failed")
    return goal


@mcp.tool()
def update_goal(
    goal_id: int,
    area_id: int | None = None,
    name: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """
    Update a Goal's mutable fields.
    area_id: moving a goal between areas also rewrites dependent projects (via DB trigger).
    status: "active" | "completed" | "archived".
    Only supplied fields are changed.
    """
    existing = supabase_service.get_goal(_user_id(), goal_id)
    if not existing:
        raise RuntimeError(f"Goal {goal_id} not found")
    updates: dict[str, Any] = {}
    if area_id is not None:
        area = supabase_service.get_area(_user_id(), area_id)
        if not area:
            raise ValueError(f"area {area_id} not found")
        updates["area_id"] = area_id
    if name is not None:
        n = name.strip()
        if not n:
            raise ValueError("name cannot be empty")
        if len(n) > 280:
            raise ValueError("name must be 280 characters or fewer")
        updates["name"] = n
    if description is not None:
        d = description.strip()
        updates["description"] = d or None
    if start_date is not None:
        updates["start_date"] = _v(_normalize_date, start_date, "start_date")
    if end_date is not None:
        updates["end_date"] = _v(_normalize_date, end_date, "end_date")
    if status is not None:
        if status not in GOAL_STATUSES:
            raise ValueError("status must be 'active', 'completed', or 'archived'")
        updates["status"] = status
    if not updates:
        raise ValueError("No fields to update were provided")

    sd = updates.get("start_date", existing.get("start_date"))
    ed = updates.get("end_date", existing.get("end_date"))
    if sd and ed and sd > ed:
        raise ValueError("start_date must be on or before end_date")

    result = supabase_service.update_goal(_user_id(), goal_id, updates)
    if result is None:
        raise RuntimeError(f"Failed to update goal {goal_id}")
    return result


@mcp.tool()
def delete_goal(goal_id: int) -> dict[str, Any]:
    """
    Permanently delete a Goal. The database RESTRICTs deletion if projects
    still reference it — archive or reparent them first.
    """
    existing = supabase_service.get_goal(_user_id(), goal_id)
    if not existing:
        raise RuntimeError(f"Goal {goal_id} not found")
    if not supabase_service.delete_goal(_user_id(), goal_id):
        raise RuntimeError(
            f"Goal {goal_id} still has projects — archive or reparent them first"
        )
    return {"deleted": True}


if __name__ == "__main__":
    mcp.run()
