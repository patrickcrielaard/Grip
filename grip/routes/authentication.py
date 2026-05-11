"""Authentication routes for Grip."""

from __future__ import annotations

import hmac
import secrets

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from slowapi import Limiter
from slowapi.util import get_remote_address

from grip.supabase_service import supabase_service


router = APIRouter()

templates = Jinja2Templates(directory="grip/web/templates")

SESSION_USER_ID = "user_id"
SESSION_USERNAME = "username"
SESSION_CSRF_TOKEN = "csrf_token"  # noqa: S105 — session key name, not a secret

limiter = Limiter(key_func=get_remote_address)


def get_or_create_csrf_token(request: Request) -> str:
    """Return the session's CSRF token, creating it if missing."""
    token = request.session.get(SESSION_CSRF_TOKEN)
    if not token:
        token = secrets.token_urlsafe(32)
        request.session[SESSION_CSRF_TOKEN] = token
    return token


def require_csrf(request: Request, submitted: str | None) -> None:
    """Raise 403 unless ``submitted`` matches the session's CSRF token."""
    expected = request.session.get(SESSION_CSRF_TOKEN)
    if not expected or not submitted or not hmac.compare_digest(expected, submitted):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request) -> HTMLResponse:
    """Serve the login page."""
    csrf_token = get_or_create_csrf_token(request)
    return templates.TemplateResponse(
        "login.html", {"request": request, "csrf_token": csrf_token}
    )


@router.post("/login", response_model=None)
@limiter.limit("5/minute")
async def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
) -> RedirectResponse | HTMLResponse:
    """Handle login form submission."""
    require_csrf(request, csrf_token)

    username = username.strip()
    if not username or not password:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error_message": "Enter username and password.",
                "csrf_token": get_or_create_csrf_token(request),
            },
        )

    user = supabase_service.verify_user(username, password)
    if not user:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error_message": "Invalid username or password.",
                "csrf_token": get_or_create_csrf_token(request),
            },
        )

    supabase_service.touch_last_login(str(user["id"]))

    # Rotate the session on login to prevent fixation, then re-seed.
    request.session.clear()
    request.session[SESSION_USER_ID] = str(user["id"])
    request.session[SESSION_USERNAME] = str(user["username"])
    request.session[SESSION_CSRF_TOKEN] = secrets.token_urlsafe(32)

    return RedirectResponse(url="/", status_code=303)


@router.post("/logout")
async def logout(request: Request, csrf_token: str = Form(...)) -> RedirectResponse:
    """Clear the session and redirect to login."""
    require_csrf(request, csrf_token)
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)
