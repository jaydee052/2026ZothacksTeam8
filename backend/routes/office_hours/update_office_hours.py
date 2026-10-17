"""PATCH /api/office_hours/<id> — change a session's time or location.

Body (JSON), any of: course, location, starts_at, ends_at
"""
from flask import jsonify, request

from db import get_connection

from . import bp
from .fields import read_fields, session_to_dict


@bp.patch("/<int:session_id>")
def update_office_hours(session_id):
    conn = get_connection()
    current = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    if current is None:
        conn.close()
        return jsonify({"error": "office hours not found"}), 404

    fields, error = read_fields(request.get_json(silent=True) or {}, dict(current))
    if error or not fields:
        conn.close()
        return jsonify({"error": error or "no valid fields to update"}), 400

    assignments = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(
        f"UPDATE office_hours SET {assignments} WHERE id = ?",
        list(fields.values()) + [session_id],
    )
    conn.commit()
    session = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    conn.close()
    return jsonify(session_to_dict(session))
