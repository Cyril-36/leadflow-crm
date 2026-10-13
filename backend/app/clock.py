from collections.abc import Callable
from datetime import UTC, datetime

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


def get_clock() -> Clock:
    """FastAPI dependency. Tests override it to freeze time."""
    return utc_now
