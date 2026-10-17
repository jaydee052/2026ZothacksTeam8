"""POST /api/professors — sign a professor in by UCInetID and load their classes.

Body (JSON):
  ucinetid  required, e.g. "mikes" (the part of their email before @uci.edu)

Looks the professor up on the Anteater API (see anteater.py) and saves their
profile and the courses they lecture this term, with every section of each
course. Calling it again refreshes the data.

Errors: 400 bad UCInetID, 404 unknown professor, 502 Anteater unreachable.
"""
import json

from flask import jsonify, request

import anteater
from db import get_connection
from validation import clean, ucinetid_error

from . import bp


@bp.post("")
def add_professor():
    ucinetid = clean((request.get_json(silent=True) or {}).get("ucinetid")).lower()
    error = ucinetid_error(ucinetid)
    if error:
        return jsonify({"error": error}), 400

    try:
        professor = anteater.lookup_instructor(ucinetid)
    except anteater.AnteaterError as e:
        return jsonify({"error": f"couldn't look up the professor: {e}"}), 502
    if professor is None:
        return jsonify({"error": f"no instructor with UCInetID {ucinetid}"}), 404

    conn = get_connection()
    conn.execute(
        """
        INSERT INTO professors (ucinetid, name, title, email, department)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (ucinetid) DO UPDATE SET
            name = excluded.name, title = excluded.title,
            email = excluded.email, department = excluded.department
        """,
        (professor["ucinetid"], professor["name"], professor["title"],
         professor["email"], professor["department"]),
    )
    # Replace this term's courses, so a course they no longer teach goes away.
    conn.execute(
        "DELETE FROM professor_courses WHERE ucinetid = ? AND year = ? AND quarter = ?",
        (professor["ucinetid"], professor["year"], professor["quarter"]),
    )
    for course in professor["courses"]:
        conn.execute(
            """
            INSERT INTO professor_courses (ucinetid, course_id, year, quarter, data)
            VALUES (?, ?, ?, ?, ?)
            """,
            (professor["ucinetid"], course["course_id"], professor["year"],
             professor["quarter"], json.dumps(course)),
        )
    conn.commit()
    conn.close()
    return jsonify(professor), 201
