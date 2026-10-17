"""Office hours session state: upcoming, started, or closed.

A session is upcoming until it starts, then running until the professor closes it.
Questions can be submitted to upcoming and running sessions, but questions
submitted after the start go to the back of the line (see priority.py).

Note: "session" here means an office hours session (models.OfficeHours),
not a database session. Database sessions are called `db`.
"""
from datetime import datetime

from sqlalchemy import and_, or_, select

from models import OfficeHours


def now():
    """Current local time, in the same text format the sessions are stored in."""
    return datetime.now().isoformat(timespec="minutes")


def has_started(session):
    """True once the professor opens it or its start time passes, whichever is first."""
    return bool(session.is_open) or now() >= session.starts_at


def is_closed(session):
    return session.closed_at is not None


def pick_session(db, requested_id=None):
    """Choose the session a new question goes into. Returns (session, error).

    If the student picked one, use it (as long as it hasn't been closed).
    Otherwise use the session running now, or the next upcoming one.
    """
    if requested_id is not None:
        try:
            session = db.get(OfficeHours, int(requested_id))
        except (TypeError, ValueError):
            session = None
        if session is None:
            return None, "office hours not found"
        if is_closed(session):
            return None, "those office hours have already ended"
        return session, None

    current = now()
    running = db.scalar(
        select(OfficeHours)
        .where(
            OfficeHours.closed_at.is_(None),
            or_(
                OfficeHours.is_open.is_(True),
                and_(OfficeHours.starts_at <= current, OfficeHours.ends_at > current),
            ),
        )
        .order_by(OfficeHours.starts_at)
        .limit(1)
    )
    if running is not None:
        return running, None

    upcoming = db.scalar(
        select(OfficeHours)
        .where(OfficeHours.closed_at.is_(None), OfficeHours.starts_at > current)
        .order_by(OfficeHours.starts_at)
        .limit(1)
    )
    if upcoming is not None:
        return upcoming, None

    return None, "no upcoming office hours to join"
