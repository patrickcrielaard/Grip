"""Read-only Apple/iCloud calendar sync via ICS subscription URLs."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
import recurring_ical_events  # type: ignore[import-untyped]
from icalendar import Calendar

from grip.supabase_service import supabase_service

logger = logging.getLogger("grip.calendar")

SYNC_WINDOW_PAST_DAYS = 30
SYNC_WINDOW_FUTURE_DAYS = 180
FETCH_TIMEOUT_SECONDS = 15.0


def _normalize_url(url: str) -> str:
    """Rewrite webcal:// to https:// so httpx can fetch it."""
    stripped = url.strip()
    if stripped.startswith("webcal://"):
        return "https://" + stripped[len("webcal://") :]
    if stripped.startswith("webcals://"):
        return "https://" + stripped[len("webcals://") :]
    return stripped


def fetch_ics(url: str) -> bytes:
    """Fetch an ICS feed. Raises httpx.HTTPError on network/HTTP failure."""
    resolved = _normalize_url(url)
    response = httpx.get(
        resolved,
        timeout=FETCH_TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": "Grip-Calendar/1.0"},
    )
    response.raise_for_status()
    return response.content


def _to_utc_iso(value: Any) -> tuple[str, bool]:
    """Convert an icalendar datetime/date to (UTC ISO string, is_all_day)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat(), False
    if isinstance(value, date):
        # All-day event — represent as midnight UTC for sortability.
        dt = datetime.combine(value, time.min, tzinfo=timezone.utc)
        return dt.isoformat(), True
    raise TypeError(f"Unsupported temporal value: {value!r}")


def parse_and_expand(
    ics_bytes: bytes,
    window_start: date,
    window_end: date,
) -> List[Dict[str, Any]]:
    """Parse an ICS feed and expand recurring events within the window.

    Returns a list of event dicts ready for upsert into ``calendar_events``.
    """
    calendar = Calendar.from_ical(ics_bytes)
    occurrences = recurring_ical_events.of(calendar).between(window_start, window_end)

    events: List[Dict[str, Any]] = []
    for occ in occurrences:
        try:
            dtstart = occ.get("DTSTART").dt
            dtend_prop = occ.get("DTEND")
            dtend = dtend_prop.dt if dtend_prop else dtstart
            start_iso, all_day = _to_utc_iso(dtstart)
            end_iso, _ = _to_utc_iso(dtend)
        except (AttributeError, TypeError) as exc:
            logger.warning("skipping unparsable event: %s", exc)
            continue

        uid = str(occ.get("UID", "")) or f"no-uid-{start_iso}"
        rrule_prop = occ.get("RRULE")
        rrule_str = rrule_prop.to_ical().decode("utf-8") if rrule_prop else None

        events.append(
            {
                "uid": uid,
                "summary": str(occ.get("SUMMARY", "")) or None,
                "description": str(occ.get("DESCRIPTION", "")) or None,
                "location": str(occ.get("LOCATION", "")) or None,
                "start_at": start_iso,
                "end_at": end_iso,
                "all_day": all_day,
                "rrule": rrule_str,
            }
        )
    return events


def sync_subscription(subscription_id: int) -> Optional[str]:
    """Fetch + parse + replace cached events for a subscription.

    Returns ``None`` on success, or an error message string on failure.
    The subscription row's ``last_synced_at`` / ``last_error`` are updated
    either way.
    """
    sub = supabase_service.get_calendar_subscription_internal(subscription_id)
    if not sub:
        return f"subscription {subscription_id} not found"

    try:
        ics_bytes = fetch_ics(sub["url"])
    except Exception as exc:
        msg = f"fetch failed: {exc}"
        logger.warning("calendar sync %s: %s", subscription_id, msg)
        supabase_service.mark_calendar_subscription_synced(subscription_id, error=msg)
        return msg

    today = date.today()
    window_start = today - timedelta(days=SYNC_WINDOW_PAST_DAYS)
    window_end = today + timedelta(days=SYNC_WINDOW_FUTURE_DAYS)

    try:
        events = parse_and_expand(ics_bytes, window_start, window_end)
    except Exception as exc:
        msg = f"parse failed: {exc}"
        logger.warning("calendar sync %s: %s", subscription_id, msg)
        supabase_service.mark_calendar_subscription_synced(subscription_id, error=msg)
        return msg

    supabase_service.replace_calendar_events(subscription_id, events)
    supabase_service.mark_calendar_subscription_synced(subscription_id, error=None)
    return None
