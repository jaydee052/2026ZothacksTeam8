"""DELETE /api/office_hours/<id> — remove a session, e.g. one scheduled by mistake.

Only allowed when nobody is waiting in it (409 otherwise; close it instead so
they move to the next session). Students already helped in it stay in the
records, just no longer linked to the deleted session.
"""
from flask import jsonify
from sqlalchemy import update

from db import get_db
from models import Bucket, OfficeHours, Ticket
from overflow import count_waiting

from . import bp


@bp.delete("/<int:session_id>")
def delete_office_hours(session_id):
    with get_db() as db:
        session = db.get(OfficeHours, session_id)
        if session is None:
            return jsonify({"error": "office hours not found"}), 404

        waiting = count_waiting(db, session_id)
        if waiting:
            return jsonify({
                "error": f"{waiting} student(s) are waiting in this session. "
                "Close it instead, so they move to the next session."
            }), 409

        db.execute(
            update(Ticket).where(Ticket.office_hours_id == session_id).values(office_hours_id=None)
        )
        db.execute(
            update(Bucket).where(Bucket.office_hours_id == session_id).values(office_hours_id=None)
        )
        db.delete(session)
        db.commit()
        return jsonify({"deleted": session_id})
