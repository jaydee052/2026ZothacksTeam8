# Route blueprints for the office hours queue API.
from flask import Blueprint, jsonify, request
from sqlalchemy import func, select

from bucket_rules import add_to_bucket, sync_bucket_status
from pins import leaving_line
from db import create_bucket, get_db
from classify import classify
from embeddings import closest_bucket, embed, to_json
from models import Bucket, OfficeHours, Ticket
from priority import DEFAULT_CATEGORY, score
from queue_order import get_ticket, session_line
from sessions import has_started, pick_session
from validation import category_error, clean, question_error, status_error

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
    # Students don't pick a category. A question that joins a group takes the
    # group's; a new group is classified by Gemini (a professor can still change it).
    question_type = clean(data.get("question_type")).lower()

    if not name or not section:
        return jsonify({"error": "student_name and class_section are required"}), 400
    error = question_error(question) or (question_type and category_error(question_type))
    if error:
        return jsonify({"error": error}), 400

    with get_db() as db:
        session, error = pick_session(db, data.get("office_hours_id"))
        if error:
            return jsonify({"error": error}), 409

        # Questions submitted after the session starts go to the back of the line.
        late = has_started(session)

        # The question joins the bucket of the waiting question closest in meaning,
        # in any category, if one is close enough (see embeddings.py). Otherwise
        # it starts its own bucket that other students can join.
        vector = embed(question)
        bucket, match = (None, 0.0)
        if vector is not None:
            bucket, match = closest_bucket(db, question, vector, session.id)

        if bucket is not None:
            ticket = add_to_bucket(db, bucket, name, section, question, to_json(vector))
        else:
            # Only new groups are classified, so joining a group never waits on Gemini.
            question_type = question_type or classify(question) or DEFAULT_CATEGORY
            bucket = create_bucket(db, question, question_type, session.id, late)
            ticket = Ticket(
                embedding=to_json(vector),
                student_name=name,
                class_section=section,
                question=question,
                question_type=question_type,
                priority=score(question_type),
                office_hours_id=session.id,
                bucket_id=bucket.id,
                late=late,
            )
            db.add(ticket)
        db.commit()

        data = get_ticket(db, ticket.id)
        # Tells the student their question was grouped with a classmate's.
        data["joined_existing_bucket"] = match > 0
        data["bucket_similarity"] = match or None
        return jsonify(data), 201


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
    if "status" in updates:
        updates["status"] = clean(updates["status"]).lower()
        error = status_error(updates["status"])
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

        old_bucket_id = ticket.bucket_id
        category_changed = (
            "question_type" in updates and updates["question_type"] != ticket.question_type
        )
        if "status" in updates and updates["status"] != ticket.status:
            leaving_line(db, [ticket])  # pins behind them move up; theirs is cleared
        for key, value in updates.items():
            setattr(ticket, key, value)
        if "question" in updates:
            ticket.embedding = None  # re-embedded the next time questions are matched
        db.flush()

        # A new category means a different kind of question than the rest of the
        # group. If others share the group, this student gets a group of their own;
        # if they're alone in it, the group's category changes with them.
        if category_changed and old_bucket_id is not None:
            others = db.scalar(
                select(func.count(Ticket.id)).where(
                    Ticket.bucket_id == old_bucket_id,
                    Ticket.status == "waiting",
                    Ticket.id != ticket.id,
                )
            )
            if others:
                bucket = create_bucket(
                    db, ticket.question, ticket.question_type, ticket.office_hours_id, ticket.late
                )
                ticket.bucket_id = bucket.id
            else:
                db.get(Bucket, old_bucket_id).question_type = ticket.question_type
            db.flush()

        # Close a bucket once nobody in it is waiting, or reopen it if someone is
        # back to waiting.
        if "status" in updates or category_changed:
            sync_bucket_status(db, old_bucket_id)
            sync_bucket_status(db, ticket.bucket_id)
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

        # Late questions are already at the back. Bumping one up moves it into the
        # main line; bumping it down has nowhere to go.
        if shown["in_late_section"] and delta < 0:
            return jsonify({
                "error": "this question is already in the late section at the back of the line"
            }), 409

        # Start from the priority currently shown, then mark it as manually changed.
        # A manually changed question is ranked in the main line, even if it was late.
        # Bumping also removes a pin, since the professor is now moving it by score.
        ticket = db.get(Ticket, ticket_id)
        ticket.priority = shown["priority"] + delta
        ticket.manually_changed = True
        ticket.pinned_position = None
        db.commit()
        return jsonify(get_ticket(db, ticket_id))
