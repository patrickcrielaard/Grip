"""FastAPI application setup for Grip."""

import asyncio
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
import logging
from typing import Any, AsyncGenerator

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from mcp.server.auth.provider import AuthorizationCode
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from grip.calendar_service import sync_subscription
from grip.configuration import settings
from grip.routes.areas import router as area_router
from grip.routes.authentication import (
    get_or_create_csrf_token,
    limiter,
    require_csrf,
    router as auth_router,
)
from grip.routes.calendar import router as calendar_router
from grip.routes.goals import router as goal_router
from grip.routes.projects import router as project_router
from grip.routes.timer import router as timer_router
from grip.routes.todos import router as todo_router
from grip.supabase_service import supabase_service


class _MCPSlashMiddleware:
    """Rewrite /mcp (without trailing slash) to /mcp/ before routing.

    Starlette's Mount redirects the exact mount path to the same path with a
    trailing slash (307). Claude Desktop doesn't follow POST redirects, so the
    OAuth discovery flow never starts. Rewriting the scope path here prevents
    the redirect entirely.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") == "http" and scope.get("path") == "/mcp":
            scope = {**scope, "path": "/mcp/", "raw_path": b"/mcp/"}
        await self.app(scope, receive, send)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("grip")

BASE_DIR = Path(__file__).parent

# ── MCP HTTP setup ──────────────────────────────────────────────────────────
from grip.mcp_server import _mcp_url, _oauth_metadata, mcp as _grip_mcp, oauth_provider  # noqa: E402

_mcp_sub_app = _grip_mcp.streamable_http_app()  # initialises session manager lazily

_templates = Jinja2Templates(directory=str(BASE_DIR / "web" / "templates"))


CALENDAR_SYNC_INTERVAL_SECONDS = 15 * 60


async def _calendar_sync_loop() -> None:
    """Periodically refresh enabled calendar subscriptions."""
    while True:
        try:
            ids = await asyncio.to_thread(
                supabase_service.list_enabled_calendar_subscription_ids
            )
            for sub_id in ids:
                await asyncio.to_thread(sync_subscription, sub_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — keep loop alive
            logger.warning("calendar sync loop iteration failed: %s", exc)
        await asyncio.sleep(CALENDAR_SYNC_INTERVAL_SECONDS)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with _grip_mcp.session_manager.run():
        sync_task = asyncio.create_task(_calendar_sync_loop())
        try:
            yield
        finally:
            sync_task.cancel()
            try:
                await sync_task
            except asyncio.CancelledError:
                pass


# ── FastAPI app ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Grip", description="A simple to-do application", lifespan=_lifespan
)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    https_only=settings.is_production,
    same_site="lax",
    max_age=60 * 60 * 24 * 7,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

static_dir = BASE_DIR / "web" / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(auth_router)
app.include_router(todo_router)
app.include_router(project_router)
app.include_router(area_router)
app.include_router(goal_router)
app.include_router(calendar_router)
app.include_router(timer_router)

app.mount("/mcp", _mcp_sub_app)
app.add_middleware(_MCPSlashMiddleware)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


_as_metadata_dict: dict[str, Any] = _oauth_metadata.model_dump(
    mode="json", exclude_none=True
)


# The OAuth discovery endpoints below must live at the root domain, not under /mcp.
# FastMCP registers them inside the sub-app, but RFC 8414 and RFC 9728 require them
# at /.well-known/…/<path> where <path> is the issuer's path component ("/mcp").
# Claude Desktop tries all three paths below before giving up.


@app.get("/.well-known/oauth-protected-resource/mcp")
async def mcp_protected_resource_metadata() -> dict[str, Any]:
    """RFC 9728 Protected Resource Metadata — tells clients the AS is at /mcp."""
    return {
        "resource": _mcp_url,
        "authorization_servers": [_mcp_url],
        "scopes_supported": ["todos"],
    }


@app.get("/.well-known/oauth-authorization-server/mcp")
async def mcp_as_metadata() -> dict[str, Any]:
    """RFC 8414 AS Metadata at the canonical root path for issuer https://…/mcp."""
    return _as_metadata_dict


@app.get("/.well-known/openid-configuration/mcp")
async def mcp_oidc_discovery() -> dict[str, Any]:
    """OIDC-style discovery fallback at the canonical root path."""
    return _as_metadata_dict


@app.get("/mcp-login", response_class=HTMLResponse)
async def mcp_login_get(request: Request, nonce: str) -> HTMLResponse:
    """Show OAuth login form for MCP clients (e.g. Claude Desktop)."""
    pending = oauth_provider.get_pending(nonce)
    if not pending:
        return HTMLResponse(
            "Invalid or expired authorization request.", status_code=400
        )
    csrf_token = get_or_create_csrf_token(request)
    return _templates.TemplateResponse(
        "mcp_login.html",
        {
            "request": request,
            "nonce": nonce,
            "error_message": None,
            "csrf_token": csrf_token,
        },
    )


@app.post("/mcp-login")
@limiter.limit("5/minute")
async def mcp_login_post(
    request: Request,
    nonce: str = Form(...),
    username: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
) -> Any:
    """Process OAuth login form and redirect back to the MCP client."""
    try:
        require_csrf(request, csrf_token)
    except HTTPException:
        return HTMLResponse("Invalid CSRF token.", status_code=403)

    pending = oauth_provider.get_pending(nonce)
    if not pending:
        return HTMLResponse(
            "Invalid or expired authorization request.", status_code=400
        )

    user = supabase_service.verify_user(username, password)
    if not user:
        return _templates.TemplateResponse(
            "mcp_login.html",
            {
                "request": request,
                "nonce": nonce,
                "error_message": "Invalid username or password.",
                "csrf_token": get_or_create_csrf_token(request),
            },
            status_code=401,
        )

    # Consume the pending session and issue an authorization code
    oauth_provider.pop_pending(nonce)
    code = secrets.token_urlsafe(32)
    auth_code = AuthorizationCode(
        code=code,
        scopes=pending["scopes"],
        expires_at=time.time() + 600,
        client_id=pending["client_id"],
        code_challenge=pending["code_challenge"],
        redirect_uri=pending["redirect_uri"],
        redirect_uri_provided_explicitly=pending["redirect_uri_provided_explicitly"],
        resource=pending.get("resource"),
    )
    oauth_provider.store_auth_code(code, auth_code, user["id"])

    # Redirect back to the MCP client (e.g. Claude Desktop callback)
    redirect_uri: str = pending["redirect_uri"]
    sep = "&" if "?" in redirect_uri else "?"
    redirect_url = f"{redirect_uri}{sep}code={code}"
    if pending.get("state"):
        redirect_url += f"&state={pending['state']}"

    return RedirectResponse(redirect_url, status_code=302)
