"""DELETE /api/students/<student_id>/sections/<section_code> — drop a class the
student added (POST /api/students/<student_id>/sections).

Only removes classes the student added themselves; classes from the hardcoded
demo enrollment (frontend/src/config.js) aren't stored here.

Returns 204. Errors: 404 unknown student, or that class isn't one they added.
"""
from flask import jsonify

from db import get_connection

from . import bp


@bp.delete("/<int:student_id>/sections/<section_code>")
def remove_section(student_id, section_code):
    conn = get_connection()
    student = conn.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        conn.close()
        return jsonify({"error": "student not found"}), 404

    removed = conn.execute(
        "DELETE FROM student_sections WHERE student_id = ? AND section_code = ?",
        (student_id, section_code),
    ).rowcount
    conn.commit()
    conn.close()
    if not removed:
        return jsonify({"error": f"{section_code} isn't one of this student's added classes"}), 404
    return "", 204
