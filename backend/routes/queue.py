from flask import Blueprint, jsonify, request

from db import create_bucket, get_connection, row_to_dict
from priority import score_question

bp = Blueprint("queue", __name__, url_prefix="/api/queue")


def _open_session(conn):
    return conn.execute(
        "SELECT * FROM office_hours WHERE is_open = 1 ORDER BY id DESC LIMIT 1"
    ).fetchone()


@bp.get("")
def list_queue():
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT * FROM tickets
        WHERE status = 'waiting'
        ORDER BY priority DESC, created_at ASC
        """
    ).fetchall()
    conn.close()
    return jsonify([row_to_dict(row) for row in rows])


@bp.post("")
def join_queue():
    data = request.get_json(silent=True) or {}
    name = (data.get("student_name") or "").strip()
    question = (data.get("question") or "").strip()
    question_type = (data.get("question_type") or "other").strip().lower()

    if not name or not question:
        return jsonify({"error": "student_name and question are required"}), 400

    conn = get_connection()
    session = _open_session(conn)
    priority = score_question(question_type, question)
    office_hours_id = session["id"] if session else None
    # Every new question starts its own bucket that other students can join.
    bucket_id = create_bucket(conn, question, question_type, priority, office_hours_id)
    cursor = conn.execute(
        """
        INSERT INTO tickets
            (student_name, question, question_type, priority, office_hours_id, bucket_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, question, question_type, priority, office_hours_id, bucket_id),
    )
    conn.commit()
    ticket = conn.execute(
        "SELECT * FROM tickets WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    conn.close()
    return jsonify(row_to_dict(ticket)), 201


@bp.patch("/<int:ticket_id>")
def update_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    allowed = {"status", "priority", "question_type", "question"}
    updates = {key: data[key] for key in allowed if key in data}

    if not updates:
        return jsonify({"error": "no valid fields to update"}), 400

    if "question_type" in updates:
        updates["priority"] = score_question(
            updates["question_type"], updates.get("question", "")
        )

    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [ticket_id]

    conn = get_connection()
    conn.execute(f"UPDATE tickets SET {assignments} WHERE id = ?", values)
    conn.commit()
    ticket = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    conn.close()

    if ticket is None:
        return jsonify({"error": "ticket not found"}), 404
    return jsonify(row_to_dict(ticket))


@bp.post("/<int:ticket_id>/bump")
def bump_ticket(ticket_id):
    """Professor can move a ticket up or down the waiting list."""
    direction = (request.get_json(silent=True) or {}).get("direction", "up")
    delta = 15 if direction == "up" else -15

    conn = get_connection()
    ticket = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    if ticket is None:
        conn.close()
        return jsonify({"error": "ticket not found"}), 404

    conn.execute(
        "UPDATE tickets SET priority = ? WHERE id = ?",
        (ticket["priority"] + delta, ticket_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(updated))
