"""FastAPI application setup for Grip."""

from contextlib import asynccontextmanager
from pathlib import Path
import logging
from typing import Any

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response as StarletteResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from grip.routes.authentication import router as auth_router
from grip.routes.todos import router as todo_router
from grip.supabase_service import supabase_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("grip")

BASE_DIR = Path(__file__).parent

# ── MCP HTTP setup ──────────────────────────────────────────────────────────
from grip.mcp_server import mcp as _grip_mcp, _user_id_ctx  # noqa: E402

_mcp_sub_app = _grip_mcp.streamable_http_app()  # initialises session manager lazily


class _BearerAuthMiddleware:
    """ASGI wrapper: verify bearer token → inject user ID into ContextVar."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            auth = headers.get(b"authorization", b"").decode()
            if not auth.startswith("Bearer "):
                await StarletteResponse("Unauthorized", status_code=401)(
                    scope, receive, send
                )
                return
            token = auth[7:]
            user = supabase_service.get_user_by_mcp_token(token)
            if not user:
                await StarletteResponse("Unauthorized", status_code=401)(
                    scope, receive, send
                )
                return
            ctx_token = _user_id_ctx.set(user["id"])
            try:
                await self.app(scope, receive, send)
            finally:
                _user_id_ctx.reset(ctx_token)
            return
        await self.app(scope, receive, send)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> Any:
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

app.mount("/mcp", _BearerAuthMiddleware(_mcp_sub_app))


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
