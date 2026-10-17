"""PATCH /api/office_hours/<id> — change a session's time or location.

Body (JSON), any of: course, location, starts_at, ends_at
"""
from flask import jsonify, request

from db import get_db
from models import OfficeHours

from . import bp
from .fields import read_fields, session_to_dict


@bp.patch("/<int:session_id>")
def update_office_hours(session_id):
    with get_db() as db:
        session = db.get(OfficeHours, session_id)
        if session is None:
            return jsonify({"error": "office hours not found"}), 404

        fields, error = read_fields(request.get_json(silent=True) or {}, session.to_dict())
        if error or not fields:
            return jsonify({"error": error or "no valid fields to update"}), 400

        for key, value in fields.items():
            setattr(session, key, value)
        db.commit()
        return jsonify(session_to_dict(session))
