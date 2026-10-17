"""POST /api/students/<student_id>/sections — add a class by its section code.

Body (JSON):
  section_code  required, 5 digits, e.g. "34190"

Looks the section up on the Anteater API for the current term (see anteater.py)
and saves it to the student. Returns the class: course, instructors, meeting
times and location. Adding the same code again refreshes its data.

Errors: 400 bad code, 404 unknown student or section, 502 Anteater unreachable.
"""
import json

from flask import jsonify, request

import anteater
from db import get_connection
from validation import clean, section_code_error

from . import bp


@bp.post("/<int:student_id>/sections")
def add_section(student_id):
    code = clean((request.get_json(silent=True) or {}).get("section_code"))
    error = section_code_error(code)
    if error:
        return jsonify({"error": error}), 400

    conn = get_connection()
    student = conn.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        conn.close()
        return jsonify({"error": "student not found"}), 404

    try:
        section = anteater.lookup_section(code)
    except anteater.AnteaterError as e:
        conn.close()
        return jsonify({"error": f"couldn't look up the class: {e}"}), 502
    if section is None:
        conn.close()
        return jsonify({
            "error": f"no section {code} in {anteater.QUARTER} {anteater.YEAR}"
        }), 404

    conn.execute(
        """
        INSERT INTO student_sections (student_id, section_code, year, quarter, course_id, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (student_id, section_code, year, quarter)
            DO UPDATE SET course_id = excluded.course_id, data = excluded.data
        """,
        (student_id, code, section["year"], section["quarter"], section["course_id"],
         json.dumps(section)),
    )
    conn.commit()
    conn.close()
    return jsonify(section), 201
