"""POST /api/office_hours/<id>/close — end a session.

Anyone still waiting is pushed to the next session for the same course,
with an overflow boost. See "Overflow Logic" in spec.md.
"""
from flask import jsonify

from db import get_connection
from sessions import now

from . import bp
from .fields import session_to_dict


@bp.post("/<int:session_id>/close")
def close_office_hours(session_id):
    conn = get_connection()
    session = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    if session is None:
        conn.close()
        return jsonify({"error": "office hours not found"}), 404
    if session["closed_at"] is not None:
        conn.close()
        return jsonify({"error": "office hours already closed"}), 409

    conn.execute(
        "UPDATE office_hours SET is_open = 0, closed_at = ? WHERE id = ?",
        (now(), session_id),
    )

    # The earliest session for the same course that starts after this one
    # and hasn't been closed.
    next_session = conn.execute(
        """
        SELECT * FROM office_hours
        WHERE course = ? AND starts_at > ? AND id != ? AND closed_at IS NULL
        ORDER BY starts_at
        LIMIT 1
        """,
        (session["course"], session["starts_at"], session_id),
    ).fetchone()

    moved = 0
    if next_session is not None:
        # Manually set priorities skip the formula, so double them directly
        # to give the same x2 boost everyone else gets from overflow_count.
        conn.execute(
            """
            UPDATE tickets SET priority = priority * 2
            WHERE office_hours_id = ? AND status = 'waiting' AND manually_changed = 1
            """,
            (session_id,),
        )
        # Moved students are waiting before the next session starts, so they're
        # on time there (late = 0), plus they get the overflow boost.
        moved = conn.execute(
            """
            UPDATE tickets
            SET office_hours_id = ?, overflow_count = overflow_count + 1, late = 0
            WHERE office_hours_id = ? AND status = 'waiting'
            """,
            (next_session["id"], session_id),
        ).rowcount
        conn.execute(
            """
            UPDATE buckets
            SET office_hours_id = ?, overflow_count = overflow_count + 1, late = 0
            WHERE office_hours_id = ? AND status = 'waiting'
            """,
            (next_session["id"], session_id),
        )

    conn.commit()
    closed = conn.execute(
        "SELECT * FROM office_hours WHERE id = ?", (session_id,)
    ).fetchone()
    still_waiting = 0
    if next_session is None:
        still_waiting = conn.execute(
            "SELECT COUNT(*) AS n FROM tickets WHERE office_hours_id = ? AND status = 'waiting'",
            (session_id,),
        ).fetchone()["n"]
    conn.close()

    result = {
        "session": session_to_dict(closed),
        "moved_to": session_to_dict(next_session),
        "moved_count": moved,
    }
    if still_waiting:
        result["warning"] = (
            f"{still_waiting} student(s) are still waiting, but there is no later "
            f"{session['course']} session to move them to. They stay in the queue."
        )
    return jsonify(result)
