"""Calendar subscription + event routes for Grip."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from grip.calendar_service import sync_subscription
from grip.routes.todos import _require_user
from grip.supabase_service import supabase_service

router = APIRouter()
logger = logging.getLogger("grip.calendar_routes")

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_URL_RE = re.compile(r"^(https?|webcal|webcals)://", re.IGNORECASE)


class SubscriptionCreate(BaseModel):
    """Payload for creating a calendar subscription."""

    name: str = Field(..., min_length=1, max_length=120)
    url: str = Field(..., min_length=1, max_length=2048)
    color: str | None = None


def _normalize_color(value: str | None) -> str | None:
    if value is None:
        return None
    color = value.strip()
    if not color:
        return None
    if not _COLOR_RE.match(color):
        raise HTTPException(
            status_code=400, detail="Color must be a hex string like #2E7D32"
        )
    return color


def _normalize_url(value: str) -> str:
    url = value.strip()
    if not _URL_RE.match(url):
        raise HTTPException(
            status_code=400,
            detail="URL must start with https://, http://, webcal://, or webcals://",
        )
    return url


@router.get("/api/calendar/subscriptions")
async def list_subscriptions(request: Request) -> Dict[str, Any]:
    """Return all calendar subscriptions for the current user."""
    user = _require_user(request)
    subs = supabase_service.list_calendar_subscriptions(user["id"])
    return {"subscriptions": subs}


@router.post("/api/calendar/subscriptions")
async def create_subscription(
    request: Request, payload: SubscriptionCreate
) -> Dict[str, Any]:
    """Add a calendar subscription and trigger an initial sync."""
    user = _require_user(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    url = _normalize_url(payload.url)
    color = _normalize_color(payload.color)
    sub = supabase_service.create_calendar_subscription(
        user["id"], name, url, color=color
    )
    if not sub:
        logger.error("create_calendar_subscription failed for user_id=%s", user["id"])
        raise HTTPException(status_code=500, detail="Unable to create subscription")

    # Run initial sync off the event loop so we don't block the response.
    error = await asyncio.to_thread(sync_subscription, int(sub["id"]))
    refreshed = supabase_service.get_calendar_subscription(user["id"], int(sub["id"]))
    return {"subscription": refreshed or sub, "sync_error": error}


@router.delete("/api/calendar/subscriptions/{subscription_id}")
async def delete_subscription(request: Request, subscription_id: int) -> Dict[str, Any]:
    """Delete a calendar subscription (and its cached events)."""
    user = _require_user(request)
    deleted = supabase_service.delete_calendar_subscription(user["id"], subscription_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"status": "deleted"}


@router.post("/api/calendar/subscriptions/{subscription_id}/sync")
async def sync_subscription_endpoint(
    request: Request, subscription_id: int
) -> Dict[str, Any]:
    """Manually trigger a re-sync of a subscription."""
    user = _require_user(request)
    sub = supabase_service.get_calendar_subscription(user["id"], subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    error = await asyncio.to_thread(sync_subscription, subscription_id)
    refreshed = supabase_service.get_calendar_subscription(user["id"], subscription_id)
    return {"subscription": refreshed, "sync_error": error}


@router.get("/api/calendar/events")
async def list_events(
    request: Request,
    range_from: str = Query(..., alias="from"),
    range_to: str = Query(..., alias="to"),
) -> Dict[str, Any]:
    """Return events overlapping [from, to] (YYYY-MM-DD inclusive)."""
    user = _require_user(request)
    if not _DATE_RE.match(range_from) or not _DATE_RE.match(range_to):
        raise HTTPException(status_code=400, detail="from/to must be YYYY-MM-DD")
    if range_from > range_to:
        raise HTTPException(status_code=400, detail="from must be <= to")
    # Treat the range inclusively in UTC.
    start_iso = f"{range_from}T00:00:00+00:00"
    end_iso = f"{range_to}T23:59:59+00:00"
    events = supabase_service.list_calendar_events(user["id"], start_iso, end_iso)
    return {"events": events}
