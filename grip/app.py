"""FastAPI application setup for Grip."""

from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from grip.routes.authentication import router as auth_router
from grip.routes.todos import router as todo_router

app = FastAPI(title="Grip", description="A simple to-do application")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("grip")

BASE_DIR = Path(__file__).parent

static_dir = BASE_DIR / "web" / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

app.include_router(auth_router)
app.include_router(todo_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
