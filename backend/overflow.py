"""Moving students who are still waiting when a session ends.

See "Overflow Logic" in spec.md. Used by:
  - closing a session (POST /api/office_hours/<id>/close)
  - closing sessions automatically a while after their end time
  - scheduling a new session, which picks up students left stranded on a
    closed session that had nowhere to send them
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select, update

from models import Bucket, OfficeHours, Ticket
from sessions import now

# Sessions close on their own this long after their end time, so a professor
# who runs a little over isn't cut off. They can push the end time back if needed.
AUTO_CLOSE_AFTER = timedelta(minutes=30)


def next_session_for(db, session):
    """The earliest session for the same course that starts after this one and
    hasn't been closed, or None."""
    return db.scalar(
        select(OfficeHours)
        .where(
            OfficeHours.course == session.course,
            OfficeHours.starts_at > session.starts_at,
            OfficeHours.id != session.id,
            OfficeHours.closed_at.is_(None),
        )
        .order_by(OfficeHours.starts_at)
        .limit(1)
    )


def move_waiting_students(db, from_session_id, to_session):
    """Move everyone still waiting in one session to another. Returns how many moved.

    Moved students were waiting before the new session starts, so they count as on
    time there, and their score doubles (overflow). Pins are cleared, since a spot
    in the old session's line doesn't carry over.
    """
    waiting = (Ticket.office_hours_id == from_session_id, Ticket.status == "waiting")

    # Professor-set priorities skip the formula, so double them directly to give
    # the same x2 boost everyone else gets from overflow_count.
    db.execute(
        update(Ticket)
        .where(*waiting, Ticket.manually_changed.is_(True))
        .values(priority=Ticket.priority * 2)
    )
    moved = db.execute(
        update(Ticket)
        .where(*waiting)
        .values(
            office_hours_id=to_session.id,
            overflow_count=Ticket.overflow_count + 1,
            late=False,
            pinned_position=None,
        )
    ).rowcount
    db.execute(
        update(Bucket)
        .where(Bucket.office_hours_id == from_session_id, Bucket.status == "waiting")
        .values(
            office_hours_id=to_session.id,
            overflow_count=Bucket.overflow_count + 1,
            late=False,
        )
    )
    return moved


def count_waiting(db, session_id):
    return db.scalar(
        select(func.count(Ticket.id)).where(
            Ticket.office_hours_id == session_id, Ticket.status == "waiting"
        )
    )


def close_session(db, session):
    """Close a session and move its waiting students to the next one.

    Returns (next_session, moved_count, still_waiting_count). still_waiting is
    above 0 only when there was no next session to move them to.
    """
    session.is_open = False
    session.closed_at = now()

    next_session = next_session_for(db, session)
    if next_session is None:
        return None, 0, count_waiting(db, session.id)
    return next_session, move_waiting_students(db, session.id, next_session), 0


def rehome_stranded(db, course):
    """Students left waiting on a closed session (because no later session existed
    when it closed) move to the next session that now exists. Returns how many moved."""
    stranded_sessions = db.scalars(
        select(OfficeHours)
        .where(OfficeHours.course == course, OfficeHours.closed_at.is_not(None))
        .order_by(OfficeHours.starts_at)
    ).all()
    moved = 0
    for closed in stranded_sessions:
        if count_waiting(db, closed.id) == 0:
            continue
        target = next_session_for(db, closed)
        if target is not None:
            moved += move_waiting_students(db, closed.id, target)
    return moved


def close_expired_sessions(db):
    """Close sessions that ended more than AUTO_CLOSE_AFTER ago. Returns how many closed."""
    cutoff = (datetime.now() - AUTO_CLOSE_AFTER).isoformat(timespec="minutes")
    expired = db.scalars(
        select(OfficeHours)
        .where(OfficeHours.closed_at.is_(None), OfficeHours.ends_at <= cutoff)
        .order_by(OfficeHours.starts_at)
    ).all()
    for session in expired:
        close_session(db, session)
    return len(expired)
