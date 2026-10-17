# Route blueprints for the office hours queue API.
from flask import Blueprint, jsonify, request

from db import create_bucket, get_connection, row_to_dict
from priority import score
from sessions import has_started, pick_session
from validation import category_error, clean, question_error

bp = Blueprint("queue", __name__, url_prefix="/api/queue")

# How far one professor "bump" moves a ticket.
BUMP_AMOUNT = 15

# Each waiting ticket plus how many waiting students share its bucket.
TICKETS_WITH_COUNT = """
    SELECT t.*,
        (SELECT COUNT(*) FROM tickets m
         WHERE m.bucket_id = t.bucket_id AND m.status = 'waiting') AS student_count
    FROM tickets t
"""


def _with_priority(row):
    """Professor-changed tickets keep their set priority; others use the formula."""
    ticket = row_to_dict(row)
    ticket["manually_changed"] = bool(ticket["manually_changed"])
    ticket["late"] = bool(ticket["late"])
    if not ticket["manually_changed"]:
        ticket["priority"] = score(
            ticket["question_type"],
            ticket["student_count"],
            ticket["overflow_count"],
            ticket["late"],
        )
    return ticket


def _get_ticket(conn, ticket_id):
    row = conn.execute(TICKETS_WITH_COUNT + " WHERE t.id = ?", (ticket_id,)).fetchone()
    return _with_priority(row) if row else None


@bp.get("")
def list_queue():
    conn = get_connection()
    rows = conn.execute(TICKETS_WITH_COUNT + " WHERE t.status = 'waiting'").fetchall()
    conn.close()
    tickets = [_with_priority(row) for row in rows]
    tickets.sort(key=lambda t: (-t["priority"], t["created_at"]))
    return jsonify(tickets)


@bp.post("")
def join_queue():
    data = request.get_json(silent=True) or {}
    name = clean(data.get("student_name"))
    section = clean(data.get("class_section"))
    question = clean(data.get("question"))
    question_type = clean(data.get("question_type")).lower()

    if not name or not section:
        return jsonify({"error": "student_name and class_section are required"}), 400
    error = question_error(question) or category_error(question_type)
    if error:
        return jsonify({"error": error}), 400

    conn = get_connection()
    session, error = pick_session(conn, data.get("office_hours_id"))
    if error:
        conn.close()
        return jsonify({"error": error}), 409

    # Questions submitted after the session starts go to the back of the line.
    late = has_started(session)

    # Every new question starts its own bucket that other students can join.
    bucket_id = create_bucket(conn, question, question_type, session["id"], late)
    cursor = conn.execute(
        """
        INSERT INTO tickets
            (student_name, class_section, question, question_type, priority,
             office_hours_id, bucket_id, late)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (name, section, question, question_type, score(question_type, late=late),
         session["id"], bucket_id, int(late)),
    )
    conn.commit()
    ticket = _get_ticket(conn, cursor.lastrowid)
    conn.close()
    return jsonify(ticket), 201


@bp.patch("/<int:ticket_id>")
def update_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    allowed = {"status", "priority", "question_type", "question", "class_section"}
    updates = {key: data[key] for key in allowed if key in data}

    if not updates:
        return jsonify({"error": "no valid fields to update"}), 400
    if "question" in updates:
        updates["question"] = clean(updates["question"])
        error = question_error(updates["question"])
        if error:
            return jsonify({"error": error}), 400
    if "question_type" in updates:
        updates["question_type"] = clean(updates["question_type"]).lower()
        error = category_error(updates["question_type"])
        if error:
            return jsonify({"error": error}), 400

    # A professor setting the priority by hand overrides the formula.
    if "priority" in updates:
        updates["manually_changed"] = 1
    elif "question_type" in updates:
        updates["priority"] = score(updates["question_type"])

    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [ticket_id]

    conn = get_connection()
    conn.execute(f"UPDATE tickets SET {assignments} WHERE id = ?", values)
    conn.commit()
    ticket = _get_ticket(conn, ticket_id)
    conn.close()

    if ticket is None:
        return jsonify({"error": "ticket not found"}), 404
    return jsonify(ticket)


@bp.post("/<int:ticket_id>/bump")
def bump_ticket(ticket_id):
    """Professor can move a ticket up or down the waiting list."""
    direction = (request.get_json(silent=True) or {}).get("direction", "up")
    delta = BUMP_AMOUNT if direction == "up" else -BUMP_AMOUNT

    conn = get_connection()
    ticket = _get_ticket(conn, ticket_id)
    if ticket is None:
        conn.close()
        return jsonify({"error": "ticket not found"}), 404

    # Start from the priority currently shown, then mark it as manually changed.
    conn.execute(
        "UPDATE tickets SET priority = ?, manually_changed = 1 WHERE id = ?",
        (ticket["priority"] + delta, ticket_id),
    )
    conn.commit()
    updated = _get_ticket(conn, ticket_id)
    conn.close()
    return jsonify(updated)
