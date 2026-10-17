"""GET /api/office_hours — list sessions, earliest first.

Query params (all optional):
  course   only this course, e.g. "ICS 32"
  is_open  "true" for open sessions only, "false" for closed only
  state    "upcoming", "running" or "closed"
"""
from flask import jsonify, request
from sqlalchemy import and_, func, select

from db import get_db
from models import OfficeHours, Ticket

from . import bp
from .fields import session_to_dict


@bp.get("")
def list_office_hours():
    query = (
        select(OfficeHours, func.count(Ticket.id).label("waiting_count"))
        .outerjoin(
            Ticket,
            and_(Ticket.office_hours_id == OfficeHours.id, Ticket.status == "waiting"),
        )
        .group_by(OfficeHours.id)
        .order_by(OfficeHours.starts_at)
    )

    course = (request.args.get("course") or "").strip()
    if course:
        query = query.where(OfficeHours.course == course)

    is_open = (request.args.get("is_open") or "").strip().lower()
    if is_open in ("true", "false"):
        query = query.where(OfficeHours.is_open.is_(is_open == "true"))

    state = (request.args.get("state") or "").strip().lower()
    if state and state not in ("upcoming", "running", "closed"):
        return jsonify({"error": "state must be one of: upcoming, running, closed"}), 400

    with get_db() as db:
        sessions = []
        for session, waiting_count in db.execute(query).all():
            data = session_to_dict(session)
            if state and data["state"] != state:
                continue
            data["waiting_count"] = waiting_count
            sessions.append(data)
    return jsonify(sessions)
