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
To pin a whole group (e.g. for drag and drop), use POST /api/buckets/<id>/pin.
"""
from flask import Blueprint, jsonify, request

from db import get_db
from models import Ticket
from pins import pin_at
from queue_order import get_ticket
from validation import spot_error

bp = Blueprint("queue_pin", __name__, url_prefix="/api/queue")


@bp.post("/<int:ticket_id>/pin")
def pin_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    if "position" not in data:
        return jsonify({"error": "position is required (a number from 1, or null to unpin)"}), 400
    position = data["position"]
    error = spot_error(position)
    if error:
        return jsonify({"error": error}), 400

    with get_db() as db:
        shown = get_ticket(db, ticket_id)
        if shown is None:
            return jsonify({"error": "ticket not found"}), 404
        if shown["status"] != "waiting":
            return jsonify({"error": "only students who are waiting can be pinned"}), 409

        ticket = db.get(Ticket, ticket_id)
        if position is None:
            ticket.pinned_position = None
        else:
            pin_at(db, ticket, position, shown["priority"])
        db.commit()
        return jsonify(get_ticket(db, ticket_id))
