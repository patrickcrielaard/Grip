"""Availability routes for Grip — weekly hour budgets per day."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from grip.routes.todos import _require_user
from grip.supabase_service import supabase_service

router = APIRouter()

_WEEK_LEN = 7


def _week_end(week_start: date) -> date:
    return week_start + timedelta(days=_WEEK_LEN - 1)


class AvailabilityUpsert(BaseModel):
    """Payload for saving a week's availability."""

    week_start: date
    days: Dict[str, float] = Field(
        ...,
        description="Map of YYYY-MM-DD → hours (0–24)",
    )

    @model_validator(mode="after")
    def validate_days(self) -> "AvailabilityUpsert":
        week_end = _week_end(self.week_start)
        for day_str, hours in self.days.items():
            try:
                d = date.fromisoformat(day_str)
            except ValueError:
                raise ValueError(f"Invalid date key: {day_str!r}")
            if not (self.week_start <= d <= week_end):
                raise ValueError(
                    f"Day {day_str} is outside week {self.week_start} – {week_end}"
                )
            if not (0 <= hours <= 24):
                raise ValueError(f"Hours for {day_str} must be between 0 and 24")
        return self


@router.get("/api/availability")
async def get_availability(request: Request, week_start: str) -> Dict[str, Any]:
    """Return per-day available hours for the given week.

    ``week_start`` must be a Monday in YYYY-MM-DD format.
    Missing days are filled with defaults (8 h Mon–Fri, 0 h Sat–Sun).
    """
    user = _require_user(request)
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        raise HTTPException(status_code=400, detail="week_start must be YYYY-MM-DD")

    end = _week_end(start)
    availability = supabase_service.get_week_availability(
        user["id"], start.isoformat(), end.isoformat()
    )
    total_hours = sum(availability.values())
    return {
        "week_start": start.isoformat(),
        "days": availability,
        "total_hours": total_hours,
    }


@router.put("/api/availability")
async def upsert_availability(
    request: Request, body: AvailabilityUpsert
) -> Dict[str, Any]:
    """Upsert available hours for every day supplied in *body.days*."""
    user = _require_user(request)
    ok = supabase_service.upsert_week_availability(user["id"], body.days)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save availability")

    end = _week_end(body.week_start)
    availability = supabase_service.get_week_availability(
        user["id"], body.week_start.isoformat(), end.isoformat()
    )
    total_hours = sum(availability.values())
    return {
        "week_start": body.week_start.isoformat(),
        "days": availability,
        "total_hours": total_hours,
    }
