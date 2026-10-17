# Route blueprints for the office hours queue API.
from flask import Blueprint, jsonify, request
from sqlalchemy import select

from db import create_bucket, get_db
from models import OfficeHours, Ticket
from priority import score
from queue_order import get_ticket, session_line
from sessions import has_started, pick_session
from validation import category_error, clean, question_error

bp = Blueprint("queue", __name__, url_prefix="/api/queue")

# How far one professor "bump" moves a ticket.
BUMP_AMOUNT = 15


@bp.get("")
def list_queue():
    """Waiting students in serving order, each with a position number.

    ?office_hours_id=N  only that session's line
    No filter: every session's line, grouped by session start time.
    Positions count from 1 within each session.
    """
    raw_id = request.args.get("office_hours_id")

    with get_db() as db:
        if raw_id is not None:
            try:
                office_hours_id = int(raw_id)
            except ValueError:
                return jsonify({"error": "office_hours_id must be a number"}), 400
            if db.get(OfficeHours, office_hours_id) is None:
                return jsonify({"error": "office hours not found"}), 404
            return jsonify(session_line(db, office_hours_id))

        # Sessions that have someone waiting, earliest first. Tickets with no
        # session (from very old databases) come last.
        session_ids = db.scalars(
            select(Ticket.office_hours_id)
            .distinct()
            .outerjoin(OfficeHours, OfficeHours.id == Ticket.office_hours_id)
            .where(Ticket.status == "waiting")
            .order_by(OfficeHours.starts_at.is_(None), OfficeHours.starts_at)
        ).all()
        line = [ticket for sid in session_ids for ticket in session_line(db, sid)]
        return jsonify(line)


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

    with get_db() as db:
        session, error = pick_session(db, data.get("office_hours_id"))
        if error:
            return jsonify({"error": error}), 409

        # Questions submitted after the session starts go to the back of the line.
        late = has_started(session)

        # Every new question starts its own bucket that other students can join.
        bucket = create_bucket(db, question, question_type, session.id, late)
        ticket = Ticket(
            student_name=name,
            class_section=section,
            question=question,
            question_type=question_type,
            priority=score(question_type, late=late),
            office_hours_id=session.id,
            bucket_id=bucket.id,
            late=late,
        )
        db.add(ticket)
        db.commit()
        return jsonify(get_ticket(db, ticket.id)), 201


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
        updates["manually_changed"] = True
    elif "question_type" in updates:
        updates["priority"] = score(updates["question_type"])

    with get_db() as db:
        ticket = db.get(Ticket, ticket_id)
        if ticket is None:
            return jsonify({"error": "ticket not found"}), 404
        for key, value in updates.items():
            setattr(ticket, key, value)
        db.commit()
        return jsonify(get_ticket(db, ticket_id))


@bp.post("/<int:ticket_id>/bump")
def bump_ticket(ticket_id):
    """Professor can move a ticket up or down the waiting list."""
    direction = (request.get_json(silent=True) or {}).get("direction", "up")
    delta = BUMP_AMOUNT if direction == "up" else -BUMP_AMOUNT

    with get_db() as db:
        shown = get_ticket(db, ticket_id)
        if shown is None:
            return jsonify({"error": "ticket not found"}), 404

        # Start from the priority currently shown, then mark it as manually changed.
        ticket = db.get(Ticket, ticket_id)
        ticket.priority = shown["priority"] + delta
        ticket.manually_changed = True
        db.commit()
        return jsonify(get_ticket(db, ticket_id))
