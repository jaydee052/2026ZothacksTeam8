"""POST /api/office_hours/<id>/open — start a session so students can join it."""
from flask import jsonify

from db import get_connection

from . import bp
from .fields import session_to_dict


@bp.post("/<int:session_id>/open")
def open_office_hours(session_id):
    conn = get_connection()
    session = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    if session is None:
        conn.close()
        return jsonify({"error": "office hours not found"}), 404
    if session["closed_at"] is not None:
        conn.close()
        return jsonify({"error": "office hours already ended"}), 409
    if session["is_open"]:
        conn.close()
        return jsonify({"error": "office hours already open"}), 409

    conn.execute("UPDATE office_hours SET is_open = 1 WHERE id = ?", (session_id,))
    conn.commit()
    session = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    conn.close()
    return jsonify(session_to_dict(session))
