"""POST /api/office_hours/<id>/close — end a session.

Anyone still waiting is pushed to the next session for the same course,
with an overflow boost. See "Overflow Logic" in spec.md and overflow.py.
"""
from flask import jsonify

from db import get_db
from models import OfficeHours
from overflow import close_session

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

        next_session, moved, still_waiting = close_session(db, session)
        db.commit()

        result = {
            "session": session_to_dict(session),
            "moved_to": session_to_dict(next_session),
            "moved_count": moved,
        }
        if still_waiting:
            result["warning"] = (
                f"{still_waiting} student(s) are still waiting, but there is no later "
                f"{session.course} session to move them to. They stay in the queue "
                "and move automatically once a later session is scheduled."
            )
        return jsonify(result)
