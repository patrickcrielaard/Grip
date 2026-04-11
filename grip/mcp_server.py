"""MCP server for Grip — exposes todo CRUD tools over stdio and HTTP transports."""

from __future__ import annotations

import os
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
    _normalize_area,
    _normalize_date,
    _normalize_duration,
    _normalize_list_name,
    _normalize_priority,
    _normalize_recurrence,
    _normalize_state,
)
from grip.supabase_service import supabase_service


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
