"""Pure phase-transition logic for the pomodoro timer.

Kept free of database calls so it can be exercised by table-driven unit tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict


KIND_STOPWATCH = "stopwatch"
KIND_FOCUS = "pomodoro_focus"
KIND_SHORT_BREAK = "pomodoro_short_break"
KIND_LONG_BREAK = "pomodoro_long_break"

POMODORO_KINDS = frozenset({KIND_FOCUS, KIND_SHORT_BREAK, KIND_LONG_BREAK})
ALL_KINDS = frozenset({KIND_STOPWATCH, *POMODORO_KINDS})

DEFAULT_SETTINGS: Dict[str, int | bool] = {
    "focus_minutes": 25,
    "short_break_minutes": 5,
    "long_break_minutes": 15,
    "cycles_per_long_break": 4,
    "auto_start_breaks": True,
    "auto_start_focus": False,
    "sound_enabled": True,
}

# Stopwatch sessions older than this are auto-closed when the user reconnects.
STOPWATCH_STALE_SECONDS = 8 * 3600


@dataclass(frozen=True)
class NextPhase:
    """The phase that follows the current one, with its planned length."""

    kind: str
    cycle_index: int
    phase_seconds: int


def phase_seconds_for(kind: str, settings: Dict[str, int | bool]) -> int:
    """Return the configured length (seconds) for a pomodoro phase."""
    if kind == KIND_FOCUS:
        return int(settings["focus_minutes"]) * 60
    if kind == KIND_SHORT_BREAK:
        return int(settings["short_break_minutes"]) * 60
    if kind == KIND_LONG_BREAK:
        return int(settings["long_break_minutes"]) * 60
    raise ValueError(f"phase_seconds_for: not a pomodoro kind: {kind}")


def next_phase(
    current_kind: str,
    cycle_index: int,
    settings: Dict[str, int | bool],
) -> NextPhase:
    """Compute the next phase given the current one.

    cycle_index is the 1-based ordinal of the current focus block within
    the current set (1..cycles_per_long_break). It only advances after a
    break ends. After a long break it resets to 1.
    """
    cycles_per_long_break = max(1, int(settings["cycles_per_long_break"]))

    if current_kind == KIND_FOCUS:
        # Decide which break follows. Long break after every Nth focus.
        if cycle_index >= cycles_per_long_break:
            kind = KIND_LONG_BREAK
        else:
            kind = KIND_SHORT_BREAK
        return NextPhase(
            kind=kind,
            cycle_index=cycle_index,
            phase_seconds=phase_seconds_for(kind, settings),
        )

    if current_kind == KIND_SHORT_BREAK:
        next_cycle = cycle_index + 1
        return NextPhase(
            kind=KIND_FOCUS,
            cycle_index=next_cycle,
            phase_seconds=phase_seconds_for(KIND_FOCUS, settings),
        )

    if current_kind == KIND_LONG_BREAK:
        return NextPhase(
            kind=KIND_FOCUS,
            cycle_index=1,
            phase_seconds=phase_seconds_for(KIND_FOCUS, settings),
        )

    raise ValueError(f"next_phase: not a pomodoro kind: {current_kind}")


def remaining_seconds(
    started_at: datetime, phase_seconds: int, now: datetime | None = None
) -> int:
    """Seconds left in the current phase. Negative once the phase has elapsed."""
    if now is None:
        now = datetime.now(timezone.utc)
    elapsed = (now - started_at).total_seconds()
    return int(phase_seconds - elapsed)


def is_phase_elapsed(
    started_at: datetime, phase_seconds: int, now: datetime | None = None
) -> bool:
    """Whether the planned phase end is now in the past."""
    return remaining_seconds(started_at, phase_seconds, now) <= 0


def is_pomodoro_session_stale(
    started_at: datetime, phase_seconds: int, now: datetime | None = None
) -> bool:
    """Pomodoro session is considered abandoned after 2× the planned phase."""
    if now is None:
        now = datetime.now(timezone.utc)
    elapsed = (now - started_at).total_seconds()
    return elapsed > 2 * phase_seconds


def is_stopwatch_stale(started_at: datetime, now: datetime | None = None) -> bool:
    """Stopwatch session is considered abandoned after STOPWATCH_STALE_SECONDS."""
    if now is None:
        now = datetime.now(timezone.utc)
    elapsed = (now - started_at).total_seconds()
    return elapsed > STOPWATCH_STALE_SECONDS
