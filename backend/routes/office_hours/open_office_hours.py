"""POST /api/office_hours/<id>/open — start a session so students can join it."""
from flask import jsonify

from db import get_db
from models import OfficeHours

from . import bp
from .fields import session_to_dict


@bp.post("/<int:session_id>/open")
def open_office_hours(session_id):
    with get_db() as db:
        session = db.get(OfficeHours, session_id)
        if session is None:
            return jsonify({"error": "office hours not found"}), 404
        if session.closed_at is not None:
            return jsonify({"error": "office hours already ended"}), 409
        if session.is_open:
            return jsonify({"error": "office hours already open"}), 409

        session.is_open = True
        db.commit()
        return jsonify(session_to_dict(session))
