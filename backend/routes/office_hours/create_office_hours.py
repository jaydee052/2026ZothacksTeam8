"""POST /api/office_hours — schedule a new session.

Body (JSON), all required:
  course, location, starts_at, ends_at   (times like "2026-10-17T14:00")

New sessions start closed. Open one with POST /api/office_hours/<id>/open
so students don't get queued into a session that hasn't started.
"""
from flask import jsonify, request

from db import get_connection

from . import bp
from .fields import read_fields, session_to_dict


@bp.post("")
def create_office_hours():
    fields, error = read_fields(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    conn = get_connection()
    cursor = conn.execute(
        """
        INSERT INTO office_hours (course, location, starts_at, ends_at, is_open)
        VALUES (?, ?, ?, ?, 0)
        """,
        (fields["course"], fields["location"], fields["starts_at"], fields["ends_at"]),
    )
    conn.commit()
    session = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    conn.close()
    return jsonify(session_to_dict(session)), 201
