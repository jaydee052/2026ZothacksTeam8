"""GET /api/professors/<ucinetid> — a saved professor and their classes this term.

Reads from our database only, so it works even when the Anteater API is down.
Returns the same shape as POST /api/professors. 404 if the professor hasn't
signed in with POST /api/professors yet.
"""
import json

from flask import jsonify

import anteater
from db import get_connection

from . import bp


@bp.get("/<ucinetid>")
def get_professor(ucinetid):
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM professors WHERE ucinetid = ?", (ucinetid.lower(),)
    ).fetchone()
    if row is None:
        conn.close()
        return jsonify({"error": "professor not found"}), 404

    courses = conn.execute(
        """
        SELECT data FROM professor_courses
        WHERE ucinetid = ? AND year = ? AND quarter = ?
        ORDER BY course_id
        """,
        (row["ucinetid"], anteater.YEAR, anteater.QUARTER),
    ).fetchall()
    conn.close()
    return jsonify({
        **dict(row),
        "year": anteater.YEAR,
        "quarter": anteater.QUARTER,
        "courses": [json.loads(c["data"]) for c in courses],
    })
