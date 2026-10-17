"""PATCH /api/office_hours/<id> — change a session's time or location.

Body (JSON), any of: course, location, starts_at, ends_at

Rules:
  - Closed sessions can't be edited.
  - The start time is locked once the session has started. Students already chose
    on time vs. late based on it. The end time can still change, e.g. to stay late.
  - Can't overlap another open or upcoming session of the same course.
"""
from flask import jsonify, request

from db import get_db
from models import OfficeHours
from overflow import rehome_stranded

from . import bp
from .fields import overlap_error, read_fields, session_state, session_to_dict


@bp.patch("/<int:session_id>")
def update_office_hours(session_id):
    with get_db() as db:
        session = db.get(OfficeHours, session_id)
        if session is None:
            return jsonify({"error": "office hours not found"}), 404

        state = session_state(session)
        if state == "closed":
            return jsonify({"error": "office hours already ended"}), 409

        fields, error = read_fields(request.get_json(silent=True) or {}, session.to_dict())
        if error or not fields:
            return jsonify({"error": error or "no valid fields to update"}), 400

        if state == "running" and fields.get("starts_at", session.starts_at) != session.starts_at:
            return jsonify({
                "error": "the start time can't change after the session has started "
                "(the end time can)"
            }), 409

        merged = {**session.to_dict(), **fields}
        clash = overlap_error(
            db, merged["course"], merged["starts_at"], merged["ends_at"], exclude_id=session.id
        )
        if clash:
            return jsonify({"error": clash}), 409

        for key, value in fields.items():
            setattr(session, key, value)
        db.flush()
        # A new time or course may give stranded students somewhere to go.
        rehome_stranded(db, session.course)
        db.commit()
        return jsonify(session_to_dict(session))
