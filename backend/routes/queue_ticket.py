"""GET /api/queue/<ticket_id> — one ticket, so a student can check their place in line.

Returns the ticket with its current position (null once it's no longer waiting).
"""
from flask import Blueprint, jsonify

from db import get_connection
from queue_order import get_ticket

bp = Blueprint("queue_ticket", __name__, url_prefix="/api/queue")


@bp.get("/<int:ticket_id>")
def get_queue_ticket(ticket_id):
    conn = get_connection()
    ticket = get_ticket(conn, ticket_id)
    conn.close()
    if ticket is None:
        return jsonify({"error": "ticket not found"}), 404
    return jsonify(ticket)
