"""Authentication routes for Grip."""

from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from grip.configuration import settings
from grip.supabase_service import SupabaseService


router = APIRouter()

templates = Jinja2Templates(directory="grip/web/templates")

supabase_service = SupabaseService()

COOKIE_USER_ID = "grip_user_id"
COOKIE_USERNAME = "grip_username"


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request) -> HTMLResponse:
    """Serve the login page."""
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/login", response_model=None)
async def login(
    request: Request, username: str = Form(...), password: str = Form(...)
) -> RedirectResponse | HTMLResponse:
    """Handle login form submission."""
    username = username.strip()
    if not username or not password:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error_message": "Enter username and password."},
        )

    user = supabase_service.verify_user(username, password)
    if not user:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error_message": "Invalid username or password.",
            },
        )

    supabase_service.touch_last_login(str(user["id"]))

    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        key=COOKIE_USER_ID,
        value=str(user["id"]),
        max_age=60 * 60 * 24 * 7,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )
    response.set_cookie(
        key=COOKIE_USERNAME,
        value=str(user["username"]),
        max_age=60 * 60 * 24 * 7,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )
    return response


@router.post("/logout")
async def logout() -> RedirectResponse:
    """Clear login cookies and redirect to login."""
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie(key=COOKIE_USER_ID)
    response.delete_cookie(key=COOKIE_USERNAME)
    return response
