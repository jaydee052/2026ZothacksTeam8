"""POST /api/office_hours/<id>/close — end a session.

Anyone still waiting is pushed to the next session for the same course,
with an overflow boost. See "Overflow Logic" in spec.md.
"""
from flask import jsonify
from sqlalchemy import func, select, update

from db import get_db
from models import Bucket, OfficeHours, Ticket
from sessions import now

from . import bp
from .fields import session_to_dict


@bp.post("/<int:session_id>/close")
def close_office_hours(session_id):
    with get_db() as db:
        session = db.get(OfficeHours, session_id)
        if session is None:
            return jsonify({"error": "office hours not found"}), 404
        if session.closed_at is not None:
            return jsonify({"error": "office hours already closed"}), 409

        session.is_open = False
        session.closed_at = now()

        # The earliest session for the same course that starts after this one
        # and hasn't been closed.
        next_session = db.scalar(
            select(OfficeHours)
            .where(
                OfficeHours.course == session.course,
                OfficeHours.starts_at > session.starts_at,
                OfficeHours.id != session_id,
                OfficeHours.closed_at.is_(None),
            )
            .order_by(OfficeHours.starts_at)
            .limit(1)
        )

        waiting = (Ticket.office_hours_id == session_id, Ticket.status == "waiting")
        moved = 0
        if next_session is not None:
            # Manually set priorities skip the formula, so double them directly
            # to give the same x2 boost everyone else gets from overflow_count.
            db.execute(
                update(Ticket)
                .where(*waiting, Ticket.manually_changed.is_(True))
                .values(priority=Ticket.priority * 2)
            )
            # Moved students are waiting before the next session starts, so they're
            # on time there (late = False), plus they get the overflow boost.
            moved = db.execute(
                update(Ticket)
                .where(*waiting)
                .values(
                    office_hours_id=next_session.id,
                    overflow_count=Ticket.overflow_count + 1,
                    late=False,
                )
            ).rowcount
            db.execute(
                update(Bucket)
                .where(Bucket.office_hours_id == session_id, Bucket.status == "waiting")
                .values(
                    office_hours_id=next_session.id,
                    overflow_count=Bucket.overflow_count + 1,
                    late=False,
                )
            )

        still_waiting = 0
        if next_session is None:
            still_waiting = db.scalar(select(func.count(Ticket.id)).where(*waiting))

        db.commit()

        result = {
            "session": session_to_dict(session),
            "moved_to": session_to_dict(next_session),
            "moved_count": moved,
        }
        if still_waiting:
            result["warning"] = (
                f"{still_waiting} student(s) are still waiting, but there is no later "
                f"{session.course} session to move them to. They stay in the queue."
            )
        return jsonify(result)
