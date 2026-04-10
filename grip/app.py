"""FastAPI application setup for Grip."""

import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
import logging
from typing import Any, AsyncGenerator

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from mcp.server.auth.provider import AuthorizationCode

from grip.routes.authentication import router as auth_router
from grip.routes.todos import router as todo_router
from grip.supabase_service import supabase_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("grip")

BASE_DIR = Path(__file__).parent

# ── MCP HTTP setup ──────────────────────────────────────────────────────────
from grip.mcp_server import _mcp_url, mcp as _grip_mcp, oauth_provider  # noqa: E402

_mcp_sub_app = _grip_mcp.streamable_http_app()  # initialises session manager lazily

_templates = Jinja2Templates(directory=str(BASE_DIR / "web" / "templates"))


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with _grip_mcp.session_manager.run():
        yield


# ── FastAPI app ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Grip", description="A simple to-do application", lifespan=_lifespan
)

static_dir = BASE_DIR / "web" / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(auth_router)
app.include_router(todo_router)

app.mount("/mcp", _mcp_sub_app)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


# FastMCP creates /.well-known/oauth-protected-resource/mcp inside the /mcp sub-app,
# but RFC 9728 requires it at the root domain. Claude Desktop requests it here.
@app.get("/.well-known/oauth-protected-resource/mcp")
async def mcp_protected_resource_metadata() -> dict[str, Any]:
    """OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint."""
    return {
        "resource": _mcp_url,
        "authorization_servers": [_mcp_url],
        "scopes_supported": ["todos"],
    }


@app.get("/mcp-login", response_class=HTMLResponse)
async def mcp_login_get(request: Request, nonce: str) -> HTMLResponse:
    """Show OAuth login form for MCP clients (e.g. Claude Desktop)."""
    pending = oauth_provider.get_pending(nonce)
    if not pending:
        return HTMLResponse(
            "Invalid or expired authorization request.", status_code=400
        )
    return _templates.TemplateResponse(
        "mcp_login.html",
        {"request": request, "nonce": nonce, "error_message": None},
    )


@app.post("/mcp-login")
async def mcp_login_post(
    request: Request,
    nonce: str = Form(...),
    username: str = Form(...),
    password: str = Form(...),
) -> Any:
    """Process OAuth login form and redirect back to the MCP client."""
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
