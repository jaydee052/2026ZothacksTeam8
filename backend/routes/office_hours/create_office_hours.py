"""POST /api/office_hours — schedule a new session.

Body (JSON), all required:
  course, location, starts_at, ends_at   (times like "2026-10-17T14:00")

New sessions take questions right away. They count as started once the
professor opens them (POST /api/office_hours/<id>/open) or the start time passes.
"""
from flask import jsonify, request

from db import get_db
from models import OfficeHours

from . import bp
from .fields import read_fields, session_to_dict


@bp.post("")
def create_office_hours():
    fields, error = read_fields(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    with get_db() as db:
        session = OfficeHours(**fields, is_open=False)
        db.add(session)
        db.commit()
        return jsonify(session_to_dict(session)), 201
