"""Office hours session state: upcoming, started, or closed.

A session is upcoming until it starts, then running until the professor closes it.
Questions can be submitted to upcoming and running sessions, but questions
submitted after the start go to the back of the line (see priority.py).
"""
from datetime import datetime


def now():
    """Current local time, in the same text format the sessions are stored in."""
    return datetime.now().isoformat(timespec="minutes")


def has_started(session):
    """True once the professor opens it or its start time passes, whichever is first."""
    return bool(session["is_open"]) or now() >= session["starts_at"]


def is_closed(session):
    return session["closed_at"] is not None


def pick_session(conn, requested_id=None):
    """Choose the session a new question goes into. Returns (session, error).

    If the student picked one, use it (as long as it hasn't been closed).
    Otherwise use the session running now, or the next upcoming one.
    """
    if requested_id is not None:
        session = conn.execute(
            "SELECT * FROM office_hours WHERE id = ?", (requested_id,)
        ).fetchone()
        if session is None:
            return None, "office hours not found"
        if is_closed(session):
            return None, "those office hours have already ended"
        return session, None

    running = conn.execute(
        """
        SELECT * FROM office_hours
        WHERE closed_at IS NULL
          AND (is_open = 1 OR (starts_at <= ? AND ends_at > ?))
        ORDER BY starts_at LIMIT 1
        """,
        (now(), now()),
    ).fetchone()
    if running is not None:
        return running, None

    upcoming = conn.execute(
        """
        SELECT * FROM office_hours
        WHERE closed_at IS NULL AND starts_at > ?
        ORDER BY starts_at LIMIT 1
        """,
        (now(),),
    ).fetchone()
    if upcoming is not None:
        return upcoming, None

    return None, "no upcoming office hours to join"
