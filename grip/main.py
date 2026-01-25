"""Entry point for running the Grip application."""

import os

import uvicorn

from grip.configuration import settings


def run_server() -> None:
    """Run the FastAPI development or production server."""
    port = int(os.getenv("PORT", "8000"))
    host = "0.0.0.0" if os.getenv("PORT") else "127.0.0.1"  # noqa: S104
    uvicorn.run(
        "grip.app:app",
        host=host,
        port=port,
        reload=settings.is_development,
    )


if __name__ == "__main__":
    run_server()
