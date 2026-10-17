"""GET /api/students/<student_id>/sections — the classes a student has added.

Reads from our database only, so it works even when the Anteater API is down.
Returns a list in the same shape as POST /api/students/<student_id>/sections.
"""
import json

from flask import jsonify

from db import get_connection

from . import bp


@bp.get("/<int:student_id>/sections")
def list_sections(student_id):
    conn = get_connection()
    student = conn.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        conn.close()
        return jsonify({"error": "student not found"}), 404

    rows = conn.execute(
        "SELECT data FROM student_sections WHERE student_id = ? ORDER BY added_at, id",
        (student_id,),
    ).fetchall()
    conn.close()
    return jsonify([json.loads(row["data"]) for row in rows])
