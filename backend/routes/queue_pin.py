"""POST /api/queue/<ticket_id>/pin — the professor pins a student to a spot in line.

Body (JSON):
  {"position": 2}     keep this student 2nd in line while everyone else moves around them
  {"position": null}  unpin; they go back to being ordered by score

See "Manual Changing" in spec.md. A pinned student is marked manually_changed and
keeps the score they had when pinned. Pins are cleared if the student is bumped,
leaves, is helped, or moves to another session. A pin past the end of the line
puts them last.

The latest pin wins: pinning someone to a spot that's already pinned moves the
student who was there down one (and so on, if that spot is pinned too).
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import select

from db import get_db
from models import Ticket
from queue_order import get_ticket

bp = Blueprint("queue_pin", __name__, url_prefix="/api/queue")


@bp.post("/<int:ticket_id>/pin")
def pin_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    if "position" not in data:
        return jsonify({"error": "position is required (a number from 1, or null to unpin)"}), 400
    position = data["position"]
    if position is not None and (
        isinstance(position, bool) or not isinstance(position, int) or position < 1
    ):
        return jsonify({"error": "position must be a number from 1, or null to unpin"}), 400

    with get_db() as db:
        shown = get_ticket(db, ticket_id)
        if shown is None:
            return jsonify({"error": "ticket not found"}), 404
        if shown["status"] != "waiting":
            return jsonify({"error": "only students who are waiting can be pinned"}), 409

        ticket = db.get(Ticket, ticket_id)
        if position is not None:
            _make_room(db, ticket, position)
            # Keep the score they have right now, so it doesn't jump when the
            # formula stops applying to them.
            ticket.priority = shown["priority"]
            ticket.manually_changed = True
        ticket.pinned_position = position
        db.commit()
        return jsonify(get_ticket(db, ticket_id))



def _make_room(db, ticket, position):
    """If another waiting student in the same session is pinned to this spot,
    move them down one. Do the same for anyone pinned right after them, so
    back-to-back pins all shift together."""
    pins = {
        other.pinned_position: other
        for other in db.scalars(
            select(Ticket).where(
                Ticket.office_hours_id == ticket.office_hours_id,
                Ticket.status == "waiting",
                Ticket.pinned_position.is_not(None),
                Ticket.id != ticket.id,
            )
        )
    }
    spot = position
    in_the_way = []
    while spot in pins:
        in_the_way.append(pins[spot])
        spot += 1
    for other in in_the_way:
        other.pinned_position += 1
