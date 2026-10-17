"""POST /api/queue/<ticket_id>/leave — a student leaves the line without being helped.

Their status becomes "left" (as opposed to "done", which means helped). If they
were the last one waiting in their group, the group closes.
"""
from flask import Blueprint, jsonify

from bucket_rules import sync_bucket_status
from db import get_db
from models import Ticket
from queue_order import get_ticket

bp = Blueprint("queue_leave", __name__, url_prefix="/api/queue")


@bp.post("/<int:ticket_id>/leave")
def leave_queue(ticket_id):
    with get_db() as db:
        ticket = db.get(Ticket, ticket_id)
        if ticket is None:
            return jsonify({"error": "ticket not found"}), 404
        if ticket.status != "waiting":
            return jsonify({"error": f"this student isn't waiting (status: {ticket.status})"}), 409

        ticket.status = "left"
        ticket.pinned_position = None
        db.flush()
        sync_bucket_status(db, ticket.bucket_id)
        db.commit()
        return jsonify(get_ticket(db, ticket_id))
